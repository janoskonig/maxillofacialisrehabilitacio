import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { HttpError, type AuthPayload } from '@/lib/auth-server';
import { z } from 'zod';

export const sessionStatusSchema = z.enum(['draft', 'active', 'closed']);

const checklistEntrySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  checked: z.boolean().default(false),
  checkedAt: z.string().datetime().nullable().optional(),
  checkedBy: z.string().nullable().optional(),
  /** Konzílium döntés / válasz a napirendi pontra (strukturáltan pontonként). */
  response: z.string().max(5000).nullable().optional(),
  respondedAt: z.string().datetime().nullable().optional(),
  respondedBy: z.string().nullable().optional(),
  delegatedTasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1),
        status: z.string().min(1),
        assigneeUserId: z.string().uuid(),
        assigneeName: z.string().min(1),
        createdByUserId: z.string().uuid().nullable().optional(),
        createdByName: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
        createdAt: z.string().datetime(),
        completedAt: z.string().datetime().nullable().optional(),
        dueAt: z.string().datetime().nullable().optional(),
      }),
    )
    .optional(),
});

export const sessionAttendeeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  present: z.boolean(),
});

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type SessionAttendee = z.infer<typeof sessionAttendeeSchema>;
export type ChecklistEntry = z.infer<typeof checklistEntrySchema>;

export const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scheduledAt: z.string().datetime(),
});

export const updateSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  scheduledAt: z.string().datetime().optional(),
  status: sessionStatusSchema.optional(),
  attendees: z.array(sessionAttendeeSchema).optional(),
});

export const addSessionItemSchema = z.object({
  patientId: z.string().uuid(),
  discussed: z.boolean().optional(),
  checklist: z.array(checklistEntrySchema).default([]).optional(),
});

export const patchSessionItemSchema = z.object({
  operation: z.literal('update_discussed'),
  discussed: z.boolean(),
});

export const checklistResponseBodySchema = z.object({
  response: z.string().max(5000),
});

export const checklistToggleSchema = z.object({
  checked: z.boolean(),
});

export const checklistAddSchema = z.object({
  label: z.string().trim().min(1).max(500),
});

export const checklistRenameSchema = z.object({
  label: z.string().trim().min(1).max(500),
});

/** Vetítés / konzílium: napirendi pontból staff feladat létrehozása. */
export const checklistDelegateTaskSchema = z
  .object({
    assigneeUserId: z.string().uuid(),
    note: z.string().trim().max(2000).optional(),
    /** ISO 8601 (UTC); opcionális határidő a címzett feladataihoz. */
    dueAt: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.dueAt) return;
    const d = new Date(data.dueAt);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Érvénytelen határidő', path: ['dueAt'] });
      return;
    }
    if (d.getTime() < Date.now() - 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A határidő nem lehet a múltban',
        path: ['dueAt'],
      });
    }
  });

export const reorderItemsSchema = z.object({
  itemIdsInOrder: z.array(z.string().uuid()).min(1),
});

export async function getUserInstitution(auth: AuthPayload): Promise<string> {
  const pool = getDbPool();
  const userResult = await pool.query(
    'SELECT intezmeny FROM users WHERE id = $1 AND active = true',
    [auth.userId],
  );
  const institution = userResult.rows[0]?.intezmeny?.trim?.();
  if (!institution) {
    throw new HttpError(403, 'A felhasználóhoz nincs intézmény rendelve', 'NO_INSTITUTION');
  }
  return institution;
}

export function assertSessionTransition(current: SessionStatus, next: SessionStatus): void {
  if (current === next) return;
  if (current === 'draft' && next === 'active') return;
  if (current === 'active' && next === 'closed') return;
  throw new HttpError(409, 'Nem engedélyezett állapotváltás', 'INVALID_STATE_TRANSITION');
}

export function assertSessionWritableForItems(status: SessionStatus): void {
  if (status !== 'draft') {
    throw new HttpError(409, 'Az elem lista csak draft állapotban módosítható', 'SESSION_NOT_DRAFT');
  }
}

export function assertSessionWritableForItemFields(status: SessionStatus): void {
  if (status === 'closed') {
    throw new HttpError(409, 'Lezárt session csak olvasható', 'SESSION_CLOSED');
  }
}

export async function getScopedSessionOrThrow(sessionId: string, institutionId: string) {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT id, title, institution_id as "institutionId", scheduled_at as "scheduledAt",
            status, created_by as "createdBy", updated_by as "updatedBy",
            created_at as "createdAt", updated_at as "updatedAt",
            attendees
     FROM consilium_sessions
     WHERE id = $1::uuid
       AND btrim(coalesce(institution_id, '')) = btrim(coalesce($2::text, ''))`,
    [sessionId, institutionId],
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Konzílium alkalom nem található', 'SESSION_NOT_FOUND');
  }
  return result.rows[0];
}

export function normalizeSessionAttendees(raw: unknown): SessionAttendee[] {
  const parsed = z.array(sessionAttendeeSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export async function ensurePatientVisibleForUser(
  patientId: string,
  auth: AuthPayload,
  _institutionId: string,
): Promise<void> {
  const pool = getDbPool();
  // Minden ágon a placeholder sorszámozás folytonos legyen ($1..$N), különben a nem használt
  // $2 bind miatt Postgres 42P18: "could not determine data type of parameter $2".
  let result;
  if (auth.role === 'beutalo_orvos') {
    // Csak a saját intézményéhez tartozó beutalások páciensei (ugyanaz a szabály, mint a beteglista keresésnél).
    result = await pool.query(
      `SELECT p.id
       FROM patients p
       JOIN patient_referral r ON r.patient_id = p.id
       JOIN users u ON u.id = $2::uuid
       WHERE p.id = $1::uuid
         AND u.intezmeny IS NOT NULL
         AND r.beutalo_intezmeny = u.intezmeny`,
      [patientId, auth.userId],
    );
  } else {
    // Admin / fogpótlástanász / technikus: a többi API-hoz igazodva nem kötjük a beteget a beutaló intézmény szövegéhez
    // (az gyakran nem egyezik a belső users.intezmeny értékkel). Az alkalom továbbra is intézményhez kötött.
    result = await pool.query(`SELECT id FROM patients WHERE id = $1::uuid`, [patientId]);
  }
  if (result.rows.length === 0) {
    throw new HttpError(403, 'A beteg nem érhető el ebben az intézményi scope-ban', 'PATIENT_FORBIDDEN');
  }
}

export function normalizeChecklist(raw: unknown): ChecklistEntry[] {
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(checklistEntrySchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export type NextDraftSessionSummary = {
  id: string;
  title: string;
  scheduledAt: string;
  status: SessionStatus;
};

/** Legkorábbi `draft` alkalom, amelynek időpontja nem múlt el (intézmény szerint). */
export async function findNextUpcomingDraftSession(institutionId: string): Promise<NextDraftSessionSummary | null> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id, title, scheduled_at as "scheduledAt", status
     FROM consilium_sessions
     WHERE btrim(coalesce(institution_id, '')) = btrim(coalesce($1::text, ''))
       AND status = 'draft'
       AND scheduled_at >= NOW()
     ORDER BY scheduled_at ASC
     LIMIT 1`,
    [institutionId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const at = row.scheduledAt;
  const scheduledAt =
    at instanceof Date ? at.toISOString() : typeof at === 'string' ? at : new Date(at).toISOString();
  const statusParsed = sessionStatusSchema.safeParse(row.status);
  return {
    id: row.id,
    title: String(row.title ?? ''),
    scheduledAt,
    status: statusParsed.success ? statusParsed.data : 'draft',
  };
}

export async function isPatientOnConsiliumSession(sessionId: string, patientId: string): Promise<boolean> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT 1 FROM consilium_session_items WHERE session_id = $1::uuid AND patient_id = $2::uuid LIMIT 1`,
    [sessionId, patientId],
  );
  return r.rows.length > 0;
}

export async function insertConsiliumSessionItemInTx(
  client: PoolClient,
  opts: {
    sessionId: string;
    patientId: string;
    email: string;
    discussed?: boolean | null;
    checklist?: ChecklistEntry[];
  },
) {
  const checklist = normalizeChecklist(opts.checklist ?? []);
  const maxRow = await client.query(
    `SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM consilium_session_items WHERE session_id = $1`,
    [opts.sessionId],
  );
  const nextSort = Number(maxRow.rows[0].max_sort) + 1;
  const insert = await client.query(
    `INSERT INTO consilium_session_items (
       session_id, patient_id, sort_order, discussed, checklist, created_by, updated_by
     )
     VALUES ($1, $2, $3, COALESCE($4, false), $5::jsonb, $6, $6)
     RETURNING
       id,
       session_id as "sessionId",
       patient_id as "patientId",
       sort_order as "sortOrder",
       discussed,
       checklist`,
    [opts.sessionId, opts.patientId, nextSort, opts.discussed ?? null, JSON.stringify(checklist), opts.email],
  );
  return insert.rows[0];
}

