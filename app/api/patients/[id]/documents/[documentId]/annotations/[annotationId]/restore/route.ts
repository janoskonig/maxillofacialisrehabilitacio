import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { logActivity } from '@/lib/activity';
import { ANNOTATION_AUTHOR_COALESCE, ANNOTATION_FROM_JOIN } from '@/lib/document-annotations-db';

export const dynamic = 'force-dynamic';

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

export const POST = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const documentId = params.documentId;
  const annotationId = params.annotationId;
  const userEmail = auth.email;

  const isAdmin = auth.role === 'admin';

  const existing = await pool.query(
    `SELECT id, deleted_at, created_by FROM patient_document_annotations
     WHERE id = $1 AND document_id = $2 AND patient_id = $3`,
    [annotationId, documentId, patientId],
  );

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: 'Annotáció nem található' }, { status: 404 });
  }

  const ann = existing.rows[0];
  if (!ann.deleted_at) {
    return NextResponse.json({ error: 'Az annotáció nem volt törölve' }, { status: 400 });
  }

  if (!isAdmin && ann.created_by !== userEmail) {
    return NextResponse.json({ error: 'Nincs jogosultság a visszaállításhoz' }, { status: 403 });
  }

  await pool.query(
    `UPDATE patient_document_annotations
     SET deleted_at = NULL, deleted_by = NULL
     WHERE id = $1`,
    [annotationId],
  );

  const full = await pool.query(
    `SELECT ${SELECT_FIELDS}
     ${ANNOTATION_FROM_JOIN}
     WHERE a.id = $1`,
    [annotationId],
  );

  await logActivity(
    req,
    userEmail,
    'patient_document_annotation_restored',
    `Patient: ${patientId}, document: ${documentId}, annotation: ${annotationId}`,
  );

  return NextResponse.json({ annotation: full.rows[0] }, { status: 200 });
});
