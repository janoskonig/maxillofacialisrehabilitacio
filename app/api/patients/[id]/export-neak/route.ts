import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';
import { REQUIRED_DOC_TAGS, REQUIRED_DOC_RULES, getMissingRequiredDocRules, getMissingRequiredDocTags, getChecklistStatus, getMissingRequiredFields } from '@/lib/clinical-rules';
import { Patient, LabQuoteRequest } from '@/lib/types';
import { patientSelectSql, normalizePatientRow } from '@/lib/patient-select';
import { downloadFile } from '@/lib/ftp-client';
import archiver from 'archiver';
import { Readable } from 'stream';
import { generateAnamnesisSummary } from '@/lib/openai-client';
import { shouldCallAI, normalizeTags, safeFilename, ExportLimiter, ExportLimits } from '@/lib/utils';
import { hasTag } from '@/lib/doc-tags';
import { generateDentalStatusPDF } from '@/lib/pdf/generateDentalStatusPDF';
import { markdownToPDF, generatePatientSummaryMarkdown, generateMedicalHistoryMarkdown } from '@/lib/pdf/markdown-to-pdf';
import { createPlaceholderPdf } from '@/lib/pdf/placeholder-pdf';
import { generateEquityRequestPDF } from '@/lib/pdf/equity-request';
import { generatePatientDataEquityPDF } from '@/lib/pdf/equity-request-patient';
import { logger } from '@/lib/logger';

// Force Node.js runtime (required for archiver, pdf-lib, Buffer operations)
export const runtime = 'nodejs';

// Size limits
const MAX_EXPORT_SIZE = 200 * 1024 * 1024; // 200 MB total
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB per file
const MAX_DOCS_COUNT = 200; // Maximum number of documents
const FILE_DOWNLOAD_TIMEOUT_MS = 30000; // 30 seconds per file

// Export limits configuration
const EXPORT_LIMITS: ExportLimits = {
  maxDocs: MAX_DOCS_COUNT,
  maxFileBytes: MAX_FILE_SIZE,
  maxTotalBytes: MAX_EXPORT_SIZE,
};

// Feature flag: ENABLE_NEAK_EXPORT
const ENABLE_NEAK_EXPORT = process.env.ENABLE_NEAK_EXPORT === 'true';

/**
 * Helper to get correlation ID from request
 */
function getCorrelationId(req: NextRequest): string {
  return req.headers.get('x-correlation-id')?.toLowerCase() || 'unknown';
}

// Régi PDF helper függvények eltávolítva - már nem kellenek, mert markdown → HTML → PDF workflow-t használunk

/**
 * Format treatment plan as text
 */
function formatTreatmentPlan(patient: Patient): string {
  const lines: string[] = [];
  lines.push('KEZELESI TERV');
  lines.push('='.repeat(50));
  lines.push('');

  if (patient.kezelesiTervFelso && Array.isArray(patient.kezelesiTervFelso) && patient.kezelesiTervFelso.length > 0) {
    lines.push('FELSO ALLCSONT:');
    patient.kezelesiTervFelso.forEach((plan: any, index: number) => {
      lines.push(`${index + 1}. ${plan.tipus || 'N/A'}`);
      if (plan.tervezettAtadasDatuma) {
        lines.push(`   Tervezett atadas datuma: ${plan.tervezettAtadasDatuma}`);
      }
      lines.push(`   Elkeszult: ${plan.elkeszult ? 'Igen' : 'Nem'}`);
      lines.push('');
    });
  }

  if (patient.kezelesiTervAlso && Array.isArray(patient.kezelesiTervAlso) && patient.kezelesiTervAlso.length > 0) {
    lines.push('ALSO ALLCSONT:');
    patient.kezelesiTervAlso.forEach((plan: any, index: number) => {
      lines.push(`${index + 1}. ${plan.tipus || 'N/A'}`);
      if (plan.tervezettAtadasDatuma) {
        lines.push(`   Tervezett atadas datuma: ${plan.tervezettAtadasDatuma}`);
      }
      lines.push(`   Elkeszult: ${plan.elkeszult ? 'Igen' : 'Nem'}`);
      lines.push('');
    });
  }

  if (patient.kezelesiTervArcotErinto && Array.isArray(patient.kezelesiTervArcotErinto) && patient.kezelesiTervArcotErinto.length > 0) {
    lines.push('ARCOT ERINTO REHABILITACIO:');
    patient.kezelesiTervArcotErinto.forEach((plan: any, index: number) => {
      lines.push(`${index + 1}. ${plan.tipus || 'N/A'}`);
      if (plan.elhorgonyzasEszkoze) {
        lines.push(`   Elhorgonyzas eszkoze: ${plan.elhorgonyzasEszkoze}`);
      }
      if (plan.tervezettAtadasDatuma) {
        lines.push(`   Tervezett atadas datuma: ${plan.tervezettAtadasDatuma}`);
      }
      lines.push(`   Elkeszult: ${plan.elkeszult ? 'Igen' : 'Nem'}`);
      lines.push('');
    });
  }

  if (lines.length === 3) {
    // Only header and separator, no actual plans
    lines.push('Nincs megadott kezelesi terv.');
  }

  return lines.join('\n');
}

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
  aiGenerated: boolean,
  documentCount?: number,
  dentalPdfFailed?: boolean,
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
  if (aiGenerated) {
    lines.push('MEGJEGYZES:');
    lines.push('A medical_history.pdf tartalmazhat AI-generált összefoglalót — ellenőrzendő.');
  }
  if (dentalPdfFailed) {
    lines.push('');
    lines.push('MEGJEGYZES: A fogazati státusz PDF generálása sikertelen volt. A dental_status.pdf placeholder tartalmat tartalmaz.');
  }
  if (missingFields && missingFields.length > 0) {
    lines.push('');
    lines.push('Nem áll rendelkezésre (FNMT.150.K): ' + missingFields.join(', '));
  }

  return lines.join('\n');
}

// Régi PDF generáló függvény eltávolítva - most markdown → HTML → PDF workflow-t használunk

/**
 * Dry-run endpoint: Check if patient is ready for NEAK export
 * GET /api/patients/[id]/export-neak?dryRun=1
 * Export endpoint: Generate and download NEAK package
 * GET /api/patients/[id]/export-neak
 */
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = getCorrelationId(req);
  
  try {
    // Feature flag check
    if (!ENABLE_NEAK_EXPORT) {
      const response = NextResponse.json(
        {
          error: 'NEAK export feature is not enabled',
          code: 'FEATURE_DISABLED',
          correlationId,
        },
        { status: 404 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    // Authentication
    const auth = await verifyAuth(req);
    if (!auth) {
      const response = NextResponse.json(
        {
          error: 'Bejelentkezés szükséges',
          code: 'UNAUTHORIZED',
          correlationId,
        },
        { status: 401 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
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

    // Check missing required doc rules (tag + minCount)
    const missingDocRules = getMissingRequiredDocRules(documents);
    const missingDocTags = missingDocRules.map((rule) => rule.tag);

    // Get documents that match required rules (for includedDocuments list)
    // Include: REQUIRED_DOC_RULES tags + technikus_meltanyossagi + only last arajanlat + allergiavizsgálat
    const includedDocuments: Array<{
      id: string;
      tags: string[];
      filename?: string;
      sizeBytes?: number;
      category: 'required' | 'quote' | 'allergy' | 'technikus_meltanyossagi';
    }> = [];

    // ts for ordering: uploaded_at ?? created_at (ISO), tie-break id DESC
    const ts = (d: { uploadedAt?: Date | string; createdAt?: Date | string }) => {
      const v = d.uploadedAt ?? d.createdAt;
      if (v instanceof Date) return v.getTime();
      if (typeof v === 'string') {
        const n = Date.parse(v);
        return Number.isNaN(n) ? 0 : n;
      }
      return 0;
    };

    const quoteDocs: Array<{ id: string; tags: string[]; filename?: string; sizeBytes?: number; uploadedAt?: Date | string; createdAt?: Date | string }> = [];

    documents.forEach((doc: any) => {
      const docTags = normalizeTags(doc.tags);

      const hasRequiredTag = REQUIRED_DOC_RULES.some((rule) =>
        docTags.includes(rule.tag.toLowerCase())
      );
      const hasTechnikusTag = hasTag(doc.tags, 'technikus méltányossági');
      const hasQuoteTag = docTags.includes('arajanlat');
      const hasAllergyTag = docTags.includes('allergiavizsgalat');

      if (hasRequiredTag) {
        includedDocuments.push({
          id: doc.id,
          tags: docTags,
          filename: doc.filename || undefined,
          sizeBytes: doc.fileSize || undefined,
          category: 'required',
        });
      } else if (hasTechnikusTag) {
        includedDocuments.push({
          id: doc.id,
          tags: docTags,
          filename: doc.filename || undefined,
          sizeBytes: doc.fileSize || undefined,
          category: 'technikus_meltanyossagi',
        });
      } else if (hasQuoteTag) {
        quoteDocs.push({
          id: doc.id,
          tags: docTags,
          filename: doc.filename || undefined,
          sizeBytes: doc.fileSize || undefined,
          uploadedAt: doc.uploadedAt,
          createdAt: doc.createdAt,
        });
      } else if (hasAllergyTag) {
        includedDocuments.push({
          id: doc.id,
          tags: docTags,
          filename: doc.filename || undefined,
          sizeBytes: doc.fileSize || undefined,
          category: 'allergy',
        });
      }
    });

    // Only the last quote (by uploaded_at DESC, id DESC) goes into the ZIP
    if (quoteDocs.length > 0) {
      const sorted = [...quoteDocs].sort((a, b) => {
        const ta = ts(a);
        const tb = ts(b);
        if (tb !== ta) return tb - ta;
        return (b.id || '').localeCompare(a.id || '');
      });
      const lastQuote = sorted[0];
      includedDocuments.push({
        id: lastQuote.id,
        tags: lastQuote.tags,
        filename: lastQuote.filename,
        sizeBytes: lastQuote.sizeBytes,
        category: 'quote',
      });
    }

    // Calculate estimated total bytes (sum of included documents)
    const estimatedTotalBytes = includedDocuments.reduce(
      (sum, doc) => sum + (doc.sizeBytes || 0),
      0
    );

    // Check if ready (no missing tags)
    const isReady = missingDocTags.length === 0;

    // Get checklist status for summary
    const checklistStatus = getChecklistStatus(patient, documents);

    // DRY-RUN: Return status only
    if (isDryRun) {
      const response = NextResponse.json(
        {
          isReady,
          missingDocTags,
          requiredDocTags: REQUIRED_DOC_RULES.map((rule) => rule.tag), // Backward compatibility
          requiredDocRules: REQUIRED_DOC_RULES.map((rule) => ({
            tag: rule.tag,
            label: rule.label,
            minCount: rule.minCount,
          })),
          missingDocRules: missingDocRules.map((rule) => ({
            tag: rule.tag,
            label: rule.label,
            minCount: rule.minCount,
            actualCount: rule.actualCount,
          })),
          includedDocuments,
          estimatedTotalBytes: estimatedTotalBytes > 0 ? estimatedTotalBytes : undefined,
          quoteRequestsCount: quoteRequests.length,
          checklistSummary: {
            missingFields: checklistStatus.missingFields.length,
            missingDocs: checklistStatus.missingDocs.length,
            hasErrors: checklistStatus.hasErrors,
          },
          correlationId,
        },
        { status: 200 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    // EXPORT: Generate ZIP package
    // Check if required docs are missing
    if (!isReady) {
      const response = NextResponse.json(
        {
          error: 'Hiányoznak kötelező dokumentumok',
          code: 'MISSING_REQUIRED_DOCS',
          details: {
            missingDocTags,
          },
          correlationId,
        },
        { status: 422 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    // Initialize export limiter
    const limiter = new ExportLimiter(EXPORT_LIMITS);

    // Prepare anamnesis input for AI
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
        radiotherapy: patient.radioterapia ? 'Igen' : null,
        radiotherapyDose: patient.radioterapiaDozis || null,
        radiotherapyInterval: patient.radioterapiaDatumIntervallum || null,
        chemotherapy: patient.chemoterapia ? 'Igen' : null,
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

    // Generate anamnesis summary (AI vagy fallback)
    let anamnesisSummary: string;
    let aiGenerated = false;
    
    if (shouldCallAI(patient)) {
      const result = await generateAnamnesisSummary(anamnesisInput);
      anamnesisSummary = result.text;
      aiGenerated = result.aiGenerated;
    } else {
      // Fallback direktben, ha nincs elég adat (ugyanaz a függvény, de aiGenerated=false lesz)
      const result = await generateAnamnesisSummary(anamnesisInput);
      anamnesisSummary = result.text;
      aiGenerated = false;
    }

    // Generate PDFs and text files
    // 1. PDF-ek (determinisztikus sorrend) - Markdown alapú generálás
    let patientSummaryBuffer: Buffer;
    try {
      const patientSummaryMarkdown = generatePatientSummaryMarkdown(
        patient,
        documents,
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

    // Dental status PDF (optional: on failure use placeholder so ZIP always contains dental_status.pdf)
    let dentalStatusBuffer: Buffer;
    let dentalPdfFailed = false;
    try {
      dentalStatusBuffer = await generateDentalStatusPDF(patient);
      limiter.addFile(dentalStatusBuffer.length);
    } catch (error) {
      logger.error('[NEAK Export] Dental status PDF generation failed (DENTAL_PDF_GEN_FAILED):', error);
      dentalPdfFailed = true;
      if (process.env.ENABLE_SENTRY === 'true') {
        try {
          const Sentry = await import('@sentry/nextjs');
          Sentry.captureException(error, { tags: { error_fingerprint: 'DENTAL_PDF_GEN_FAILED' } });
        } catch {
          /* ignore */
        }
      }
      dentalStatusBuffer = await createPlaceholderPdf('Fogazati státusz PDF generálása sikertelen.');
      limiter.addFile(dentalStatusBuffer.length);
    }

    // Fogorvosi méltányossági (FNMT.152.K)
    let equityDentalBuffer: Buffer;
    try {
      equityDentalBuffer = await generateEquityRequestPDF(patient);
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

    // 2. TXT fájlok
    const treatmentPlanText = formatTreatmentPlan(patient);
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
      { name: 'treatment_plan.txt', size: treatmentPlanBuffer.length },
      { name: 'quote_requests.txt', size: quoteRequestsBuffer.length },
    ];

    // Create ZIP archive stream
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    // Track archive state for proper error handling
    let archiveError: Error | null = null as Error | null;
    let archiveFinished = false;

    // Handle archive errors (critical for proper cleanup)
    archive.on('error', (err: unknown) => {
      const error: Error = err instanceof Error ? err : new Error(String(err));
      logger.error('[NEAK Export] Archive error:', error);
      archiveError = error;
      archive.abort(); // Abort archive on error
    });

    // Track when archive is fully finalized
    archive.on('end', () => {
      archiveFinished = true;
      if (process.env.NODE_ENV === 'development') {
        logger.info('[NEAK Export] Archive finalized successfully');
      }
    });

    // Deterministic ZIP order: 1. PDF-ek, 2. TXT-k, 3. README, 4. documents/
    // 1. PDF-ek
    archive.append(patientSummaryBuffer, { name: 'patient_summary.pdf' });
    archive.append(medicalHistoryBuffer, { name: 'medical_history.pdf' });
    archive.append(dentalStatusBuffer, { name: 'dental_status.pdf' });
    archive.append(equityDentalBuffer, { name: 'equity_request_dental.pdf' });
    archive.append(equityPatientBuffer, { name: 'equity_request_patient_data.pdf' });

    // 2. TXT-k
    archive.append(treatmentPlanBuffer, { name: 'treatment_plan.txt' });
    archive.append(quoteRequestsBuffer, { name: 'quote_requests.txt' });

    // 4. Documents (determinisztikus sorrend: alfanumerikusan docId szerint)
    // Sort előre, hogy a README-ben használhassuk a számot
    const sortedDocuments = [...includedDocuments].sort((a, b) => a.id.localeCompare(b.id));

    // 3. README.txt (deterministic position: after TXT files, before documents)
    // Include document count info; missingFields from FNMT.150.K
    const readmeText = generateReadme(
      exportDate,
      files,
      aiGenerated,
      sortedDocuments.length,
      dentalPdfFailed,
      equityPatientMissingFields.length > 0 ? equityPatientMissingFields : undefined
    );
    const readmeBuffer = Buffer.from(readmeText, 'utf-8');
    limiter.addFile(readmeBuffer.length);
    archive.append(readmeBuffer, { name: 'README.txt' });

    for (const doc of sortedDocuments) {
      try {
        limiter.addDoc();

        // Get full document data from DB
        const docResult = await pool.query(
          `SELECT file_path, filename, file_size FROM patient_documents WHERE id = $1`,
          [doc.id]
        );

        if (docResult.rows.length === 0) {
          console.warn(`[NEAK Export] Document ${doc.id} not found in DB, skipping`);
          continue;
        }

        const docData = docResult.rows[0];

        // Download file with timeout
        const downloadPromise = downloadFile(docData.file_path, patientId);
        const timeoutPromise = new Promise<Buffer>((_, reject) => {
          setTimeout(() => reject(new Error(`File download timeout after ${FILE_DOWNLOAD_TIMEOUT_MS}ms`)), FILE_DOWNLOAD_TIMEOUT_MS);
        });

        const fileBuffer = await Promise.race([downloadPromise, timeoutPromise]);

        // Check per-file size limit (after download, use actual size)
        // Use actual buffer size, not DB file_size (more accurate)
        const actualSize = fileBuffer.length;
        limiter.addFile(actualSize);

        // Determine file path based on category
        const safeName = safeFilename(docData.filename || `document_${doc.id}`);
        let filePath: string;

        if (doc.category === 'quote') {
          filePath = `documents/quotes/${doc.id}_${safeName}`;
        } else if (doc.category === 'allergy') {
          filePath = `documents/allergy/${doc.id}_${safeName}`;
        } else if (doc.category === 'technikus_meltanyossagi') {
          filePath = `documents/technikus_meltanyossagi/${doc.id}_${safeName}`;
        } else {
          filePath = `documents/${doc.id}_${safeName}`;
        }

        // Add to archive
        archive.append(fileBuffer, { name: filePath });

        // Log progress (for debugging)
        if (process.env.NODE_ENV === 'development') {
          logger.info(`[NEAK Export] Added document: ${filePath} (${actualSize} bytes, total: ${limiter.totalBytes} bytes)`);
        }
      } catch (error) {
        logger.error(`[NEAK Export] Error adding document ${doc.id} to archive:`, error);
        
        // Check if it's a limit error and format it properly
        if (error instanceof Error && (
          error.message.startsWith('FILE_TOO_LARGE:') ||
          error.message.startsWith('ZIP_TOO_LARGE:') ||
          error.message.startsWith('TOO_MANY_DOCS:')
        )) {
          const userMessage = ExportLimiter.formatError(error);
          const response = NextResponse.json(
            {
              error: userMessage,
              code: error.message.split(':')[0],
              correlationId,
            },
            { status: 413 }
          );
          response.headers.set('x-correlation-id', correlationId);
          archive.abort();
          return response;
        }
        
        // Abort archive on error
        archive.abort();
        // Re-throw with context for proper error handling
        throw new Error(
          `Failed to add document ${doc.filename || doc.id} to export: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Check if archive had errors during document addition
    if (archiveError) {
      // TypeScript narrowing: archiveError is Error here
      const errorMsg = (archiveError as Error).message;
      throw new Error(`Archive error during document processing: ${errorMsg}`);
    }

    // Finalize archive (this triggers the 'end' event when complete)
    archive.finalize();

    // Create response stream
    const stream = Readable.from(archive);

    // Generate filename
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `NEAK_${patientId}_${dateStr}.zip`;

    // Create response with proper error handling
    const response = new NextResponse(stream as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'x-correlation-id': correlationId,
      },
    });

    // Note: Archive 'end' event will fire when ZIP is fully written
    // Frontend should wait for blob download to complete before logging success
    // (This is handled in PatientDocuments.tsx - success log only after blob download)

    return response;
  } catch (error: any) {
    return handleApiError(error, correlationId);
  }
}
