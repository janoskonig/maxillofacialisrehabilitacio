import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { logActivity, presentationActivityContextSuffix } from '@/lib/activity';
import { textPayloadSchema } from '@/lib/document-annotations-schema';
import { ANNOTATION_AUTHOR_COALESCE, ANNOTATION_FROM_JOIN } from '@/lib/document-annotations-db';

export const dynamic = 'force-dynamic';

const ANNOTATE_ROLES = ['admin', 'fogpótlástanász', 'beutalo_orvos'] as const;

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

export const PATCH = roleHandler([...ANNOTATE_ROLES], async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const documentId = params.documentId;
  const annotationId = params.annotationId;
  const userEmail = auth.email;

  const existing = await pool.query(
    `SELECT id, kind, payload, deleted_at, created_by
     FROM patient_document_annotations
     WHERE id = $1 AND document_id = $2 AND patient_id = $3`,
    [annotationId, documentId, patientId],
  );

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: 'Annotáció nem található' }, { status: 404 });
  }

  const row = existing.rows[0];
  if (row.deleted_at) {
    return NextResponse.json({ error: 'Annotáció törölve' }, { status: 400 });
  }
  if (row.kind !== 'text') {
    return NextResponse.json({ error: 'Csak szöveges annotáció szerkeszthető' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const partial = body?.payload;
  if (!partial || typeof partial !== 'object') {
    return NextResponse.json({ error: 'Érvénytelen kérés: payload objektum szükséges' }, { status: 400 });
  }

  const prev = row.payload as Record<string, unknown>;
  const merged = { ...prev, ...partial, v: 1 as const };
  const validated = textPayloadSchema.safeParse(merged);
  if (!validated.success) {
    return NextResponse.json(
      { error: 'Érvénytelen szöveg payload', details: validated.error.flatten() },
      { status: 400 },
    );
  }

  const upd = await pool.query(
    `UPDATE patient_document_annotations
     SET payload = $1::jsonb
     WHERE id = $2
     RETURNING id`,
    [JSON.stringify(validated.data), annotationId],
  );

  if (upd.rows.length === 0) {
    return NextResponse.json({ error: 'Mentés sikertelen' }, { status: 500 });
  }

  const full = await pool.query(
    `SELECT ${SELECT_FIELDS}
     ${ANNOTATION_FROM_JOIN}
     WHERE a.id = $1`,
    [annotationId],
  );

  await logActivity(
    req,
    userEmail,
    'patient_document_annotation_updated',
    `Patient: ${patientId}, document: ${documentId}, annotation: ${annotationId}${presentationActivityContextSuffix(req)}`,
  );

  return NextResponse.json({ annotation: full.rows[0] }, { status: 200 });
});

export const DELETE = roleHandler([...ANNOTATE_ROLES], async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const documentId = params.documentId;
  const annotationId = params.annotationId;
  const userEmail = auth.email;

  const existing = await pool.query(
    `SELECT id, deleted_at, created_by FROM patient_document_annotations
     WHERE id = $1 AND document_id = $2 AND patient_id = $3`,
    [annotationId, documentId, patientId],
  );

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: 'Annotáció nem található' }, { status: 404 });
  }
  if (existing.rows[0].deleted_at) {
    return NextResponse.json({ error: 'Már törölve' }, { status: 400 });
  }

  await pool.query(
    `UPDATE patient_document_annotations
     SET deleted_at = NOW(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL`,
    [annotationId, userEmail],
  );

  await logActivity(
    req,
    userEmail,
    'patient_document_annotation_deleted',
    `Patient: ${patientId}, document: ${documentId}, annotation: ${annotationId}${presentationActivityContextSuffix(req)}`,
  );

  return NextResponse.json({ ok: true }, { status: 200 });
});
