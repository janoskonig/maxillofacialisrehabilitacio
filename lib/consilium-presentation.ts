import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getBnoKodToNevMap, resolveBnoFieldToHungarianLabels } from '@/lib/bno-codes-data';
import { normalizeChecklist, normalizeSessionAttendees, type ChecklistEntry } from '@/lib/consilium';
import { patientStageOptions } from '@/lib/types/episode';

const OP_TAG_FILTER = `(
  tags @> '["orthopantomogram"]'::jsonb
  OR tags @> '["OP"]'::jsonb
  OR tags::text ILIKE '%orthopantomogram%'
  OR tags::text ILIKE '%"OP"%'
)`;

const FOTO_TAG_FILTER = `(
  tags @> '["foto"]'::jsonb
  OR tags::text ILIKE '%"foto"%'
  OR tags::text ILIKE '%foto%'
)`;

function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith('image/');
}

type PatientDocRow = {
  id: string;
  mimeType: string | null;
  filename: string | null;
  uploadedAt: Date | null;
};

export type MediaPreviewItem = {
  documentId: string;
  previewUrl: string;
  filename: string | null;
  uploadedAt: string | null;
};

type MediaBucketSummary = {
  totalCount: number;
  imageCount: number;
  previews: MediaPreviewItem[];
};

const MAX_TIMELINE_STAGE_ROWS = 500;

export type PresentationTimelineStage = {
  id: string;
  stageCode: string;
  stageLabel: string;
  at: string;
  note: string | null;
  authorDisplay: string | null;
  source: 'stage_events' | 'patient_stages';
};

export type PresentationTimelineEpisode = {
  id: string;
  reason: string | null;
  status: string | null;
  chiefComplaint: string | null;
  caseTitle: string | null;
  openedAt: string | null;
  closedAt: string | null;
  episodeCreatedBy: string | null;
  stages: PresentationTimelineStage[];
};

export type PatientPresentationSummary = {
  patientId: string;
  visible: boolean;
  missingPatient: boolean;
  name: string | null;
  taj: string | null;
  birthYear: number | null;
  age: number | null;
  diagnozis: string | null;
  bnoDescription: string | null;
  beutaloOrvos: string | null;
  beutaloIntezmeny: string | null;
  tnmStaging: string | null;
  episodeLabel: string | null;
  stage: {
    stageCode: string | null;
    stageLabel: string | null;
    stageDate: string | null;
    notes: string | null;
    episodeId: string | null;
  } | null;
  meglevoFogak: Record<string, unknown>;
  meglevoImplantatumok: Record<string, string>;
  nemIsmertPoziciokbanImplantatum: boolean;
  nemIsmertPoziciokbanImplantatumReszletek: string | null;
  /** Epizódok és stádium napló (vetítés bal oszlop); üres tömb, ha nincs adat vagy hiba. */
  careTimeline: PresentationTimelineEpisode[];
};

export type ItemMediaSummary = {
  opPreview: MediaBucketSummary;
  photoPreview: MediaBucketSummary;
  error: string | null;
};

function parseJsonObjectRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as unknown;
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        return j as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

function ageFromBirthDate(birth: Date | null | undefined): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function legacyHungarianStageLabel(code: string): string {
  const o = patientStageOptions.find((x) => x.value === code);
  return o?.label ?? code;
}

function isoDate(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString();
}

async function loadPatientCareTimeline(patientId: string): Promise<PresentationTimelineEpisode[]> {
  const pool = getDbPool();
  try {
    const tCheck = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('patient_episodes', 'stage_events', 'patient_stages')`,
    );
    const names = new Set(tCheck.rows.map((r) => r.table_name));
    if (!names.has('patient_episodes')) return [];

    const epResult = await pool.query(
      `SELECT id, reason, status,
              chief_complaint as "chiefComplaint",
              case_title as "caseTitle",
              opened_at as "openedAt",
              closed_at as "closedAt",
              created_by as "createdBy"
       FROM patient_episodes
       WHERE patient_id = $1::uuid
       ORDER BY COALESCE(opened_at, created_at) DESC NULLS LAST`,
      [patientId],
    );

    type RawEv = {
      id: string;
      episodeId: string;
      stageCode: string;
      stageLabel: string | null;
      at: Date;
      note: string | null;
      authorDisplay: string | null;
      source: 'stage_events' | 'patient_stages';
    };

    const newEvents: RawEv[] = [];
    const episodeIdsWithNew = new Set<string>();

    if (names.has('stage_events')) {
      const se = await pool.query(
        `SELECT se.id, se.episode_id as "episodeId", se.stage_code as "stageCode",
                se.at, se.note,
                sc.label_hu as "stageLabel",
                COALESCE(NULLIF(btrim(u.doktor_neve), ''), NULLIF(btrim(se.created_by), '')) as "authorDisplay"
         FROM stage_events se
         JOIN patient_episodes e ON e.id = se.episode_id
         LEFT JOIN stage_catalog sc ON sc.code = se.stage_code AND sc.reason = e.reason
         LEFT JOIN users u ON lower(btrim(u.email)) = lower(btrim(se.created_by))
         WHERE se.patient_id = $1::uuid
         ORDER BY se.at ASC`,
        [patientId],
      );
      for (const row of se.rows) {
        episodeIdsWithNew.add(row.episodeId);
        newEvents.push({
          id: String(row.id),
          episodeId: row.episodeId,
          stageCode: String(row.stageCode),
          stageLabel: row.stageLabel ? String(row.stageLabel) : null,
          at: row.at instanceof Date ? row.at : new Date(row.at),
          note: row.note != null ? String(row.note) : null,
          authorDisplay: row.authorDisplay != null ? String(row.authorDisplay) : null,
          source: 'stage_events',
        });
      }
    }

    const legacyEvents: RawEv[] = [];
    if (names.has('patient_stages')) {
      const ps = await pool.query(
        `SELECT ps.id, ps.episode_id as "episodeId", ps.stage as "stageCode",
                ps.stage_date as "at", ps.notes as "note",
                COALESCE(NULLIF(btrim(u.doktor_neve), ''), NULLIF(btrim(ps.created_by), '')) as "authorDisplay"
         FROM patient_stages ps
         LEFT JOIN users u ON lower(btrim(u.email)) = lower(btrim(ps.created_by))
         WHERE ps.patient_id = $1::uuid
           AND ps.episode_id IS NOT NULL
         ORDER BY ps.stage_date ASC`,
        [patientId],
      );
      for (const row of ps.rows) {
        const eid = row.episodeId as string;
        if (episodeIdsWithNew.has(eid)) continue;
        const at = row.at instanceof Date ? row.at : new Date(row.at);
        legacyEvents.push({
          id: String(row.id),
          episodeId: eid,
          stageCode: String(row.stageCode),
          stageLabel: legacyHungarianStageLabel(String(row.stageCode)),
          at,
          note: row.note != null ? String(row.note) : null,
          authorDisplay: row.authorDisplay != null ? String(row.authorDisplay) : null,
          source: 'patient_stages',
        });
      }
    }

    let combined = [...newEvents, ...legacyEvents];
    if (combined.length > MAX_TIMELINE_STAGE_ROWS) {
      combined.sort((a, b) => b.at.getTime() - a.at.getTime());
      combined = combined.slice(0, MAX_TIMELINE_STAGE_ROWS);
      logger.warn('[consilium-presentation] timeline truncated', {
        patientId,
        kept: MAX_TIMELINE_STAGE_ROWS,
      });
    }
    combined.sort((a, b) => a.at.getTime() - b.at.getTime());

    const byEp = new Map<string, RawEv[]>();
    for (const ev of combined) {
      const list = byEp.get(ev.episodeId) ?? [];
      list.push(ev);
      byEp.set(ev.episodeId, list);
    }

    const toStage = (ev: RawEv): PresentationTimelineStage => ({
      id: ev.id,
      stageCode: ev.stageCode,
      stageLabel: (ev.stageLabel && ev.stageLabel.trim()) || ev.stageCode,
      at: isoDate(ev.at) ?? new Date(0).toISOString(),
      note: ev.note,
      authorDisplay: ev.authorDisplay,
      source: ev.source,
    });

    const episodeRows: PresentationTimelineEpisode[] = [];
    const seenEp = new Set<string>();

    const pushEpisode = (
      row: {
        id: string;
        reason: unknown;
        status: unknown;
        chiefComplaint: unknown;
        caseTitle: unknown;
        openedAt: unknown;
        closedAt: unknown;
        createdBy: unknown;
      },
      stages: RawEv[],
    ) => {
      seenEp.add(row.id);
      episodeRows.push({
        id: row.id,
        reason: row.reason != null ? String(row.reason) : null,
        status: row.status != null ? String(row.status) : null,
        chiefComplaint: row.chiefComplaint != null ? String(row.chiefComplaint) : null,
        caseTitle: row.caseTitle != null ? String(row.caseTitle) : null,
        openedAt: isoDate(row.openedAt as Date | null),
        closedAt: isoDate(row.closedAt as Date | null),
        episodeCreatedBy: row.createdBy != null ? String(row.createdBy) : null,
        stages: stages.map(toStage),
      });
    };

    for (const row of epResult.rows) {
      pushEpisode(row, byEp.get(row.id) ?? []);
    }

    for (const [eid, stages] of Array.from(byEp.entries())) {
      if (seenEp.has(eid)) continue;
      pushEpisode(
        {
          id: eid,
          reason: null,
          status: null,
          chiefComplaint: 'Régi stádium napló (epizód részletei nem elérhetők)',
          caseTitle: null,
          openedAt: null,
          closedAt: null,
          createdBy: null,
        },
        stages,
      );
    }

    const latestTs = (ep: PresentationTimelineEpisode) => {
      let t = ep.openedAt ? new Date(ep.openedAt).getTime() : 0;
      for (const s of ep.stages) t = Math.max(t, new Date(s.at).getTime());
      return t;
    };
    episodeRows.sort((a, b) => latestTs(b) - latestTs(a));

    return episodeRows;
  } catch (e) {
    logger.warn('[consilium-presentation] care timeline failed', { patientId, error: String(e) });
    return [];
  }
}

async function latestStageSummary(patientId: string): Promise<{
  stageCode: string | null;
  stageLabel: string | null;
  stageDate: string | null;
  notes: string | null;
  episodeId: string | null;
}> {
  const pool = getDbPool();
  try {
    const hasTable = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`,
    );
    if (hasTable.rows.length > 0) {
      const r = await pool.query(
        `SELECT
           se.stage_code as "stageCode",
           se.at as "stageDate",
           se.note as "notes",
           se.episode_id as "episodeId",
           sc.label_hu as "stageLabel"
         FROM stage_events se
         JOIN patient_episodes e ON e.id = se.episode_id
         JOIN stage_catalog sc ON sc.code = se.stage_code AND sc.reason = e.reason
         WHERE se.patient_id = $1
         ORDER BY se.at DESC
         LIMIT 1`,
        [patientId],
      );
      if (r.rows.length > 0) {
        const row = r.rows[0];
        return {
          stageCode: row.stageCode ?? null,
          stageLabel: row.stageLabel ?? null,
          stageDate: row.stageDate?.toISOString?.() ?? null,
          notes: row.notes ?? null,
          episodeId: row.episodeId ?? null,
        };
      }
    }
  } catch (e) {
    logger.warn('[consilium-presentation] stage_events lookup failed', { patientId, error: String(e) });
  }

  try {
    const legacy = await pool.query(
      `SELECT episode_id as "episodeId", stage as "stageCode", stage_date as "stageDate", notes
       FROM patient_current_stage
       WHERE patient_id = $1
       LIMIT 1`,
      [patientId],
    );
    if (legacy.rows.length > 0) {
      const row = legacy.rows[0];
      return {
        stageCode: row.stageCode ?? null,
        stageLabel: null,
        stageDate: row.stageDate?.toISOString?.() ?? null,
        notes: row.notes ?? null,
        episodeId: row.episodeId ?? null,
      };
    }
  } catch {
    // patient_current_stage may not exist
  }

  return { stageCode: null, stageLabel: null, stageDate: null, notes: null, episodeId: null };
}

async function mediaSummaryForPatient(patientId: string) {
  const pool = getDbPool();
  const imageClause = `mime_type IS NOT NULL AND mime_type ILIKE 'image/%'`;
  const [opList, fotoList] = await Promise.all([
    pool.query(
      `SELECT id, mime_type as "mimeType", filename, uploaded_at as "uploadedAt"
       FROM patient_documents
       WHERE patient_id = $1 AND ${imageClause} AND ${OP_TAG_FILTER}
       ORDER BY uploaded_at DESC
       LIMIT 50`,
      [patientId],
    ),
    pool.query(
      `SELECT id, mime_type as "mimeType", filename, uploaded_at as "uploadedAt"
       FROM patient_documents
       WHERE patient_id = $1 AND ${imageClause} AND ${FOTO_TAG_FILTER}
       ORDER BY uploaded_at DESC
       LIMIT 50`,
      [patientId],
    ),
  ]);

  const mapPreview = (rows: PatientDocRow[]) =>
    rows
      .filter((r) => isImageMime(r.mimeType))
      .slice(0, 4)
      .map((r) => ({
        documentId: r.id,
        previewUrl: `/api/patients/${patientId}/documents/${r.id}?inline=true`,
        filename: r.filename,
        uploadedAt: r.uploadedAt?.toISOString?.() ?? null,
      }));

  return {
    op: {
      totalCount: opList.rows.length,
      imageCount: opList.rows.filter((r) => isImageMime(r.mimeType)).length,
      previews: mapPreview(opList.rows),
    },
    foto: {
      totalCount: fotoList.rows.length,
      imageCount: fotoList.rows.filter((r) => isImageMime(r.mimeType)).length,
      previews: mapPreview(fotoList.rows),
    },
  };
}

export async function buildConsiliumPresentationPayload(sessionId: string, institutionId: string) {
  const pool = getDbPool();
  const bnoMap = getBnoKodToNevMap();

  const sessionResult = await pool.query(
    `SELECT id, title, institution_id as "institutionId", scheduled_at as "scheduledAt", status, attendees
     FROM consilium_sessions
     WHERE id = $1::uuid
       AND btrim(coalesce(institution_id, '')) = btrim(coalesce($2::text, ''))`,
    [sessionId, institutionId],
  );
  if (sessionResult.rows.length === 0) {
    return null;
  }
  const session = {
    ...sessionResult.rows[0],
    attendees: normalizeSessionAttendees(sessionResult.rows[0].attendees),
  };

  const itemsResult = await pool.query(
    `SELECT
       i.id,
       i.session_id as "sessionId",
       i.patient_id as "patientId",
       i.sort_order as "sortOrder",
       i.discussed,
       i.checklist
     FROM consilium_session_items i
     WHERE i.session_id = $1
     ORDER BY i.sort_order ASC`,
    [sessionId],
  );

  const items: {
    id: string;
    sortOrder: number;
    patientId: string;
    discussionState: { discussed: boolean; checklist: ChecklistEntry[] };
    patientSummary: PatientPresentationSummary;
    mediaSummary: ItemMediaSummary;
  }[] = [];
  for (const row of itemsResult.rows) {
    const patientId = row.patientId as string;
    let patientSummary: PatientPresentationSummary = {
      patientId,
      visible: false,
      missingPatient: true,
      name: null,
      taj: null,
      birthYear: null,
      age: null,
      diagnozis: null,
      bnoDescription: null,
      beutaloOrvos: null,
      beutaloIntezmeny: null,
      tnmStaging: null,
      episodeLabel: null,
      stage: null,
      meglevoFogak: {},
      meglevoImplantatumok: {},
      nemIsmertPoziciokbanImplantatum: false,
      nemIsmertPoziciokbanImplantatumReszletek: null,
      careTimeline: [],
    };

    try {
      const p = await pool.query(
        `SELECT
           pf.id,
           pf.nev,
           pf.taj,
           pf.szuletesi_datum as "szuletesiDatum",
           pf.diagnozis,
           pf.bno,
           pf.tnm_staging as "tnmStaging",
           pf.beutalo_orvos as "beutaloOrvos",
           pf.beutalo_intezmeny as "beutaloIntezmeny",
           pf.meglevo_fogak as "meglevoFogak",
           pf.meglevo_implantatumok as "meglevoImplantatumok",
           pf.nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
           pf.nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumReszletek"
         FROM patients_full pf
         WHERE pf.id = $1`,
        [patientId],
      );
      if (p.rows.length > 0) {
        const rowP = p.rows[0];
        const birth = rowP.szuletesiDatum ? new Date(rowP.szuletesiDatum) : null;
        const [stage, careTimeline] = await Promise.all([
          latestStageSummary(patientId),
          loadPatientCareTimeline(patientId),
        ]);
        const episodeLabel =
          careTimeline[0] != null
            ? [careTimeline[0].reason, careTimeline[0].status].filter(Boolean).join(' · ') || null
            : null;
        const bnoDescription = resolveBnoFieldToHungarianLabels(rowP.bno, bnoMap);
        const fogRaw = parseJsonObjectRecord(rowP.meglevoFogak);
        const implantRaw = parseJsonObjectRecord(rowP.meglevoImplantatumok);
        const meglevoImplantatumok: Record<string, string> = {};
        for (const [k, v] of Object.entries(implantRaw)) {
          meglevoImplantatumok[k] = typeof v === 'string' ? v : v != null ? String(v) : '';
        }
        patientSummary = {
          patientId,
          visible: true,
          missingPatient: false,
          name: rowP.nev ?? null,
          taj: rowP.taj ?? null,
          birthYear: birth && !Number.isNaN(birth.getTime()) ? birth.getFullYear() : null,
          age: ageFromBirthDate(birth),
          diagnozis: rowP.diagnozis ?? null,
          bnoDescription,
          beutaloOrvos: rowP.beutaloOrvos ?? null,
          beutaloIntezmeny: rowP.beutaloIntezmeny ?? null,
          tnmStaging: rowP.tnmStaging ?? null,
          episodeLabel,
          stage,
          meglevoFogak: fogRaw,
          meglevoImplantatumok,
          nemIsmertPoziciokbanImplantatum: !!rowP.nemIsmertPoziciokbanImplantatum,
          nemIsmertPoziciokbanImplantatumReszletek: rowP.nemIsmertPoziciokbanImplantatumReszletek
            ? String(rowP.nemIsmertPoziciokbanImplantatumReszletek)
            : null,
          careTimeline,
        };
      }
    } catch (e) {
      logger.warn('[consilium-presentation] patient summary failed', { patientId, error: String(e) });
    }

    let mediaSummary: ItemMediaSummary = {
      opPreview: { totalCount: 0, imageCount: 0, previews: [] },
      photoPreview: { totalCount: 0, imageCount: 0, previews: [] },
      error: null,
    };
    try {
      const m = await mediaSummaryForPatient(patientId);
      mediaSummary = {
        opPreview: m.op,
        photoPreview: m.foto,
        error: null,
      };
    } catch (e) {
      logger.warn('[consilium-presentation] media summary failed', { patientId, error: String(e) });
      mediaSummary.error = 'media_summary_failed';
    }

    const checklist: ChecklistEntry[] = normalizeChecklist(row.checklist);

    items.push({
      id: row.id,
      sortOrder: row.sortOrder,
      patientId,
      discussionState: {
        discussed: !!row.discussed,
        checklist,
      },
      patientSummary,
      mediaSummary,
    });
  }

  const payloadString = JSON.stringify({ session, items });
  if (payloadString.length > 1_500_000) {
    logger.warn('[consilium-presentation] large payload', {
      sessionId,
      bytes: payloadString.length,
      itemCount: items.length,
    });
  }

  return { session, items };
}
