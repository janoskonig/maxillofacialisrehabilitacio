import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { resolvePrepTokenPreviewState } from '@/lib/consilium-prep-share';
import { getUserInstitution } from '@/lib/consilium';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type PreviewPatient = {
  id: string | null;
  name: string | null;
  taj: string | null;
  birthYear: number | null;
  age: number | null;
  diagnozis: string | null;
  missing: boolean;
};

type PreviewResponse =
  | {
      accessible: false;
      reason: 'invalid_token' | 'revoked_or_not_found' | 'institution_mismatch';
    }
  | {
      accessible: true;
      sessionId: string;
      sessionTitle: string;
      sessionScheduledAt: string;
      sessionStatus: 'draft' | 'active' | 'closed';
      itemId: string;
      patient: PreviewPatient;
      mediaCounts: { opImageCount: number; photoImageCount: number };
    };

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

export const GET = authedHandler(async (_req, { auth, params }) => {
  const rawToken = decodeURIComponent(params.token ?? '');
  if (!rawToken) {
    return NextResponse.json<PreviewResponse>(
      { accessible: false, reason: 'invalid_token' },
      { status: 200 },
    );
  }

  const institutionId = await getUserInstitution(auth);
  const state = await resolvePrepTokenPreviewState(rawToken, institutionId);

  if (state.state === 'not_found') {
    return NextResponse.json<PreviewResponse>(
      { accessible: false, reason: 'revoked_or_not_found' },
      { status: 200 },
    );
  }
  if (state.state === 'institution_mismatch') {
    return NextResponse.json<PreviewResponse>(
      { accessible: false, reason: 'institution_mismatch' },
      { status: 200 },
    );
  }

  const pool = getDbPool();

  try {
    const sessionRes = await pool.query<{
      id: string;
      title: string;
      scheduledAt: Date;
      status: 'draft' | 'active' | 'closed';
    }>(
      `SELECT id, title, scheduled_at as "scheduledAt", status
       FROM consilium_sessions
       WHERE id = $1::uuid`,
      [state.sessionId],
    );
    if (sessionRes.rows.length === 0) {
      return NextResponse.json<PreviewResponse>(
        { accessible: false, reason: 'revoked_or_not_found' },
        { status: 200 },
      );
    }
    const sessionRow = sessionRes.rows[0];

    const itemRes = await pool.query<{ patientId: string | null }>(
      `SELECT patient_id as "patientId"
       FROM consilium_session_items
       WHERE id = $1::uuid AND session_id = $2::uuid`,
      [state.itemId, state.sessionId],
    );
    if (itemRes.rows.length === 0) {
      return NextResponse.json<PreviewResponse>(
        { accessible: false, reason: 'revoked_or_not_found' },
        { status: 200 },
      );
    }
    const patientId = itemRes.rows[0].patientId;

    let patient: PreviewPatient = {
      id: patientId,
      name: null,
      taj: null,
      birthYear: null,
      age: null,
      diagnozis: null,
      missing: true,
    };

    if (patientId) {
      const pRes = await pool.query<{
        nev: string | null;
        taj: string | null;
        szuletesiDatum: Date | null;
        diagnozis: string | null;
      }>(
        `SELECT nev, taj, szuletesi_datum as "szuletesiDatum", diagnozis
         FROM patients_full
         WHERE id = $1::uuid`,
        [patientId],
      );
      if (pRes.rows.length > 0) {
        const row = pRes.rows[0];
        const birth = row.szuletesiDatum ? new Date(row.szuletesiDatum) : null;
        patient = {
          id: patientId,
          name: row.nev ?? null,
          taj: row.taj ?? null,
          birthYear: birth && !Number.isNaN(birth.getTime()) ? birth.getFullYear() : null,
          age: ageFromBirthDate(birth),
          diagnozis: row.diagnozis ?? null,
          missing: false,
        };
      }
    }

    let mediaCounts = { opImageCount: 0, photoImageCount: 0 };
    if (patientId) {
      try {
        const imageClause = `mime_type IS NOT NULL AND mime_type ILIKE 'image/%'`;
        const opTagFilter = `(
          tags @> '["orthopantomogram"]'::jsonb
          OR tags @> '["OP"]'::jsonb
          OR tags::text ILIKE '%orthopantomogram%'
          OR tags::text ILIKE '%"OP"%'
        )`;
        const fotoTagFilter = `(
          tags @> '["foto"]'::jsonb
          OR tags::text ILIKE '%"foto"%'
          OR tags::text ILIKE '%foto%'
        )`;
        const [opRow, photoRow] = await Promise.all([
          pool.query<{ c: string }>(
            `SELECT COUNT(*)::text as c FROM patient_documents
             WHERE patient_id = $1::uuid AND ${imageClause} AND ${opTagFilter}`,
            [patientId],
          ),
          pool.query<{ c: string }>(
            `SELECT COUNT(*)::text as c FROM patient_documents
             WHERE patient_id = $1::uuid AND ${imageClause} AND ${fotoTagFilter}`,
            [patientId],
          ),
        ]);
        mediaCounts = {
          opImageCount: Number.parseInt(opRow.rows[0]?.c ?? '0', 10) || 0,
          photoImageCount: Number.parseInt(photoRow.rows[0]?.c ?? '0', 10) || 0,
        };
      } catch (e) {
        logger.warn('[consilium-prep-preview] media count failed', {
          patientId,
          error: String(e),
        });
      }
    }

    const scheduledAtIso =
      sessionRow.scheduledAt instanceof Date
        ? sessionRow.scheduledAt.toISOString()
        : new Date(sessionRow.scheduledAt as unknown as string).toISOString();

    return NextResponse.json<PreviewResponse>(
      {
        accessible: true,
        sessionId: state.sessionId,
        sessionTitle: sessionRow.title,
        sessionScheduledAt: scheduledAtIso,
        sessionStatus: sessionRow.status,
        itemId: state.itemId,
        patient,
        mediaCounts,
      },
      { status: 200 },
    );
  } catch (e) {
    logger.error('[consilium-prep-preview] unexpected error', { error: String(e) });
    return NextResponse.json<PreviewResponse>(
      { accessible: false, reason: 'revoked_or_not_found' },
      { status: 200 },
    );
  }
});
