import { getDbPool } from '@/lib/db';
import { loadPatientCareTimeline } from '@/lib/consilium-presentation';
import { normalizeChecklist, type ChecklistEntry } from '@/lib/consilium';
import { logger } from '@/lib/logger';
import type {
  CareTimelineEvent,
  CareTimelineEpisodeSummary,
  PatientCareTimelineResponse,
} from '@/lib/types/patient-care-timeline';

const MAX_EVENTS_PER_PATIENT = 200;
const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

const MILESTONE_LABELS: Record<string, string> = {
  OFFER_ACCEPTED: 'Árajánlat elfogadva',
  DELIVERY_DONE: 'Átadás megtörtént',
  NO_SURGICAL_PHASE: 'Nincs sebészi fázis',
  SURG_IMPLANT_PLACED: 'Implantátum beültetve',
  SURG_OSSEOINTEGRATED: 'Osteointegráció',
};

const TASK_SOURCE_LABELS: Record<string, string> = {
  consilium_checklist: 'Konzílium',
  work_phase: 'Munkafázis',
  tooth_treatment: 'Fogkezelés',
};

type EpisodeRef = {
  id: string;
  status: string;
  reason: string | null;
  chiefComplaint: string | null;
  caseTitle: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
};

function iso(d: Date | string | null | undefined): string {
  if (d == null) return new Date(0).toISOString();
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? new Date(0).toISOString() : x.toISOString();
}

function withinRetention(at: Date): boolean {
  return Date.now() - at.getTime() <= TWO_YEARS_MS;
}

/** Exported for tests. */
export function pickEpisodeIdForDate(episodes: EpisodeRef[], at: Date): string | null {
  if (episodes.length === 0) return null;
  const ts = at.getTime();
  const covering = episodes.find((e) => {
    const o = e.openedAt?.getTime() ?? 0;
    const c = e.closedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return ts >= o && ts <= c;
  });
  if (covering) return covering.id;
  const open = episodes.find((e) => e.status === 'open');
  if (open) return open.id;
  return episodes[0]?.id ?? null;
}

function summarizeVerdicts(checklist: ChecklistEntry[]): string | null {
  const parts = checklist
    .map((e) => (e.response || '').trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const joined = parts.join(' · ');
  return joined.length > 240 ? `${joined.slice(0, 237)}…` : joined;
}

function milestoneLabel(code: string): string {
  return MILESTONE_LABELS[code] ?? code.replace(/_/g, ' ');
}

function taskSourceLabel(source: string | null): string | null {
  if (!source) return null;
  return TASK_SOURCE_LABELS[source] ?? source;
}

/** Exported for tests. */
export function sortEventsNewestFirst(events: CareTimelineEvent[]): CareTimelineEvent[] {
  return [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function truncateEvents(events: CareTimelineEvent[]): CareTimelineEvent[] {
  const sorted = sortEventsNewestFirst(events);
  if (sorted.length <= MAX_EVENTS_PER_PATIENT) return sorted;
  return sorted.slice(0, MAX_EVENTS_PER_PATIENT);
}

async function loadEpisodeRefs(patientId: string): Promise<EpisodeRef[]> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id, status, reason,
            chief_complaint as "chiefComplaint",
            case_title as "caseTitle",
            opened_at as "openedAt",
            closed_at as "closedAt"
     FROM patient_episodes
     WHERE patient_id = $1::uuid
     ORDER BY COALESCE(opened_at, created_at) DESC NULLS LAST`,
    [patientId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    status: String(row.status),
    reason: row.reason != null ? String(row.reason) : null,
    chiefComplaint: row.chiefComplaint != null ? String(row.chiefComplaint) : null,
    caseTitle: row.caseTitle != null ? String(row.caseTitle) : null,
    openedAt: row.openedAt instanceof Date ? row.openedAt : row.openedAt ? new Date(row.openedAt) : null,
    closedAt: row.closedAt instanceof Date ? row.closedAt : row.closedAt ? new Date(row.closedAt) : null,
  }));
}

async function loadStageChangeEvents(patientId: string, episodes: EpisodeRef[]): Promise<CareTimelineEvent[]> {
  const stageEpisodes = await loadPatientCareTimeline(patientId);
  const events: CareTimelineEvent[] = [];
  for (const ep of stageEpisodes) {
    for (const st of ep.stages) {
      const at = new Date(st.at);
      if (!withinRetention(at)) continue;
      events.push({
        id: `stage:${st.id}`,
        type: 'stage_change',
        at: st.at,
        episodeId: ep.id,
        payload: {
          stageCode: st.stageCode,
          stageLabel: st.stageLabel,
          note: st.note,
          authorDisplay: st.authorDisplay,
        },
      });
    }
  }
  for (const ev of events) {
    if (!ev.episodeId) {
      ev.episodeId = pickEpisodeIdForDate(episodes, new Date(ev.at));
    }
  }
  return events;
}

async function loadConsiliumEvents(
  patientId: string,
  episodes: EpisodeRef[],
): Promise<CareTimelineEvent[]> {
  const pool = getDbPool();
  const tableCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'consilium_session_items'`,
  );
  if (tableCheck.rows.length === 0) return [];

  const r = await pool.query(
    `SELECT csi.id as "itemId", csi.session_id as "sessionId", csi.discussed, csi.checklist,
            csi.created_at as "itemCreatedAt",
            cs.title, cs.scheduled_at as "scheduledAt", cs.status as "sessionStatus"
     FROM consilium_session_items csi
     JOIN consilium_sessions cs ON cs.id = csi.session_id
     WHERE csi.patient_id = $1::uuid
     ORDER BY cs.scheduled_at DESC
     LIMIT 80`,
    [patientId],
  );

  const events: CareTimelineEvent[] = [];
  for (const row of r.rows) {
    const scheduledAt = row.scheduledAt instanceof Date ? row.scheduledAt : new Date(row.scheduledAt);
    if (!withinRetention(scheduledAt)) continue;
    const checklist = normalizeChecklist(row.checklist);
    const episodeId = pickEpisodeIdForDate(episodes, scheduledAt);
    events.push({
      id: `consilium:${row.itemId}`,
      type: 'consilium',
      at: iso(scheduledAt),
      episodeId,
      payload: {
        sessionId: String(row.sessionId),
        itemId: String(row.itemId),
        title: String(row.title),
        sessionStatus: String(row.sessionStatus),
        scheduledAt: iso(scheduledAt),
        discussed: Boolean(row.discussed),
        verdictSummary: summarizeVerdicts(checklist),
      },
    });
  }
  return events;
}

async function loadConsiliumPrepEvents(
  patientId: string,
  episodes: EpisodeRef[],
): Promise<CareTimelineEvent[]> {
  const pool = getDbPool();
  const tableCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'consilium_prep_comments'`,
  );
  if (tableCheck.rows.length === 0) return [];

  const r = await pool.query(
    `SELECT cpc.id, cpc.item_id as "itemId", cpc.checklist_key as "checklistKey",
            cpc.body, cpc.author_display as "authorDisplay", cpc.created_at as "createdAt",
            csi.session_id as "sessionId"
     FROM consilium_prep_comments cpc
     JOIN consilium_session_items csi ON csi.id = cpc.item_id
     WHERE csi.patient_id = $1::uuid
     ORDER BY cpc.created_at DESC
     LIMIT 100`,
    [patientId],
  );

  return r.rows
    .map((row) => {
      const at = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      if (!withinRetention(at)) return null;
      return {
        id: `consilium_prep:${row.id}`,
        type: 'consilium_prep' as const,
        at: iso(at),
        episodeId: pickEpisodeIdForDate(episodes, at),
        payload: {
          sessionId: String(row.sessionId),
          itemId: String(row.itemId),
          checklistKey: String(row.checklistKey),
          body: String(row.body),
          authorDisplay: row.authorDisplay != null ? String(row.authorDisplay) : null,
        },
      };
    })
    .filter((e): e is CareTimelineEvent => e != null);
}

async function loadDelegatedTaskEvents(
  patientId: string,
  episodes: EpisodeRef[],
): Promise<CareTimelineEvent[]> {
  const pool = getDbPool();
  const tableCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_tasks'`,
  );
  if (tableCheck.rows.length === 0) return [];

  const r = await pool.query(
    `SELECT t.id, t.title, t.status, t.metadata, t.created_at as "createdAt", t.completed_at as "completedAt",
            COALESCE(NULLIF(btrim(au.doktor_neve), ''), NULLIF(btrim(au.email), '')) as "assigneeName"
     FROM user_tasks t
     LEFT JOIN users au ON au.id = t.assignee_user_id
     WHERE t.patient_id = $1::uuid
       AND t.task_type IN ('meeting_action', 'manual', 'document_upload')
     ORDER BY COALESCE(t.completed_at, t.created_at) DESC
     LIMIT 80`,
    [patientId],
  );

  const events: CareTimelineEvent[] = [];
  for (const row of r.rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const episodeFromMeta =
      typeof meta.episodeId === 'string'
        ? meta.episodeId
        : typeof meta.episode_id === 'string'
          ? meta.episode_id
          : null;
    const atRaw = row.completedAt ?? row.createdAt;
    const at = atRaw instanceof Date ? atRaw : new Date(atRaw);
    if (!withinRetention(at)) continue;
    const source = typeof meta.source === 'string' ? meta.source : null;
    const episodeId =
      episodeFromMeta || pickEpisodeIdForDate(episodes, at);
    events.push({
      id: `task:${row.id}`,
      type: 'delegated_task',
      at: iso(at),
      episodeId,
      payload: {
        taskId: String(row.id),
        title: String(row.title),
        status: String(row.status),
        source: taskSourceLabel(source),
        assigneeName: row.assigneeName != null ? String(row.assigneeName) : null,
        presentationPath:
          typeof meta.presentationPath === 'string' ? meta.presentationPath : null,
        consiliumSessionId:
          typeof meta.consiliumSessionId === 'string' ? meta.consiliumSessionId : null,
      },
    });
  }
  return events;
}

async function loadMilestoneEvents(patientId: string): Promise<CareTimelineEvent[]> {
  const pool = getDbPool();
  const tableCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_milestones'`,
  );
  if (tableCheck.rows.length === 0) return [];

  const r = await pool.query(
    `SELECT id, episode_id as "episodeId", code, at, note
     FROM patient_milestones
     WHERE patient_id = $1::uuid
     ORDER BY at DESC
     LIMIT 80`,
    [patientId],
  );

  return r.rows
    .map((row) => {
      const at = row.at instanceof Date ? row.at : new Date(row.at);
      if (!withinRetention(at)) return null;
      return {
        id: `milestone:${row.id}`,
        type: 'milestone' as const,
        at: iso(at),
        episodeId: row.episodeId != null ? String(row.episodeId) : null,
        payload: {
          code: String(row.code),
          label: milestoneLabel(String(row.code)),
          note: row.note != null ? String(row.note) : null,
        },
      };
    })
    .filter((e): e is CareTimelineEvent => e != null);
}

async function loadWorkPhaseEvents(patientId: string): Promise<CareTimelineEvent[]> {
  const pool = getDbPool();
  const tableCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'episode_work_phases'`,
  );
  if (tableCheck.rows.length === 0) return [];

  const r = await pool.query(
    `SELECT ewp.id, ewp.episode_id as "episodeId", ewp.work_phase_code as "workPhaseCode",
            ewp.status, ewp.completed_at as "completedAt", ewp.created_at as "createdAt",
            COALESCE(NULLIF(btrim(ewp.custom_label), ''), wpc.label_hu, ewp.work_phase_code) as label
     FROM episode_work_phases ewp
     JOIN patient_episodes pe ON pe.id = ewp.episode_id
     LEFT JOIN work_phase_catalog wpc ON wpc.work_phase_code = ewp.work_phase_code
     WHERE pe.patient_id = $1::uuid
       AND ewp.status IN ('completed', 'skipped')
     ORDER BY COALESCE(ewp.completed_at, ewp.created_at) DESC
     LIMIT 80`,
    [patientId],
  );

  return r.rows
    .map((row) => {
      const atRaw = row.completedAt ?? row.createdAt;
      const at = atRaw instanceof Date ? atRaw : new Date(atRaw);
      if (!withinRetention(at)) return null;
      const status = row.status === 'skipped' ? 'skipped' : 'completed';
      return {
        id: `work_phase:${row.id}`,
        type: 'work_phase' as const,
        at: iso(at),
        episodeId: String(row.episodeId),
        payload: {
          workPhaseId: String(row.id),
          workPhaseCode: String(row.workPhaseCode),
          label: String(row.label),
          status,
        },
      };
    })
    .filter((e): e is CareTimelineEvent => e != null);
}

async function loadPrepLinkEvents(
  patientId: string,
  episodes: EpisodeRef[],
): Promise<CareTimelineEvent[]> {
  const pool = getDbPool();
  const tableCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'doctor_messages'`,
  );
  if (tableCheck.rows.length === 0) return [];

  const r = await pool.query(
    `SELECT dm.id, dm.message, dm.created_at as "createdAt",
            COALESCE(NULLIF(btrim(u.doktor_neve), ''), NULLIF(btrim(dm.sender_name), '')) as "senderName"
     FROM doctor_messages dm
     LEFT JOIN users u ON u.id = dm.sender_id
     WHERE dm.message LIKE '%[CONSILIUM_PREP:%'
       AND dm.mentioned_patient_ids IS NOT NULL
       AND dm.mentioned_patient_ids != '[]'::jsonb
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(dm.mentioned_patient_ids) AS elem
         WHERE elem = $1
       )
     ORDER BY dm.created_at DESC
     LIMIT 40`,
    [patientId],
  );

  const tokenRe = /\[CONSILIUM_PREP:([A-Za-z0-9_-]+)\]/;
  const events: CareTimelineEvent[] = [];
  for (const row of r.rows) {
    const msg = String(row.message ?? '');
    const m = msg.match(tokenRe);
    if (!m) continue;
    const token = m[1];
    const at = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    if (!withinRetention(at)) continue;
    events.push({
      id: `prep_link:${row.id}`,
      type: 'consilium_prep_link',
      at: iso(at),
      episodeId: pickEpisodeIdForDate(episodes, at),
      payload: {
        messageId: String(row.id),
        token,
        prepUrl: `/consilium/prep/${token}`,
        senderName: row.senderName != null ? String(row.senderName) : null,
      },
    });
  }
  return events;
}

function groupByEpisode(
  episodes: EpisodeRef[],
  flatEvents: CareTimelineEvent[],
): CareTimelineEpisodeSummary[] {
  const byEp = new Map<string, CareTimelineEvent[]>();
  const unassigned: CareTimelineEvent[] = [];

  for (const ev of flatEvents) {
    const eid = ev.episodeId;
    if (!eid) {
      unassigned.push(ev);
      continue;
    }
    const list = byEp.get(eid) ?? [];
    list.push(ev);
    byEp.set(eid, list);
  }

  const summaries: CareTimelineEpisodeSummary[] = episodes.map((ep) => ({
    episodeId: ep.id,
    reason: ep.reason,
    status: ep.status,
    chiefComplaint: ep.chiefComplaint,
    caseTitle: ep.caseTitle,
    openedAt: ep.openedAt ? iso(ep.openedAt) : null,
    closedAt: ep.closedAt ? iso(ep.closedAt) : null,
    events: sortEventsNewestFirst(byEp.get(ep.id) ?? []),
  }));

  for (const [eid, evs] of byEp.entries()) {
    if (episodes.some((e) => e.id === eid)) continue;
    summaries.push({
      episodeId: eid,
      reason: null,
      status: null,
      chiefComplaint: 'Ismeretlen epizód',
      caseTitle: null,
      openedAt: null,
      closedAt: null,
      events: sortEventsNewestFirst(evs),
    });
  }

  if (unassigned.length > 0) {
    const openId = episodes.find((e) => e.status === 'open')?.id ?? episodes[0]?.id;
    if (openId) {
      const target = summaries.find((s) => s.episodeId === openId);
      if (target) {
        target.events = sortEventsNewestFirst([...target.events, ...unassigned]);
      }
    }
  }

  summaries.sort((a, b) => {
    const latest = (s: CareTimelineEpisodeSummary) =>
      s.events[0] ? new Date(s.events[0].at).getTime() : s.openedAt ? new Date(s.openedAt).getTime() : 0;
    return latest(b) - latest(a);
  });

  return summaries.filter((s) => s.events.length > 0 || episodes.some((e) => e.id === s.episodeId));
}

export async function buildPatientCareTimeline(patientId: string): Promise<PatientCareTimelineResponse> {
  try {
    const episodes = await loadEpisodeRefs(patientId);
    const [
      stageEvents,
      consiliumEvents,
      prepEvents,
      taskEvents,
      milestoneEvents,
      workPhaseEvents,
      prepLinkEvents,
    ] = await Promise.all([
      loadStageChangeEvents(patientId, episodes),
      loadConsiliumEvents(patientId, episodes),
      loadConsiliumPrepEvents(patientId, episodes),
      loadDelegatedTaskEvents(patientId, episodes),
      loadMilestoneEvents(patientId),
      loadWorkPhaseEvents(patientId),
      loadPrepLinkEvents(patientId, episodes),
    ]);

    const flat = truncateEvents([
      ...stageEvents,
      ...consiliumEvents,
      ...prepEvents,
      ...taskEvents,
      ...milestoneEvents,
      ...workPhaseEvents,
      ...prepLinkEvents,
    ]);

    const grouped = groupByEpisode(episodes, flat);

    const stageOnly = flat
      .filter((e): e is CareTimelineEvent & { type: 'stage_change' } => e.type === 'stage_change')
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    const latestStage = stageOnly[0];
    const currentStage = latestStage
      ? {
          episodeId: latestStage.episodeId ?? '',
          stageCode: latestStage.payload.stageCode,
          stageLabel: latestStage.payload.stageLabel,
          at: latestStage.at,
          note: latestStage.payload.note,
        }
      : null;

    return {
      patientId,
      episodes: grouped,
      currentStage: currentStage?.episodeId ? currentStage : null,
    };
  } catch (e) {
    logger.warn('[patient-care-timeline] build failed', { patientId, error: String(e) });
    return { patientId, episodes: [], currentStage: null };
  }
}
