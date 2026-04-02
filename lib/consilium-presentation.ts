import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getBnoKodToNevMap, resolveBnoFieldToHungarianLabels } from '@/lib/bno-codes-data';
import { normalizeChecklist, normalizeSessionAttendees, type ChecklistEntry } from '@/lib/consilium';

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

async function latestEpisodeLabel(patientId: string): Promise<string | null> {
  const pool = getDbPool();
  try {
    const r = await pool.query(
      `SELECT e.id, e.reason, e.status, e.created_at as "createdAt"
       FROM patient_episodes e
       WHERE e.patient_id = $1
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [patientId],
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    const reason = row.reason ? String(row.reason) : '';
    const status = row.status ? String(row.status) : '';
    return [reason, status].filter(Boolean).join(' · ') || null;
  } catch (e) {
    logger.warn('[consilium-presentation] episode lookup failed', { patientId, error: String(e) });
    return null;
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
        const stage = await latestStageSummary(patientId);
        const episodeLabel = await latestEpisodeLabel(patientId);
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
