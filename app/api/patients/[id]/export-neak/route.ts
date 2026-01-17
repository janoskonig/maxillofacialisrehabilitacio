import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';
import { REQUIRED_DOC_TAGS, getMissingRequiredDocTags, getChecklistStatus, getMissingRequiredFields } from '@/lib/clinical-rules';
import { Patient } from '@/lib/types';
import { downloadFile } from '@/lib/ftp-client';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import archiver from 'archiver';
import { Readable } from 'stream';

// Force Node.js runtime (required for archiver, pdf-lib, Buffer operations)
export const runtime = 'nodejs';

// Size limits
const MAX_EXPORT_SIZE = 200 * 1024 * 1024; // 200 MB total
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB per file
const FILE_DOWNLOAD_TIMEOUT_MS = 30000; // 30 seconds per file

// Feature flag: ENABLE_NEAK_EXPORT
const ENABLE_NEAK_EXPORT = process.env.ENABLE_NEAK_EXPORT === 'true';

/**
 * Helper to get correlation ID from request
 */
function getCorrelationId(req: NextRequest): string {
  return req.headers.get('x-correlation-id')?.toLowerCase() || 'unknown';
}

/**
 * Generate patient_summary.pdf for NEAK export
 */
async function generatePatientSummaryPDF(
  patient: Patient,
  documents: any[],
  checklistStatus: ReturnType<typeof getChecklistStatus>
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const pageWidth = page.getSize().width;
  let yPosition = page.getSize().height - margin;

  // Title
  page.drawText('NEAK Export - Beteg Összefoglaló', {
    x: margin,
    y: yPosition,
    size: 18,
    font: boldFont,
  });
  yPosition -= 40;

  // Patient identification
  page.drawText('Beteg azonosítók:', {
    x: margin,
    y: yPosition,
    size: 12,
    font: boldFont,
  });
  yPosition -= 20;

  if (patient.nev) {
    page.drawText(`Név: ${patient.nev}`, {
      x: margin + 20,
      y: yPosition,
      size: 10,
      font: font,
    });
    yPosition -= 15;
  }

  if (patient.taj) {
    page.drawText(`TAJ: ${patient.taj}`, {
      x: margin + 20,
      y: yPosition,
      size: 10,
      font: font,
    });
    yPosition -= 15;
  }

  yPosition -= 10;

  // Diagnosis / Surgery date
  if (patient.diagnozis) {
    page.drawText(`Diagnózis: ${patient.diagnozis}`, {
      x: margin,
      y: yPosition,
      size: 10,
      font: font,
    });
    yPosition -= 15;
  }

  if (patient.mutetIdeje) {
    page.drawText(`Műtét ideje: ${patient.mutetIdeje}`, {
      x: margin,
      y: yPosition,
      size: 10,
      font: font,
    });
    yPosition -= 15;
  }

  yPosition -= 20;

  // Checklist summary
  page.drawText('Checklist összefoglaló:', {
    x: margin,
    y: yPosition,
    size: 12,
    font: boldFont,
  });
  yPosition -= 20;

  // Required fields status
  const missingFields = getMissingRequiredFields(patient);
  page.drawText(
    `Kötelező mezők: ${missingFields.length === 0 ? '✓ Minden megvan' : `✗ ${missingFields.length} hiányzik`}`,
    {
      x: margin + 20,
      y: yPosition,
      size: 10,
      font: font,
    }
  );
  yPosition -= 15;

  // Required documents status
  const missingDocs = getMissingRequiredDocTags(documents);
  page.drawText(
    `Kötelező dokumentumok: ${missingDocs.length === 0 ? '✓ Minden megvan' : `✗ ${missingDocs.length} hiányzik`}`,
    {
      x: margin + 20,
      y: yPosition,
      size: 10,
      font: font,
    }
  );
  yPosition -= 20;

  // Required tags list
  page.drawText('Kötelező tag-ek:', {
    x: margin,
    y: yPosition,
    size: 10,
    font: boldFont,
  });
  yPosition -= 15;

  REQUIRED_DOC_TAGS.forEach((tag) => {
    const hasTag = documents.some((doc) =>
      (doc.tags || []).some((t: string) => t.toLowerCase() === tag.toLowerCase())
    );
    page.drawText(`${hasTag ? '✓' : '✗'} ${tag.toUpperCase()}`, {
      x: margin + 20,
      y: yPosition,
      size: 10,
      font: font,
    });
    yPosition -= 15;
  });

  // Export date
  yPosition -= 20;
  page.drawText(`Export dátuma: ${new Date().toLocaleString('hu-HU')}`, {
    x: margin,
    y: yPosition,
    size: 9,
    font: font,
  });

  // Generate PDF buffer
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Dry-run endpoint: Check if patient is ready for NEAK export
 * GET /api/patients/[id]/export-neak?dryRun=1
 * Export endpoint: Generate and download NEAK package
 * GET /api/patients/[id]/export-neak
 */
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

    // Get patient data
    const patientResult = await pool.query(
      `SELECT 
        id, nev, taj, diagnozis, szuletesi_datum as "szuletesiDatum", 
        mutet_ideje as "mutetIdeje", created_at as "createdAt"
      FROM patients 
      WHERE id = $1`,
      [patientId]
    );

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

    const patient = patientResult.rows[0] as Patient;

    // Get documents with tags
    const documentsResult = await pool.query(
      `SELECT 
        id, filename, tags, file_size as "fileSize", file_path as "filePath"
      FROM patient_documents
      WHERE patient_id = $1`,
      [patientId]
    );

    const documents = documentsResult.rows;

    // Check missing required doc tags
    const missingDocTags = getMissingRequiredDocTags(documents);

    // Get documents that match required tags (for includedDocuments list)
    const includedDocuments: Array<{
      id: string;
      tags: string[];
      filename?: string;
      sizeBytes?: number;
    }> = [];

    documents.forEach((doc: any) => {
      const docTags = (doc.tags || []) as string[];
      const hasRequiredTag = REQUIRED_DOC_TAGS.some((requiredTag) =>
        docTags.some((tag: string) => tag.toLowerCase() === requiredTag.toLowerCase())
      );

      if (hasRequiredTag) {
        includedDocuments.push({
          id: doc.id,
          tags: docTags,
          filename: doc.filename || undefined,
          sizeBytes: doc.fileSize || undefined,
        });
      }
    });

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
          requiredDocTags: [...REQUIRED_DOC_TAGS],
          includedDocuments,
          estimatedTotalBytes: estimatedTotalBytes > 0 ? estimatedTotalBytes : undefined,
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

    // Size limit: 200 MB
    if (estimatedTotalBytes > MAX_EXPORT_SIZE) {
      const response = NextResponse.json(
        {
          error: 'Az export csomag mérete meghaladja a maximumot (200 MB)',
          code: 'EXPORT_TOO_LARGE',
          details: {
            estimatedTotalBytes,
            maxSize: MAX_EXPORT_SIZE,
          },
          correlationId,
        },
        { status: 413 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    // Generate patient_summary.pdf
    const pdfBuffer = await generatePatientSummaryPDF(patient, documents, checklistStatus);

    // Create ZIP archive stream
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    // Add PDF to ZIP
    archive.append(pdfBuffer, { name: 'patient_summary.pdf' });

    // Add required documents to ZIP
    // IMPORTANT: Process sequentially (not in parallel) to avoid memory spikes
    // Each file is downloaded, checked, and added one at a time
    let totalSize = pdfBuffer.length;

    for (const doc of includedDocuments) {
      try {
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

        // Per-file size limit check (before download)
        if (docData.file_size && docData.file_size > MAX_FILE_SIZE) {
          throw new Error(
            `Document ${docData.filename || doc.id} exceeds per-file size limit: ${docData.file_size} > ${MAX_FILE_SIZE} bytes`
          );
        }

        // Download file with timeout
        const downloadPromise = downloadFile(docData.file_path, patientId);
        const timeoutPromise = new Promise<Buffer>((_, reject) => {
          setTimeout(() => reject(new Error(`File download timeout after ${FILE_DOWNLOAD_TIMEOUT_MS}ms`)), FILE_DOWNLOAD_TIMEOUT_MS);
        });

        const fileBuffer = await Promise.race([downloadPromise, timeoutPromise]);

        // Check per-file size limit (after download, in case DB size was wrong)
        if (fileBuffer.length > MAX_FILE_SIZE) {
          throw new Error(
            `Document ${docData.filename || doc.id} exceeds per-file size limit: ${fileBuffer.length} > ${MAX_FILE_SIZE} bytes`
          );
        }

        // Check total size limit
        totalSize += fileBuffer.length;
        if (totalSize > MAX_EXPORT_SIZE) {
          throw new Error(
            `Export size exceeds limit: ${totalSize} > ${MAX_EXPORT_SIZE} bytes (after adding ${docData.filename || doc.id})`
          );
        }

        // Add to archive
        const filename = docData.filename || `document_${doc.id}`;
        archive.append(fileBuffer, { name: `documents/${filename}` });

        // Log progress (for debugging)
        if (process.env.NODE_ENV === 'development') {
          console.log(`[NEAK Export] Added document: ${filename} (${fileBuffer.length} bytes, total: ${totalSize} bytes)`);
        }
      } catch (error) {
        console.error(`[NEAK Export] Error adding document ${doc.id} to archive:`, error);
        // Re-throw with context for proper error handling
        throw new Error(
          `Failed to add document ${doc.filename || doc.id} to export: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Finalize archive
    archive.finalize();

    // Create response stream
    const stream = Readable.from(archive);

    // Generate filename
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `NEAK_${patientId}_${dateStr}.zip`;

    const response = new NextResponse(stream as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'x-correlation-id': correlationId,
      },
    });

    return response;
  } catch (error: any) {
    return handleApiError(error, correlationId);
  }
}
