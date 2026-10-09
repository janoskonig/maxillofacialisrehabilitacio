import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { REQUIRED_DOC_RULES, getChecklistStatus, requiredFieldSeverity } from '@/lib/clinical-rules';
import { Patient, LabQuoteRequest } from '@/lib/types';
import { patientSelectSql, normalizePatientRow } from '@/lib/patient-select';
import { downloadFile } from '@/lib/ftp-client';
import archiver from 'archiver';
import { Readable } from 'stream';
import { buildStructuredAnamnesisSummary } from '@/lib/anamnesis-summary';
import { normalizeTags, safeFilename, ExportLimiter } from '@/lib/utils';
import { buildNeakExportPlan, NEAK_EXPORT_LIMITS, withNeakDownloadTimeout } from '@/lib/neak-export';
import { generateDentalStatusPDF } from '@/lib/pdf/generateDentalStatusPDF';
import { markdownToPDF, generatePatientSummaryMarkdown, generateMedicalHistoryMarkdown } from '@/lib/pdf/markdown-to-pdf';
import { generateEquityRequestPDF } from '@/lib/pdf/equity-request';
import { generatePatientDataEquityPDF } from '@/lib/pdf/equity-request-patient';
import { logger } from '@/lib/logger';
import { buildDentalExportContent } from '@/lib/neak-dental-content';
import { loadNeakTreatmentSources } from '@/lib/neak-treatment-sources';
import { buildTreatmentExportContent, treatmentContentToText } from '@/lib/neak-treatment-content';
import { generateTreatmentPlanPDF } from '@/lib/pdf/treatment-plan';

// Force Node.js runtime (required for archiver, pdf-lib, Buffer operations)
export const runtime = 'nodejs';

const FILE_DOWNLOAD_TIMEOUT_MS = 30000;

/**
 * Format quote requests as text
 */
function formatQuoteRequests(quoteRequests: LabQuoteRequest[]): string {
  if (!quoteRequests || quoteRequests.length === 0) {
    return 'Nincs megadott arajánlatkérő.';
  }

  const lines: string[] = [];
  lines.push('ARAJANLATKEROK');
  lines.push('='.repeat(50));
  lines.push('');

  quoteRequests.forEach((quote, index) => {
    lines.push(`${index + 1}. Arajánlatkérő`);
    if (quote.datuma) {
      lines.push(`   Datuma: ${quote.datuma}`);
    }
    if (quote.szoveg) {
      lines.push(`   Szoveg: ${quote.szoveg}`);
    }
    if (quote.createdAt) {
      lines.push(`   Letrehozva: ${new Date(quote.createdAt).toLocaleString('hu-HU')}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Generate README.txt for ZIP
 */
function generateReadme(
  exportDate: Date,
  files: Array<{ name: string; size: number }>,
  documentCount?: number,
  missingFields?: string[]
): string {
  const lines: string[] = [];
  lines.push('NEAK EXPORT README');
  lines.push('='.repeat(50));
  lines.push('');
  lines.push(`Export ideje: ${exportDate.toISOString()}`);
  lines.push('');
  lines.push('Generált fájlok:');
  lines.push('');

  files.forEach((file) => {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    lines.push(`  - ${file.name} (${sizeMB} MB)`);
  });

  if (documentCount !== undefined) {
    lines.push(`  - documents/ mappa (${documentCount} dokumentum)`);
  }

  lines.push('');
  if (missingFields && missingFields.length > 0) {
    lines.push('');
    lines.push('Nem áll rendelkezésre (FNMT.150.K): ' + missingFields.join(', '));
  }

  return lines.join('\n');
}

/**
 * Dry-run endpoint: Check if patient is ready for NEAK export
 * GET /api/patients/[id]/export-neak?dryRun=1
 * Export endpoint: Generate and download NEAK package
 * GET /api/patients/[id]/export-neak
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { params, correlationId }) => {
  // Feature flag check
  if (process.env.ENABLE_NEAK_EXPORT !== 'true') {
    return NextResponse.json(
      {
        error: 'NEAK export feature is not enabled',
        code: 'FEATURE_DISABLED',
        correlationId,
      },
      { status: 404 }
    );
  }

  // Extract patient ID from params and check dryRun query param
  const patientId = params.id;
  const url = new URL(req.url);
  const isDryRun = url.searchParams.get('dryRun') === '1';

  if (!patientId) {
      return NextResponse.json(
        {
          error: 'Beteg ID hiányzik',
          code: 'INVALID_REQUEST',
          correlationId,
        },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Get patient data (közös patient SELECT – lib/patient-select)
    const patientResult = await pool.query(patientSelectSql(), [patientId]);

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        {
          error: 'Beteg nem található',
          code: 'PATIENT_NOT_FOUND',
          correlationId,
        },
        { status: 404 }
      );
    }

    const patient = normalizePatientRow(patientResult.rows[0]) as Patient;

    // Get lab quote requests (LIMIT 20)
    const quoteRequestsResult = await pool.query(
      `SELECT 
        id, szoveg, datuma, created_at as "createdAt"
      FROM lab_quote_requests
      WHERE patient_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
      [patientId]
    );
    const quoteRequests = quoteRequestsResult.rows as LabQuoteRequest[];

    // Get documents with tags and uploaded_at for last-quote ordering
    const documentsResult = await pool.query(
      `SELECT 
        id, filename, tags, file_size as "fileSize", file_path as "filePath",
        uploaded_at as "uploadedAt", created_at as "createdAt"
      FROM patient_documents
      WHERE patient_id = $1`,
      [patientId]
    );

    const documents = documentsResult.rows;

    const treatmentSources = await loadNeakTreatmentSources(pool, patientId);
    const treatmentContent = buildTreatmentExportContent(patient, treatmentSources);
    const dentalContent = buildDentalExportContent(patient);
    const basePlan = buildNeakExportPlan(patient, documents);
    const plan = {
      ...basePlan, treatmentContent, dentalContent,
      warnings: [...basePlan.warnings, ...treatmentSources.warnings],
    };
    const { includedDocuments, isReady } = plan;

    // Get checklist status for summary. A NEAK-összefoglaló „Kötelező mezők"
    // sorában csak a szigorúan kötelező (error) mezők számítanak — az ajánlott
    // (warning, pl. email) hiánya nem NEAK-hiány.
    const fullChecklistStatus = getChecklistStatus(patient, documents.map((doc) => ({ ...doc, tags: normalizeTags(doc.tags) })));
    const checklistStatus = {
      ...fullChecklistStatus,
      missingFields: fullChecklistStatus.missingFields.filter(
        (f) => requiredFieldSeverity(f) === 'error'
      ),
    };

    // DRY-RUN: Return status only
    if (isDryRun) {
      const response = NextResponse.json(
        {
          ...plan,
          requiredDocTags: REQUIRED_DOC_RULES.map((rule) => rule.tag),
          requiredDocRules: REQUIRED_DOC_RULES,
          quoteRequestsCount: quoteRequests.length,
          correlationId,
        },
        { status: 200 }
      );
      response.headers.set('x-correlation-id', correlationId);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }

    if (!isReady) {
      const limitError = plan.limitErrors[0];
      return NextResponse.json({
        error: limitError?.message ?? 'Az exporthoz kötelező adatok vagy dokumentumok hiányoznak.',
        code: limitError?.code ?? 'EXPORT_NOT_READY',
        details: plan,
        correlationId,
      }, { status: limitError ? 413 : 422 });
    }

    const limiter = new ExportLimiter(NEAK_EXPORT_LIMITS);

    const anamnesisInput = {
      patientId: patient.id || patientId,
      referralReason: patient.kezelesreErkezesIndoka || null,
      accident: {
        date: patient.balesetIdopont || null,
        etiology: patient.balesetEtiologiaja || null,
        other: patient.balesetEgyeb || null,
      },
      oncology: {
        bno: patient.bno || null,
        histology: patient.szovettaniDiagnozis || null,
        tnm: patient.tnmStaging || null,
      },
      therapies: {
        radiotherapy: patient.radioterapia === true ? 'Igen' : patient.radioterapia === false ? 'Nem' : null,
        radiotherapyDose: patient.radioterapiaDozis || null,
        radiotherapyInterval: patient.radioterapiaDatumIntervallum || null,
        chemotherapy: patient.chemoterapia === true ? 'Igen' : patient.chemoterapia === false ? 'Nem' : null,
        chemotherapyDesc: patient.chemoterapiaLeiras || null,
      },
      risks: {
        smoking: patient.dohanyzasSzam || null,
        alcohol: patient.alkoholfogyasztas || null,
      },
      dental: {
        existingTeeth: patient.meglevoFogak ? JSON.stringify(patient.meglevoFogak) : null,
        implants: patient.meglevoImplantatumok ? JSON.stringify(patient.meglevoImplantatumok) : null,
      },
      historySummary: patient.kortortenetiOsszefoglalo || null,
    };

    const anamnesisSummary = buildStructuredAnamnesisSummary(anamnesisInput);

    // Generate PDFs and text files
    // 1. PDF-ek (determinisztikus sorrend) - Markdown alapú generálás
    let patientSummaryBuffer: Buffer;
    try {
      const patientSummaryMarkdown = generatePatientSummaryMarkdown(
        patient,
        documents.map((doc) => ({ ...doc, tags: normalizeTags(doc.tags) })),
        checklistStatus,
        REQUIRED_DOC_RULES
      );
      patientSummaryBuffer = await markdownToPDF(patientSummaryMarkdown, 'Beteg Összefoglaló');
      limiter.addFile(patientSummaryBuffer.length);
    } catch (error) {
      logger.error('[NEAK Export] Error generating patient summary PDF:', error);
      // Fallback: empty PDF vagy hibaüzenet
      throw new Error(
        `Beteg összefoglaló PDF generálás sikertelen: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}`
      );
    }

    let medicalHistoryBuffer: Buffer;
    try {
      const medicalHistoryMarkdown = generateMedicalHistoryMarkdown(patient, anamnesisSummary);
      medicalHistoryBuffer = await markdownToPDF(medicalHistoryMarkdown, 'Kórtörténet');
      limiter.addFile(medicalHistoryBuffer.length);
    } catch (error) {
      logger.error('[NEAK Export] Error generating medical history PDF:', error);
      // Fallback: empty PDF vagy hibaüzenet
      throw new Error(
        `Kórtörténet PDF generálás sikertelen: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}`
      );
    }

    // Every generated PDF must succeed; a placeholder is not an exportable status.
    const dentalStatusBuffer = await generateDentalStatusPDF(patient);
    limiter.addFile(dentalStatusBuffer.length);

    // Fogorvosi méltányossági (FNMT.152.K)
    let equityDentalBuffer: Buffer;
    try {
      equityDentalBuffer = await generateEquityRequestPDF(patient, { treatmentPlanSummary: 'A részletes, állcsontonkénti és fogankénti kezelési tervet a treatment_plan.pdf melléklet tartalmazza.' });
      limiter.addFile(equityDentalBuffer.length);
    } catch (error) {
      logger.error('[NEAK Export] Equity request dental PDF failed:', error);
      throw new Error(
        `Méltányossági kérelem (152) PDF generálás sikertelen: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}`
      );
    }

    // Páciens adatok (FNMT.150.K)
    let equityPatientBuffer: Buffer;
    let equityPatientMissingFields: string[] = [];
    try {
      const result = await generatePatientDataEquityPDF(patient);
      equityPatientBuffer = result.pdf;
      equityPatientMissingFields = result.missingFields;
      limiter.addFile(equityPatientBuffer.length);
    } catch (error) {
      logger.error('[NEAK Export] Equity request patient data PDF failed:', error);
      throw new Error(
        `Méltányossági páciens adat (150) PDF generálás sikertelen: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}`
      );
    }

    const treatmentPlanPdfBuffer = await generateTreatmentPlanPDF(patient, treatmentContent);
    limiter.addFile(treatmentPlanPdfBuffer.length);

    // PDF and TXT share the same clinical content.
    const treatmentPlanText = treatmentContentToText(patient, treatmentContent);
    const treatmentPlanBuffer = Buffer.from(treatmentPlanText, 'utf-8');
    limiter.addFile(treatmentPlanBuffer.length);

    const quoteRequestsText = formatQuoteRequests(quoteRequests);
    const quoteRequestsBuffer = Buffer.from(quoteRequestsText, 'utf-8');
    limiter.addFile(quoteRequestsBuffer.length);

    // Track files for README (will be updated as we add documents)
    const exportDate = new Date();
    const files: Array<{ name: string; size: number }> = [
      { name: 'patient_summary.pdf', size: patientSummaryBuffer.length },
      { name: 'medical_history.pdf', size: medicalHistoryBuffer.length },
      { name: 'dental_status.pdf', size: dentalStatusBuffer.length },
      { name: 'equity_request_dental.pdf', size: equityDentalBuffer.length },
      { name: 'equity_request_patient_data.pdf', size: equityPatientBuffer.length },
      { name: 'treatment_plan.pdf', size: treatmentPlanPdfBuffer.length },
      { name: 'treatment_plan.txt', size: treatmentPlanBuffer.length },
      { name: 'quote_requests.txt', size: quoteRequestsBuffer.length },
    ];

    // Fetch every selected attachment before starting the archive. A failed or empty
    // attachment must produce an error response, never a partial successful package.
    const attachments: Array<{ name: string; buffer: Buffer }> = [];
    for (const doc of includedDocuments) {
      limiter.addDoc();
      const source = documents.find((entry) => entry.id === doc.id);
      if (!source?.filePath) {
        return NextResponse.json({
          error: `A melléklet elérési útja hiányzik: ${doc.filename || doc.id}`,
          code: 'DOCUMENT_UNAVAILABLE', correlationId,
        }, { status: 422 });
      }
      let buffer: Buffer;
      try {
        buffer = await withNeakDownloadTimeout(
          downloadFile(source.filePath, patientId), FILE_DOWNLOAD_TIMEOUT_MS
        );
      } catch (error) {
        logger.error('[NEAK Export] Attachment download failed:', error);
        return NextResponse.json({
          error: `Nem tölthető le a melléklet: ${doc.filename || doc.id}. Próbálja újra az exportot.`,
          code: 'DOCUMENT_DOWNLOAD_FAILED', correlationId,
        }, { status: 502 });
      }
      if (buffer.length === 0) {
        return NextResponse.json({
          error: `A melléklet üres: ${doc.filename || doc.id}`,
          code: 'DOCUMENT_EMPTY', correlationId,
        }, { status: 422 });
      }
      try {
        limiter.addFile(buffer.length);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return NextResponse.json({
          error: ExportLimiter.formatError(error),
          code: error.message.split(':')[0], correlationId,
        }, { status: 413 });
      }
      const folder = doc.category === 'quote' ? 'quotes/'
        : doc.category === 'allergy' ? 'allergy/'
        : doc.category === 'technikus_meltanyossagi' ? 'technikus_meltanyossagi/' : '';
      const name = `documents/${folder}${doc.id}_${safeFilename(doc.filename || 'document')}`;
      attachments.push({ name, buffer });
      files.push({ name, size: buffer.length });
    }

    const readmeBuffer = Buffer.from(generateReadme(
      exportDate, files, attachments.length, equityPatientMissingFields
    ), 'utf-8');
    try {
      limiter.addFile(readmeBuffer.length);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return NextResponse.json({
        error: ExportLimiter.formatError(error),
        code: error.message.split(':')[0], correlationId,
      }, { status: 413 });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    // Attach the consumer before finalizing; propagate archive failures to the download.
    const stream = Readable.toWeb(archive);
    archive.on('error', (error) => {
      logger.error('[NEAK Export] Archive error:', error);
      archive.destroy(error);
    });
    archive.append(patientSummaryBuffer, { name: 'patient_summary.pdf' });
    archive.append(medicalHistoryBuffer, { name: 'medical_history.pdf' });
    archive.append(dentalStatusBuffer, { name: 'dental_status.pdf' });
    archive.append(equityDentalBuffer, { name: 'equity_request_dental.pdf' });
    archive.append(equityPatientBuffer, { name: 'equity_request_patient_data.pdf' });
    archive.append(treatmentPlanPdfBuffer, { name: 'treatment_plan.pdf' });
    archive.append(treatmentPlanBuffer, { name: 'treatment_plan.txt' });
    archive.append(quoteRequestsBuffer, { name: 'quote_requests.txt' });
    archive.append(readmeBuffer, { name: 'README.txt' });
    for (const attachment of attachments) {
      archive.append(attachment.buffer, { name: attachment.name });
    }
    void archive.finalize().catch((error: Error) => archive.destroy(error));

    // Generate filename
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `NEAK_${patientId}_${dateStr}.zip`;

    // Create response with proper error handling
    const response = new NextResponse(stream as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'x-correlation-id': correlationId,
      },
    });

    // Note: Archive 'end' event will fire when ZIP is fully written
    // Frontend should wait for blob download to complete before logging success
    // (This is handled in PatientDocuments.tsx - success log only after blob download)

    return response;
});
