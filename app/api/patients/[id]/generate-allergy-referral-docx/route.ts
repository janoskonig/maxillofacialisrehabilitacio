import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { generateAllergyReferralDocx } from '@/lib/docx/allergy-referral';
import { Patient, patientSchema } from '@/lib/types';
import { patientSelectSql, normalizePatientRow } from '@/lib/patient-select';
import { uploadFile, isFtpConfigured, generateDocumentFilename } from '@/lib/ftp-client';
import { logActivity } from '@/lib/activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász' && auth.role !== 'beutalo_orvos') {
    return NextResponse.json(
      { error: 'Nincs jogosultsága dokumentum generáláshoz' },
      { status: 403 },
    );
  }

  const pool = getDbPool();
  const patientId = params.id;

  const result = await pool.query(patientSelectSql(), [patientId]);
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const normalizedPatientData = normalizePatientRow(result.rows[0]);
  const patient = patientSchema.parse(normalizedPatientData) as Patient;

  const docxBuffer = generateAllergyReferralDocx(patient);

  const patientName = patient.nev || 'Beteg';
  const sanitizedName = patientName
    .replace(/[^a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  const filename = `Allergia_vizsgalat_kerese_${sanitizedName}_${Date.now()}.docx`;

  if (isFtpConfigured()) {
    try {
      const tags = ['allergiavizsgálat'];
      const uploadFilename = generateDocumentFilename(filename, tags, patientId, new Date());
      const filePath = await uploadFile(patientId, docxBuffer, uploadFilename);

      await pool.query(
        `INSERT INTO patient_documents (
          patient_id, filename, file_path, file_size, mime_type,
          description, tags, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          patientId,
          uploadFilename,
          filePath,
          docxBuffer.length,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Allergológiai vizsgálat kérés',
          JSON.stringify(tags),
          auth.email,
        ],
      );

      await logActivity(
        req,
        auth.email,
        'patient_document_uploaded',
        `Patient ID: ${patientId}, Document: ${uploadFilename}, Type: Allergia vizsgálat kérés, Size: ${docxBuffer.length} bytes`,
      );
    } catch (uploadError) {
      logger.error('Hiba a DOCX feltöltésekor:', uploadError);
    }
  }

  return new NextResponse(new Uint8Array(docxBuffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': docxBuffer.length.toString(),
    },
  });
});
