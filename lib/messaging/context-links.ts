/**
 * Fázis 2.0 — message_context_links domain réteg.
 *
 * Egy üzenethez több entitás-link csatolható; jogosultság: az üzenetet és
 * az entitást is látnia kell a kérőnek (admin kivétel ahol máshol is).
 */

import { getDbPool } from '@/lib/db';
import { hasEverTreatedPatient } from '@/lib/patient-doctor-access';
import {
  canPatientReplySenderSeeTarget,
  type PatientReplySender,
} from '@/lib/message-reply';
import { validateUUID } from '@/lib/validation';
import type {
  MessageChannel,
  MessageContextEntityType,
  MessageContextLink,
  MessageContextLinkPreview,
} from '@/lib/types/messaging';
import { recordMessageAuditEvent } from './audit';

const ENTITY_TYPES: MessageContextEntityType[] = [
  'patient',
  'episode',
  'work_phase',
  'appointment',
  'document',
  'consilium_session',
  'task',
];

export class MessageContextError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MessageContextError';
    this.status = status;
    this.code = code;
  }
}

export function parseContextEntityType(value: unknown): MessageContextEntityType {
  if (typeof value !== 'string' || !ENTITY_TYPES.includes(value as MessageContextEntityType)) {
    throw new MessageContextError(
      400,
      'INVALID_ENTITY_TYPE',
      `entityType érvénytelen. Engedélyezett: ${ENTITY_TYPES.join(', ')}`,
    );
  }
  return value as MessageContextEntityType;
}

export function parseContextEntityId(value: unknown): string {
  try {
    return validateUUID(String(value ?? '').trim(), 'entityId');
  } catch {
    throw new MessageContextError(400, 'INVALID_ENTITY_ID', 'entityId érvénytelen UUID');
  }
}

export interface StaffViewer {
  kind: 'staff';
  userId: string;
  role: string;
  email?: string;
}

export interface PatientPortalViewer {
  kind: 'patient_portal';
  patientId: string;
}

export type ContextLinkViewer = StaffViewer | PatientPortalViewer;

interface ResolvedEntity {
  entityType: MessageContextEntityType;
  entityId: string;
  patientId: string | null;
}

async function resolveEntity(
  entityType: MessageContextEntityType,
  entityId: string,
): Promise<ResolvedEntity | null> {
  const pool = getDbPool();

  switch (entityType) {
    case 'patient': {
      const r = await pool.query(`SELECT id FROM patients WHERE id = $1`, [entityId]);
      if (r.rows.length === 0) return null;
      return { entityType, entityId, patientId: entityId };
    }
    case 'episode': {
      const r = await pool.query(
        `SELECT patient_id AS "patientId" FROM patient_episodes WHERE id = $1`,
        [entityId],
      );
      if (r.rows.length === 0) return null;
      return { entityType, entityId, patientId: r.rows[0].patientId };
    }
    case 'work_phase': {
      const r = await pool.query(
        `SELECT pe.patient_id AS "patientId"
           FROM episode_work_phases ewp
           JOIN patient_episodes pe ON pe.id = ewp.episode_id
          WHERE ewp.id = $1`,
        [entityId],
      );
      if (r.rows.length === 0) return null;
      return { entityType, entityId, patientId: r.rows[0].patientId };
    }
    case 'appointment': {
      const r = await pool.query(
        `SELECT patient_id AS "patientId" FROM appointments WHERE id = $1`,
        [entityId],
      );
      if (r.rows.length === 0) return null;
      return { entityType, entityId, patientId: r.rows[0].patientId };
    }
    case 'document': {
      const r = await pool.query(
        `SELECT patient_id AS "patientId" FROM patient_documents WHERE id = $1`,
        [entityId],
      );
      if (r.rows.length === 0) return null;
      return { entityType, entityId, patientId: r.rows[0].patientId };
    }
    case 'consilium_session': {
      const r = await pool.query(`SELECT id FROM consilium_sessions WHERE id = $1`, [entityId]);
      if (r.rows.length === 0) return null;
      return { entityType, entityId, patientId: null };
    }
    case 'task': {
      const r = await pool.query(
        `SELECT patient_id AS "patientId" FROM user_tasks WHERE id = $1`,
        [entityId],
      );
      if (r.rows.length === 0) return null;
      return { entityType, entityId, patientId: r.rows[0].patientId ?? null };
    }
    default:
      return null;
  }
}

async function canViewerAccessPatient(
  viewer: ContextLinkViewer,
  patientId: string,
): Promise<boolean> {
  if (viewer.kind === 'patient_portal') {
    return viewer.patientId === patientId;
  }
  if (viewer.role === 'admin') return true;
  return hasEverTreatedPatient(viewer.userId, patientId);
}

async function canViewerAccessEntity(
  viewer: ContextLinkViewer,
  entity: ResolvedEntity,
): Promise<boolean> {
  if (viewer.kind === 'patient_portal') {
    switch (entity.entityType) {
      case 'patient':
        return entity.entityId === viewer.patientId;
      case 'document':
      case 'appointment':
        return entity.patientId === viewer.patientId;
      default:
        return false;
    }
  }

  if (entity.entityType === 'consilium_session') {
    return true;
  }

  if (entity.entityType === 'task') {
    const pool = getDbPool();
    const r = await pool.query(
      `SELECT assignee_user_id, created_by_user_id, patient_id
         FROM user_tasks WHERE id = $1`,
      [entity.entityId],
    );
    if (r.rows.length === 0) return false;
    const row = r.rows[0];
    if (viewer.role === 'admin') return true;
    if (row.assignee_user_id === viewer.userId) return true;
    if (row.created_by_user_id === viewer.userId) return true;
    if (row.patient_id) {
      return hasEverTreatedPatient(viewer.userId, row.patient_id);
    }
    return true;
  }

  if (entity.patientId) {
    return canViewerAccessPatient(viewer, entity.patientId);
  }

  return viewer.role === 'admin';
}

interface PatientMessageRow {
  id: string;
  patient_id: string;
  sender_type: string;
  sender_id: string;
  recipient_doctor_id: string | null;
}

async function loadPatientMessage(messageId: string): Promise<PatientMessageRow | null> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id, patient_id, sender_type, sender_id, recipient_doctor_id
       FROM messages WHERE id = $1`,
    [messageId],
  );
  return r.rows[0] ?? null;
}

function patientMessageVisibleToSender(
  row: PatientMessageRow,
  sender: PatientReplySender,
  threadPatientId: string,
): boolean {
  return canPatientReplySenderSeeTarget(
    {
      patientId: row.patient_id,
      senderType: row.sender_type as 'doctor' | 'patient',
      senderId: row.sender_id,
      recipientDoctorId: row.recipient_doctor_id,
    },
    sender,
    threadPatientId,
  );
}

async function canViewerAccessPatientMessage(
  viewer: ContextLinkViewer,
  messageId: string,
): Promise<PatientMessageRow | null> {
  const row = await loadPatientMessage(messageId);
  if (!row) return null;

  if (viewer.kind === 'patient_portal') {
    if (row.patient_id !== viewer.patientId) return null;
    const sender: PatientReplySender = {
      kind: 'patient',
      patientId: viewer.patientId,
      laneDoctorId: null,
    };
    if (!patientMessageVisibleToSender(row, sender, viewer.patientId)) return null;
    return row;
  }

  const isAdmin = viewer.role === 'admin';
  if (!isAdmin) {
    const allowed = await hasEverTreatedPatient(viewer.userId, row.patient_id);
    if (!allowed) return null;
  }

  const isTreating = isAdmin
    ? true
    : await hasEverTreatedPatient(viewer.userId, row.patient_id);
  const sender: PatientReplySender = {
    kind: 'doctor',
    doctorId: viewer.userId,
    isAdmin,
    isTreating,
  };
  if (!patientMessageVisibleToSender(row, sender, row.patient_id)) return null;
  return row;
}

interface DoctorMessageRow {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  group_id: string | null;
}

async function canViewerAccessDoctorMessage(
  viewer: ContextLinkViewer,
  messageId: string,
): Promise<DoctorMessageRow | null> {
  if (viewer.kind === 'patient_portal') return null;

  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id, sender_id, recipient_id, group_id FROM doctor_messages WHERE id = $1`,
    [messageId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0] as DoctorMessageRow;

  if (viewer.role === 'admin') return row;

  if (row.group_id) {
    const p = await pool.query(
      `SELECT 1 FROM doctor_message_group_participants
        WHERE group_id = $1 AND user_id = $2`,
      [row.group_id, viewer.userId],
    );
    return p.rows.length > 0 ? row : null;
  }

  if (row.sender_id === viewer.userId || row.recipient_id === viewer.userId) {
    return row;
  }
  return null;
}

async function buildLinkPreview(
  entity: ResolvedEntity,
): Promise<MessageContextLinkPreview | null> {
  const pool = getDbPool();

  switch (entity.entityType) {
    case 'patient': {
      const r = await pool.query(`SELECT nev FROM patients WHERE id = $1`, [entity.entityId]);
      if (!r.rows.length) return null;
      return {
        label: r.rows[0].nev || 'Beteg',
        href: `/patients/${entity.entityId}/view`,
      };
    }
    case 'document': {
      const r = await pool.query(
        `SELECT filename, patient_id FROM patient_documents WHERE id = $1`,
        [entity.entityId],
      );
      if (!r.rows.length) return null;
      return {
        label: r.rows[0].filename,
        href: `/patients/${r.rows[0].patient_id}/view?tab=documents`,
      };
    }
    case 'appointment': {
      const r = await pool.query(
        `SELECT start_time, dentist_email, patient_id
           FROM appointments WHERE id = $1`,
        [entity.entityId],
      );
      if (!r.rows.length) return null;
      const d = r.rows[0].start_time
        ? new Date(r.rows[0].start_time).toLocaleDateString('hu-HU')
        : '';
      return {
        label: `Időpont ${d}`.trim(),
        subtitle: r.rows[0].dentist_email,
        href: `/patients/${r.rows[0].patient_id}/view`,
      };
    }
    case 'episode': {
      const r = await pool.query(
        `SELECT pe.status, p.nev, pe.patient_id
           FROM patient_episodes pe
           JOIN patients p ON p.id = pe.patient_id
          WHERE pe.id = $1`,
        [entity.entityId],
      );
      if (!r.rows.length) return null;
      return {
        label: `Epizód — ${r.rows[0].nev || 'Beteg'}`,
        subtitle: r.rows[0].status,
        href: `/patients/${r.rows[0].patient_id}/view`,
      };
    }
    case 'work_phase': {
      const r = await pool.query(
        `SELECT ewp.work_phase_code, pe.patient_id
           FROM episode_work_phases ewp
           JOIN patient_episodes pe ON pe.id = ewp.episode_id
          WHERE ewp.id = $1`,
        [entity.entityId],
      );
      if (!r.rows.length) return null;
      return {
        label: `Munkafázis: ${r.rows[0].work_phase_code}`,
        href: `/patients/${r.rows[0].patient_id}/view`,
      };
    }
    case 'consilium_session': {
      const r = await pool.query(
        `SELECT title, scheduled_at FROM consilium_sessions WHERE id = $1`,
        [entity.entityId],
      );
      if (!r.rows.length) return null;
      return {
        label: r.rows[0].title,
        subtitle: r.rows[0].scheduled_at
          ? new Date(r.rows[0].scheduled_at).toLocaleString('hu-HU')
          : null,
        href: `/consilium/${entity.entityId}`,
      };
    }
    case 'task': {
      const r = await pool.query(
        `SELECT title, status, patient_id FROM user_tasks WHERE id = $1`,
        [entity.entityId],
      );
      if (!r.rows.length) return null;
      return {
        label: r.rows[0].title,
        subtitle: r.rows[0].status,
        href: r.rows[0].patient_id
          ? `/patients/${r.rows[0].patient_id}/view`
          : '/dashboard',
      };
    }
    default:
      return null;
  }
}

function mapLinkRow(row: Record<string, unknown>): MessageContextLink {
  return {
    id: row.id as string,
    channel: row.channel as MessageChannel,
    messageId: row.messageId as string,
    entityType: row.entityType as MessageContextEntityType,
    entityId: row.entityId as string,
    createdAt: new Date(row.createdAt as string),
    createdBy: row.createdBy as string,
    createdByName: (row.createdByName as string | null) ?? null,
  };
}

export async function getMessageContextLinks(
  channel: MessageChannel,
  messageId: string,
  viewer: ContextLinkViewer,
): Promise<MessageContextLink[]> {
  const messageOk =
    channel === 'patient'
      ? await canViewerAccessPatientMessage(viewer, messageId)
      : await canViewerAccessDoctorMessage(viewer, messageId);

  if (!messageOk) {
    throw new MessageContextError(404, 'MESSAGE_NOT_FOUND', 'Üzenet nem található');
  }

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT mcl.id,
            mcl.channel,
            mcl.message_id AS "messageId",
            mcl.entity_type AS "entityType",
            mcl.entity_id AS "entityId",
            mcl.created_at AS "createdAt",
            mcl.created_by AS "createdBy",
            u.doktor_neve AS "createdByName"
       FROM message_context_links mcl
       LEFT JOIN users u ON u.id = mcl.created_by
      WHERE mcl.channel = $1 AND mcl.message_id = $2
      ORDER BY mcl.created_at ASC`,
    [channel, messageId],
  );

  const links: MessageContextLink[] = [];
  for (const row of result.rows) {
    const link = mapLinkRow(row);
    const entity = await resolveEntity(link.entityType, link.entityId);
    if (!entity || !(await canViewerAccessEntity(viewer, entity))) {
      continue;
    }
    link.preview = await buildLinkPreview(entity);
    links.push(link);
  }
  return links;
}

export async function linkMessageToEntity(
  channel: MessageChannel,
  messageId: string,
  entityType: MessageContextEntityType,
  entityId: string,
  actor: StaffViewer,
): Promise<MessageContextLink> {
  const messageOk =
    channel === 'patient'
      ? await canViewerAccessPatientMessage(actor, messageId)
      : await canViewerAccessDoctorMessage(actor, messageId);

  if (!messageOk) {
    throw new MessageContextError(404, 'MESSAGE_NOT_FOUND', 'Üzenet nem található');
  }

  const entity = await resolveEntity(entityType, entityId);
  if (!entity) {
    throw new MessageContextError(404, 'ENTITY_NOT_FOUND', 'Az entitás nem található');
  }

  if (!(await canViewerAccessEntity(actor, entity))) {
    throw new MessageContextError(403, 'ENTITY_FORBIDDEN', 'Nincs jogosultsága ehhez az entitáshoz');
  }

  const pool = getDbPool();
  try {
    const insert = await pool.query(
      `INSERT INTO message_context_links (
         channel, message_id, entity_type, entity_id, created_by
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, channel, message_id AS "messageId",
                 entity_type AS "entityType", entity_id AS "entityId",
                 created_at AS "createdAt", created_by AS "createdBy"`,
      [channel, messageId, entityType, entityId, actor.userId],
    );

    const link = mapLinkRow(insert.rows[0]);
    const nameResult = await pool.query(
      `SELECT doktor_neve FROM users WHERE id = $1`,
      [actor.userId],
    );
    link.createdByName = nameResult.rows[0]?.doktor_neve ?? null;
    link.preview = await buildLinkPreview(entity);

    void recordMessageAuditEvent({
      messageId,
      channel,
      eventType: 'context_link_added',
      actorUserId: actor.userId,
      payload: {
        linkId: link.id,
        entityType,
        entityId,
      },
    });

    return link;
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '23505') {
      throw new MessageContextError(
        409,
        'CONTEXT_LINK_EXISTS',
        'Ez a link már hozzá van rendelve az üzenethez',
      );
    }
    throw err;
  }
}

export async function unlinkMessageContextLink(
  channel: MessageChannel,
  messageId: string,
  linkId: string,
  actor: StaffViewer,
): Promise<void> {
  const messageOk =
    channel === 'patient'
      ? await canViewerAccessPatientMessage(actor, messageId)
      : await canViewerAccessDoctorMessage(actor, messageId);

  if (!messageOk) {
    throw new MessageContextError(404, 'MESSAGE_NOT_FOUND', 'Üzenet nem található');
  }

  const pool = getDbPool();
  const existing = await pool.query(
    `SELECT id, entity_type, entity_id
       FROM message_context_links
      WHERE id = $1 AND channel = $2 AND message_id = $3`,
    [linkId, channel, messageId],
  );

  if (existing.rows.length === 0) {
    throw new MessageContextError(404, 'LINK_NOT_FOUND', 'A link nem található');
  }

  const row = existing.rows[0];
  const entity = await resolveEntity(row.entity_type, row.entity_id);
  if (entity && !(await canViewerAccessEntity(actor, entity))) {
    throw new MessageContextError(403, 'ENTITY_FORBIDDEN', 'Nincs jogosultsága ehhez a linkhez');
  }

  await pool.query(`DELETE FROM message_context_links WHERE id = $1`, [linkId]);

  void recordMessageAuditEvent({
    messageId,
    channel,
    eventType: 'context_link_removed',
    actorUserId: actor.userId,
    payload: {
      linkId,
      entityType: row.entity_type,
      entityId: row.entity_id,
    },
  });
}

export interface MessageContextLinkRef {
  messageId: string;
  channel: MessageChannel;
  createdAt: Date;
}

export async function getMessagesForEntity(
  channel: MessageChannel,
  entityType: MessageContextEntityType,
  entityId: string,
  viewer: ContextLinkViewer,
  options?: { limit?: number; offset?: number },
): Promise<MessageContextLinkRef[]> {
  const entity = await resolveEntity(entityType, entityId);
  if (!entity) {
    throw new MessageContextError(404, 'ENTITY_NOT_FOUND', 'Az entitás nem található');
  }
  if (!(await canViewerAccessEntity(viewer, entity))) {
    throw new MessageContextError(403, 'ENTITY_FORBIDDEN', 'Nincs jogosultsága ehhez az entitáshoz');
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT mcl.message_id AS "messageId",
            mcl.channel,
            mcl.created_at AS "createdAt"
       FROM message_context_links mcl
      WHERE mcl.channel = $1
        AND mcl.entity_type = $2
        AND mcl.entity_id = $3
      ORDER BY mcl.created_at DESC
      LIMIT $4 OFFSET $5`,
    [channel, entityType, entityId, limit, offset],
  );

  const refs: MessageContextLinkRef[] = [];
  for (const row of result.rows) {
    const messageId = row.messageId as string;
    const ok =
      channel === 'patient'
        ? await canViewerAccessPatientMessage(viewer, messageId)
        : await canViewerAccessDoctorMessage(viewer, messageId);
    if (ok) {
      refs.push({
        messageId,
        channel: row.channel as MessageChannel,
        createdAt: new Date(row.createdAt as string),
      });
    }
  }
  return refs;
}

/** Batch: üzenet ID → látható linkek (listák enrich-eléséhez). */
export async function batchMessageContextLinks(
  channel: MessageChannel,
  messageIds: string[],
  viewer: ContextLinkViewer,
): Promise<Map<string, MessageContextLink[]>> {
  const out = new Map<string, MessageContextLink[]>();
  if (messageIds.length === 0) return out;

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT mcl.id,
            mcl.channel,
            mcl.message_id AS "messageId",
            mcl.entity_type AS "entityType",
            mcl.entity_id AS "entityId",
            mcl.created_at AS "createdAt",
            mcl.created_by AS "createdBy",
            u.doktor_neve AS "createdByName"
       FROM message_context_links mcl
       LEFT JOIN users u ON u.id = mcl.created_by
      WHERE mcl.channel = $1 AND mcl.message_id = ANY($2::uuid[])
      ORDER BY mcl.created_at ASC`,
    [channel, messageIds],
  );

  for (const row of result.rows) {
    const link = mapLinkRow(row);
    const entity = await resolveEntity(link.entityType, link.entityId);
    if (!entity || !(await canViewerAccessEntity(viewer, entity))) continue;

    link.preview = await buildLinkPreview(entity);
    const list = out.get(link.messageId) ?? [];
    list.push(link);
    out.set(link.messageId, list);
  }
  return out;
}
