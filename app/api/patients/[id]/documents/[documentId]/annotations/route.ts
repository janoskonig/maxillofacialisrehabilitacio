import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { logActivity, presentationActivityContextSuffix } from '@/lib/activity';
import {
  createAnnotationBodySchema,
  assertFreehandPointBudget,
  isImageMime,
} from '@/lib/document-annotations-schema';
import { ANNOTATION_AUTHOR_COALESCE, ANNOTATION_FROM_JOIN } from '@/lib/document-annotations-db';

export const dynamic = 'force-dynamic';

const ANNOTATE_ROLES = ['admin', 'fogpótlástanász', 'beutalo_orvos'] as const;

async function getDocumentRow(pool: ReturnType<typeof getDbPool>, patientId: string, documentId: string) {
  const r = await pool.query<{ id: string; patient_id: string; mime_type: string | null }>(
    `SELECT id, patient_id, mime_type FROM patient_documents WHERE id = $1 AND patient_id = $2`,
    [documentId, patientId],
  );
  return r.rows[0] ?? null;
}

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

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const documentId = params.documentId;

  const doc = await getDocumentRow(pool, patientId, documentId);
  if (!doc) {
    return NextResponse.json({ error: 'Dokumentum nem található' }, { status: 404 });
  }

  const result = await pool.query(
    `SELECT ${SELECT_FIELDS}
     ${ANNOTATION_FROM_JOIN}
     WHERE a.document_id = $1 AND a.patient_id = $2 AND a.deleted_at IS NULL
     ORDER BY a.created_at ASC`,
    [documentId, patientId],
  );

  return NextResponse.json({ annotations: result.rows }, { status: 200 });
});

export const POST = roleHandler([...ANNOTATE_ROLES], async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const documentId = params.documentId;
  const userEmail = auth.email;

  const doc = await getDocumentRow(pool, patientId, documentId);
  if (!doc) {
    return NextResponse.json({ error: 'Dokumentum nem található' }, { status: 404 });
  }
  if (!isImageMime(doc.mime_type)) {
    return NextResponse.json({ error: 'Annotáció csak képfájlhoz adható' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createAnnotationBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Érvénytelen kérés', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const row = parsed.data;
  try {
    if (row.kind === 'freehand') {
      assertFreehandPointBudget(row.payload);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Érvénytelen payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const insert = await pool.query(
    `INSERT INTO patient_document_annotations (
      document_id, patient_id, kind, payload, created_by
    ) VALUES ($1, $2, $3, $4::jsonb, $5)
    RETURNING id`,
    [documentId, patientId, row.kind, JSON.stringify(row.payload), userEmail],
  );

  const newId = insert.rows[0].id as string;

  const full = await pool.query(
    `SELECT ${SELECT_FIELDS}
     ${ANNOTATION_FROM_JOIN}
     WHERE a.id = $1`,
    [newId],
  );

  await logActivity(
    req,
    userEmail,
    'patient_document_annotation_created',
    `Patient: ${patientId}, document: ${documentId}, kind: ${row.kind}${presentationActivityContextSuffix(req)}`,
  );

  return NextResponse.json({ annotation: full.rows[0] }, { status: 201 });
});
