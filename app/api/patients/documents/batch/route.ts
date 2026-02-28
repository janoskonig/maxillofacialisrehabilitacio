import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { patientIds } = body;

  if (!Array.isArray(patientIds) || patientIds.length === 0) {
    return NextResponse.json({ 
      opDocuments: {},
      fotoDocuments: {}
    }, { status: 200 });
  }

  const pool = getDbPool();

  const opQuery = `
    SELECT 
      patient_id as "patientId",
      COUNT(*) as count
    FROM patient_documents
    WHERE patient_id = ANY($1::uuid[])
      AND (
        tags @> '["orthopantomogram"]'::jsonb
        OR tags @> '["OP"]'::jsonb
        OR tags::text ILIKE '%orthopantomogram%'
        OR tags::text ILIKE '%"OP"%'
      )
    GROUP BY patient_id
  `;

  const fotoQuery = `
    SELECT 
      patient_id as "patientId",
      COUNT(*) as count
    FROM patient_documents
    WHERE patient_id = ANY($1::uuid[])
      AND (
        tags @> '["foto"]'::jsonb
        OR tags::text ILIKE '%"foto"%'
        OR tags::text ILIKE '%foto%'
      )
    GROUP BY patient_id
  `;

  const [opResult, fotoResult] = await Promise.all([
    pool.query(opQuery, [patientIds]),
    pool.query(fotoQuery, [patientIds])
  ]);

  const opDocuments: Record<string, number> = {};
  const fotoDocuments: Record<string, number> = {};

  opResult.rows.forEach((row: { patientId: string; count: string }) => {
    opDocuments[row.patientId] = parseInt(row.count, 10);
  });

  fotoResult.rows.forEach((row: { patientId: string; count: string }) => {
    fotoDocuments[row.patientId] = parseInt(row.count, 10);
  });

  return NextResponse.json({ 
    opDocuments,
    fotoDocuments
  }, { status: 200 });
});
