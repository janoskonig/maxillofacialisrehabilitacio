/**
 * Fázis 2.2 — full-text search (PostgreSQL tsvector + GIN).
 *
 * Jogosultság: csak olyan üzenetek kerülnek vissza, amelyeket a viewer a
 * listázó API-kkal (getPatientMessages / getDoctorMessages) is láthatna.
 */

import { getDbPool } from '@/lib/db';
import { validateUUID } from '@/lib/validation';
import type { MessageContextEntityType, MessageSearchHit, MessageSearchResult } from '@/lib/types/messaging';
import {
  parseContextEntityType,
  parseContextEntityId,
  type ContextLinkViewer,
} from './context-links';

const MIN_QUERY_LEN = 2;
const MAX_QUERY_LEN = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** SQL fragment: user valaha kezelte a messages.patient_id beteget. */
function sqlPatientEverTreated(userParam: string): string {
  return `EXISTS (
    SELECT 1 FROM patients p
     WHERE p.id = m.patient_id
       AND (
         p.kezeleoorvos_user_id = ${userParam}
         OR EXISTS (
           SELECT 1 FROM patient_episodes pe
            WHERE pe.patient_id = p.id AND pe.assigned_provider_id = ${userParam}
         )
         OR EXISTS (
           SELECT 1 FROM appointments a
            JOIN users u ON u.email = a.dentist_email
           WHERE a.patient_id = p.id AND u.id = ${userParam}
         )
         OR (
           p.kezeleoorvos IS NOT NULL AND p.kezeleoorvos <> ''
           AND EXISTS (
             SELECT 1 FROM users u
              WHERE u.id = ${userParam}
                AND (p.kezeleoorvos = u.email OR p.kezeleoorvos = u.doktor_neve)
           )
         )
       )
  )`;
}

/** Staff orvos lane-szűrés (getPatientMessages treating-orvos ága). */
function sqlPatientLaneForDoctor(doctorParam: string): string {
  return `(
    (m.sender_type = 'patient' AND (m.recipient_doctor_id = ${doctorParam} OR m.recipient_doctor_id IS NULL))
    OR (m.sender_type = 'doctor' AND m.sender_id = ${doctorParam})
  )`;
}

/** Beteg portál lane (doctorId megadva). */
function sqlPatientLaneForPortal(doctorParam: string): string {
  return `(
    (m.sender_type = 'patient' AND m.recipient_doctor_id = ${doctorParam})
    OR (m.sender_type = 'doctor' AND m.sender_id = ${doctorParam})
  )`;
}

export class MessageSearchError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MessageSearchError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeSearchQuery(raw: unknown): string {
  if (raw === null || raw === undefined) {
    throw new MessageSearchError(400, 'QUERY_REQUIRED', 'A keresőkifejezés (q) kötelező');
  }
  const q = String(raw).trim();
  if (q.length < MIN_QUERY_LEN) {
    throw new MessageSearchError(
      400,
      'QUERY_TOO_SHORT',
      `A keresőkifejezés legalább ${MIN_QUERY_LEN} karakter legyen`,
    );
  }
  if (q.length > MAX_QUERY_LEN) {
    throw new MessageSearchError(
      400,
      'QUERY_TOO_LONG',
      `A keresőkifejezés legfeljebb ${MAX_QUERY_LEN} karakter lehet`,
    );
  }
  return q;
}

export interface PatientMessageSearchFilters {
  q: string;
  patientId?: string;
  laneDoctorId?: string;
  from?: Date;
  to?: Date;
  sender?: 'doctor' | 'patient' | 'me';
  hasAttachment?: boolean;
  entityType?: MessageContextEntityType;
  entityId?: string;
  limit?: number;
  offset?: number;
}

export interface DoctorMessageSearchFilters {
  q: string;
  recipientId?: string;
  groupId?: string;
  from?: Date;
  to?: Date;
  sender?: 'me' | 'other' | string;
  hasAttachment?: boolean;
  entityType?: MessageContextEntityType;
  entityId?: string;
  limit?: number;
  offset?: number;
}

function resolveLimitOffset(limit?: number, offset?: number): { limit: number; offset: number } {
  const lim = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const off = Math.max(offset ?? 0, 0);
  return { limit: lim, offset: off };
}

function parseOptionalDate(value: string | null, field: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new MessageSearchError(400, 'INVALID_DATE', `${field} érvénytelen dátum`);
  }
  return d;
}

export function parsePatientSearchFilters(sp: URLSearchParams): PatientMessageSearchFilters {
  const q = normalizeSearchQuery(sp.get('q'));
  const patientIdRaw = sp.get('patientId');
  const patientId = patientIdRaw ? validateUUID(patientIdRaw, 'patientId') : undefined;
  const laneDoctorIdRaw = sp.get('doctorId');
  const laneDoctorId = laneDoctorIdRaw
    ? validateUUID(laneDoctorIdRaw, 'doctorId')
    : undefined;

  const senderRaw = sp.get('sender');
  let sender: PatientMessageSearchFilters['sender'];
  if (senderRaw) {
    if (senderRaw === 'me' || senderRaw === 'doctor' || senderRaw === 'patient') {
      sender = senderRaw;
    } else {
      throw new MessageSearchError(400, 'INVALID_SENDER', 'sender: me | doctor | patient');
    }
  }

  const hasAttachment = sp.get('hasAttachment') === 'true' ? true : undefined;
  let entityType: MessageContextEntityType | undefined;
  let entityId: string | undefined;
  const entityTypeRaw = sp.get('entityType');
  const entityIdRaw = sp.get('entityId');
  if (entityTypeRaw || entityIdRaw) {
    if (!entityTypeRaw || !entityIdRaw) {
      throw new MessageSearchError(
        400,
        'ENTITY_FILTER_INCOMPLETE',
        'entityType és entityId együtt kötelező',
      );
    }
    entityType = parseContextEntityType(entityTypeRaw);
    entityId = parseContextEntityId(entityIdRaw);
  }

  const limit = sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined;
  const offset = sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new MessageSearchError(400, 'INVALID_LIMIT', 'limit érvénytelen');
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new MessageSearchError(400, 'INVALID_OFFSET', 'offset érvénytelen');
  }

  return {
    q,
    patientId,
    laneDoctorId,
    from: parseOptionalDate(sp.get('from'), 'from'),
    to: parseOptionalDate(sp.get('to'), 'to'),
    sender,
    hasAttachment,
    entityType,
    entityId,
    limit,
    offset,
  };
}

export function parseDoctorSearchFilters(sp: URLSearchParams): DoctorMessageSearchFilters {
  const q = normalizeSearchQuery(sp.get('q'));
  const recipientId = sp.get('recipientId')
    ? validateUUID(sp.get('recipientId'), 'recipientId')
    : undefined;
  const groupId = sp.get('groupId')
    ? validateUUID(sp.get('groupId'), 'groupId')
    : undefined;

  const sender = sp.get('sender') ?? undefined;
  const hasAttachment = sp.get('hasAttachment') === 'true' ? true : undefined;

  let entityType: MessageContextEntityType | undefined;
  let entityId: string | undefined;
  const entityTypeRaw = sp.get('entityType');
  const entityIdRaw = sp.get('entityId');
  if (entityTypeRaw || entityIdRaw) {
    if (!entityTypeRaw || !entityIdRaw) {
      throw new MessageSearchError(
        400,
        'ENTITY_FILTER_INCOMPLETE',
        'entityType és entityId együtt kötelező',
      );
    }
    entityType = parseContextEntityType(entityTypeRaw);
    entityId = parseContextEntityId(entityIdRaw);
  }

  const limit = sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined;
  const offset = sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined;

  return {
    q,
    recipientId,
    groupId,
    from: parseOptionalDate(sp.get('from'), 'from'),
    to: parseOptionalDate(sp.get('to'), 'to'),
    sender,
    hasAttachment,
    entityType,
    entityId,
    limit,
    offset,
  };
}

function appendDateFilters(
  clauses: string[],
  params: unknown[],
  from?: Date,
  to?: Date,
): void {
  if (from) {
    params.push(from);
    clauses.push(`m.created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`m.created_at <= $${params.length}`);
  }
}

function appendContextLinkFilters(
  clauses: string[],
  params: unknown[],
  channel: 'patient' | 'doctor',
  hasAttachment?: boolean,
  entityType?: MessageContextEntityType,
  entityId?: string,
): void {
  if (hasAttachment) {
    clauses.push(`EXISTS (
      SELECT 1 FROM message_context_links mcl
       WHERE mcl.channel = '${channel}'
         AND mcl.message_id = m.id
         AND mcl.entity_type = 'document'
    )`);
  }
  if (entityType && entityId) {
    params.push(entityType);
    const typeParam = `$${params.length}`;
    params.push(entityId);
    const idParam = `$${params.length}::uuid`;
    clauses.push(`EXISTS (
      SELECT 1 FROM message_context_links mcl
       WHERE mcl.channel = '${channel}'
         AND mcl.message_id = m.id
         AND mcl.entity_type = ${typeParam}
         AND mcl.entity_id = ${idParam}
    )`);
  }
}

/**
 * Beteg csatorna FTS — staff (admin/orvos) és beteg portál.
 */
export async function searchPatientMessages(
  viewer: ContextLinkViewer,
  filters: PatientMessageSearchFilters,
): Promise<MessageSearchResult> {
  const { limit, offset } = resolveLimitOffset(filters.limit, filters.offset);
  const pool = getDbPool();

  const params: unknown[] = [];
  const where: string[] = [];

  params.push(filters.q);
  const qParam = `$${params.length}`;
  where.push(`m.search_vector @@ plainto_tsquery('hungarian', ${qParam})`);

  if (filters.patientId) {
    params.push(filters.patientId);
    where.push(`m.patient_id = $${params.length}::uuid`);
  }

  if (viewer.kind === 'patient_portal') {
    params.push(viewer.patientId);
    where.push(`m.patient_id = $${params.length}::uuid`);
    if (filters.laneDoctorId) {
      params.push(filters.laneDoctorId);
      where.push(sqlPatientLaneForPortal(`$${params.length}::uuid`));
    }
  } else {
    const isAdmin = viewer.role === 'admin';
    if (!isAdmin) {
      params.push(viewer.userId);
      const userParam = `$${params.length}::uuid`;
      where.push(sqlPatientEverTreated(userParam));
      params.push(viewer.userId);
      where.push(sqlPatientLaneForDoctor(`$${params.length}::uuid`));
    }
  }

  if (filters.sender === 'doctor') {
    where.push(`m.sender_type = 'doctor'`);
  } else if (filters.sender === 'patient') {
    where.push(`m.sender_type = 'patient'`);
  } else if (filters.sender === 'me') {
    if (viewer.kind === 'patient_portal') {
      params.push(viewer.patientId);
      where.push(`m.sender_type = 'patient' AND m.sender_id = $${params.length}::uuid`);
    } else {
      params.push(viewer.userId);
      where.push(`m.sender_type = 'doctor' AND m.sender_id = $${params.length}::uuid`);
    }
  }

  appendDateFilters(where, params, filters.from, filters.to);
  appendContextLinkFilters(
    where,
    params,
    'patient',
    filters.hasAttachment,
    filters.entityType,
    filters.entityId,
  );

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM messages m ${whereSql}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  params.push(limit, offset);
  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;

  const dataResult = await pool.query(
    `SELECT m.id,
            m.patient_id,
            m.sender_type,
            m.sender_id,
            m.sender_email,
            m.subject,
            m.message,
            m.created_at,
            m.reply_to_message_id,
            m.recipient_doctor_id,
            p.nev AS patient_name,
            ts_rank(m.search_vector, plainto_tsquery('hungarian', ${qParam})) AS rank,
            ts_headline(
              'hungarian',
              coalesce(m.subject, '') || E'\\n' || coalesce(m.message, ''),
              plainto_tsquery('hungarian', ${qParam}),
              'MaxFragments=2, MaxWords=30, MinWords=8, StartSel=<mark>, StopSel=</mark>'
            ) AS snippet
       FROM messages m
       LEFT JOIN patients p ON p.id = m.patient_id
      ${whereSql}
      ORDER BY rank DESC, m.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  const hits: MessageSearchHit[] = dataResult.rows.map((row) => ({
    id: row.id,
    channel: 'patient',
    patientId: row.patient_id,
    patientName: row.patient_name ?? null,
    senderType: row.sender_type,
    senderId: row.sender_id,
    recipientDoctorId: row.recipient_doctor_id ?? null,
    senderEmail: row.sender_email ?? null,
    subject: row.subject,
    message: row.message,
    snippet: row.snippet ?? row.message,
    rank: Number(row.rank) || 0,
    createdAt: new Date(row.created_at),
    replyToMessageId: row.reply_to_message_id ?? null,
  }));

  return { hits, total, limit, offset };
}

/**
 * Orvos–orvos / csoport FTS — csak staff.
 */
export async function searchDoctorMessages(
  viewer: ContextLinkViewer,
  filters: DoctorMessageSearchFilters,
): Promise<MessageSearchResult> {
  if (viewer.kind === 'patient_portal') {
    throw new MessageSearchError(403, 'FORBIDDEN', 'Az orvos csatorna keresése nem elérhető');
  }

  const { limit, offset } = resolveLimitOffset(filters.limit, filters.offset);
  const pool = getDbPool();

  const params: unknown[] = [];
  const where: string[] = [];

  params.push(filters.q);
  const qParam = `$${params.length}`;
  where.push(`m.search_vector @@ plainto_tsquery('hungarian', ${qParam})`);

  params.push(viewer.userId);
  const userParam = `$${params.length}::uuid`;
  where.push(`(
    m.sender_id = ${userParam}
    OR m.recipient_id = ${userParam}
    OR (
      m.group_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM doctor_message_group_participants gp
         WHERE gp.group_id = m.group_id AND gp.user_id = ${userParam}
      )
    )
  )`);

  if (filters.recipientId) {
    params.push(filters.recipientId);
    const other = `$${params.length}::uuid`;
    params.push(viewer.userId);
    const me = `$${params.length}::uuid`;
    where.push(`(
      (m.sender_id = ${me} AND m.recipient_id = ${other})
      OR (m.sender_id = ${other} AND m.recipient_id = ${me})
    )`);
    where.push(`m.group_id IS NULL`);
  }

  if (filters.groupId) {
    params.push(filters.groupId);
    where.push(`m.group_id = $${params.length}::uuid`);
    params.push(viewer.userId);
    where.push(`EXISTS (
      SELECT 1 FROM doctor_message_group_participants gp
       WHERE gp.group_id = m.group_id AND gp.user_id = $${params.length}::uuid
    )`);
  }

  if (filters.sender === 'me') {
    params.push(viewer.userId);
    where.push(`m.sender_id = $${params.length}::uuid`);
  } else if (filters.sender === 'other') {
    params.push(viewer.userId);
    where.push(`m.sender_id <> $${params.length}::uuid`);
  } else if (filters.sender) {
    try {
      const senderUuid = validateUUID(filters.sender, 'sender');
      params.push(senderUuid);
      where.push(`m.sender_id = $${params.length}::uuid`);
    } catch {
      throw new MessageSearchError(400, 'INVALID_SENDER', 'sender: me | other | <user-uuid>');
    }
  }

  appendDateFilters(where, params, filters.from, filters.to);
  appendContextLinkFilters(
    where,
    params,
    'doctor',
    filters.hasAttachment,
    filters.entityType,
    filters.entityId,
  );

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM doctor_messages m ${whereSql}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  params.push(limit, offset);
  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;

  const dataResult = await pool.query(
    `SELECT m.id,
            m.sender_id,
            m.recipient_id,
            m.group_id,
            m.sender_email,
            m.sender_name,
            m.subject,
            m.message,
            m.created_at,
            m.reply_to_message_id,
            ts_rank(m.search_vector, plainto_tsquery('hungarian', ${qParam})) AS rank,
            ts_headline(
              'hungarian',
              coalesce(m.subject, '') || E'\\n' || coalesce(m.message, ''),
              plainto_tsquery('hungarian', ${qParam}),
              'MaxFragments=2, MaxWords=30, MinWords=8, StartSel=<mark>, StopSel=</mark>'
            ) AS snippet
       FROM doctor_messages m
      ${whereSql}
      ORDER BY rank DESC, m.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  const hits: MessageSearchHit[] = dataResult.rows.map((row) => ({
    id: row.id,
    channel: 'doctor',
    senderId: row.sender_id,
    senderEmail: row.sender_email ?? null,
    senderName: row.sender_name ?? null,
    recipientId: row.recipient_id,
    groupId: row.group_id,
    subject: row.subject,
    message: row.message,
    snippet: row.snippet ?? row.message,
    rank: Number(row.rank) || 0,
    createdAt: new Date(row.created_at),
    replyToMessageId: row.reply_to_message_id ?? null,
  }));

  return { hits, total, limit, offset };
}
