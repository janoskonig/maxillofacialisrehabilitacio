import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { ANNOTATION_AUTHOR_COALESCE, ANNOTATION_FROM_JOIN } from '@/lib/document-annotations-db';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDS = 80;

const SELECT_FIELDS = `
  a.id,
  a.document_id as "documentId",
  a.patient_id as "patientId",
  a.kind,
  a.payload,
  a.created_by as "createdBy",
  ${ANNOTATION_AUTHOR_COALESCE},
  a.created_at as "createdAt",
  a.updated_at as "updatedAt"
`;

export const GET = authedHandler(async (req, { params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const url = new URL(req.url);
  const raw = url.searchParams.get('ids') || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ byDocumentId: {} }, { status: 200 });
  }

  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const docCheck = await pool.query(
    `SELECT id FROM patient_documents WHERE patient_id = $1 AND id = ANY($2::uuid[])`,
    [patientId, ids],
  );
  if (docCheck.rows.length !== ids.length) {
    return NextResponse.json({ error: 'Érvénytelen dokumentum azonosító' }, { status: 400 });
  }

  const result = await pool.query(
    `SELECT ${SELECT_FIELDS}
     ${ANNOTATION_FROM_JOIN}
     WHERE a.patient_id = $1 AND a.document_id = ANY($2::uuid[]) AND a.deleted_at IS NULL
     ORDER BY a.document_id, a.created_at ASC`,
    [patientId, ids],
  );

  const byDocumentId: Record<string, unknown[]> = {};
  for (const row of result.rows) {
    const did = row.documentId as string;
    if (!byDocumentId[did]) byDocumentId[did] = [];
    byDocumentId[did].push(row);
  }

  return NextResponse.json({ byDocumentId }, { status: 200 });
});
