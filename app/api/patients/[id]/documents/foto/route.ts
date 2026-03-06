import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

// Get foto-tagged documents for quick access
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  // Verify patient exists
  const patientCheck = await pool.query(
    'SELECT id FROM patients WHERE id = $1',
    [patientId]
  );

  if (patientCheck.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  // All authenticated users can access all documents

  // Get foto-tagged documents (tags containing "foto")
  const result = await pool.query(
      `SELECT 
        id,
        patient_id as "patientId",
        filename,
        file_path as "filePath",
        file_size as "fileSize",
        mime_type as "mimeType",
        description,
        tags,
        uploaded_by as "uploadedBy",
        uploaded_at as "uploadedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM patient_documents
      WHERE patient_id = $1
        AND (
          tags @> '["foto"]'::jsonb
          OR tags::text ILIKE '%"foto"%'
          OR tags::text ILIKE '%foto%'
        )
      ORDER BY uploaded_at DESC`,
    [patientId]
  );

  return NextResponse.json({ documents: result.rows }, { status: 200 });
});



