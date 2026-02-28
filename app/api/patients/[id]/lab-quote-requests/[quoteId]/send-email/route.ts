import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { sendEmail } from '@/lib/email';
import { generateLabQuoteRequestPDF } from '@/lib/pdf/lab-quote-request';
import { Patient, patientSchema } from '@/lib/types';

// Labor email címe (tesztelés miatt)
const LAB_EMAIL = 'jancheeta876@gmail.com';
const REPLY_TO_EMAIL = 'konig.janos@semmelweis.hu';

/**
 * Árajánlatkérő PDF email küldése a laboratóriumnak
 */
export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth, params }) => {
  // Jogosultság ellenőrzése - csak admin, editor és sebészorvos
  if (auth.role !== 'admin' && auth.role !== 'editor' && auth.role !== 'sebészorvos') {
    return NextResponse.json(
      { error: 'Nincs jogosultsága email küldéséhez' },
      { status: 403 }
    );
  }

  const pool = getDbPool();
  const patientId = params.id;
  const quoteId = params.quoteId;

  // Beteg adatainak lekérdezése
  const patientResult = await pool.query(
    `SELECT 
        id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
        email, cim, varos, iranyitoszam, kezeleoorvos
      FROM patients
      WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  // Árajánlatkérő lekérdezése
  const quoteResult = await pool.query(
    `SELECT 
        id,
        patient_id as "patientId",
        szoveg,
        datuma,
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy",
        updated_by as "updatedBy"
      FROM lab_quote_requests
      WHERE id = $1 AND patient_id = $2`,
    [quoteId, patientId]
  );

  if (quoteResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Árajánlatkérő nem található' },
      { status: 404 }
    );
  }

  const patientData = patientResult.rows[0];
  const quoteData = quoteResult.rows[0];

  // Konvertáljuk a dátum mezőket string formátumba
  const normalizedPatientData = {
    ...patientData,
    szuletesiDatum: patientData.szuletesiDatum
      ? (patientData.szuletesiDatum instanceof Date
          ? patientData.szuletesiDatum.toISOString().split('T')[0]
          : String(patientData.szuletesiDatum))
      : null,
  };

  const normalizedQuoteData = {
    ...quoteData,
    datuma: quoteData.datuma
      ? (quoteData.datuma instanceof Date
          ? quoteData.datuma.toISOString().split('T')[0]
          : String(quoteData.datuma))
      : null,
  };

  // Validáljuk az adatokat
  const patient = patientSchema.parse(normalizedPatientData) as Patient;
  const quoteRequest = normalizedQuoteData as any;

  // PDF generálása
  const pdfBuffer = await generateLabQuoteRequestPDF(patient, quoteRequest);

  // Email küldése
  const patientName = patient.nev || 'Beteg';
  const formattedDate = quoteRequest.datuma
    ? new Date(quoteRequest.datuma).toLocaleDateString('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '';

  // Tárgy előkészítése (kevesebb ékezetes karakter a spam-szűrők miatt)
  const safeSubject = `Arajanlatkero - ${patientName}`;

  // HTML tartalom előkészítése (tisztább struktúra)
  const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Árajánlatkérő</h2>
          <p>Tisztelt Laboratórium!</p>
          <p>Mellékletben küldjük az árajánlatkérőt a következő beteg részére:</p>
          <ul style="line-height: 1.8;">
            <li><strong>Beteg neve:</strong> ${patientName}</li>
            ${patient.cim ? `<li><strong>Cím:</strong> ${patient.cim}</li>` : ''}
            ${patient.varos ? `<li><strong>Város:</strong> ${patient.varos}</li>` : ''}
            ${patient.iranyitoszam ? `<li><strong>Irányítószám:</strong> ${patient.iranyitoszam}</li>` : ''}
            ${formattedDate ? `<li><strong>Határidő:</strong> ${formattedDate}</li>` : ''}
          </ul>
          ${quoteRequest.szoveg ? `<p style="margin-top: 20px;"><strong>Kérés részletei:</strong></p><p style="white-space: pre-wrap; line-height: 1.6;">${quoteRequest.szoveg.replace(/\n/g, '<br>')}</p>` : ''}
          <p style="margin-top: 30px;">Üdvözlettel,<br><strong>${patient.kezeleoorvos || 'König János'}</strong></p>
          <p style="margin-top: 10px; color: #6b7280; font-size: 12px;">Semmelweis Egyetem<br>Fogorvostudományi Kar<br>Fogpótlástani Klinika</p>
        </div>
      `;

  await sendEmail({
    to: LAB_EMAIL,
    replyTo: REPLY_TO_EMAIL,
    subject: safeSubject,
    html: htmlContent,
    text: `
Árajánlatkérő

Tisztelt Laboratórium!

Mellékletben küldjük az árajánlatkérőt a következő beteg részére:

Beteg neve: ${patientName}
${patient.cim ? `Cím: ${patient.cim}` : ''}
${patient.varos ? `Város: ${patient.varos}` : ''}
${patient.iranyitoszam ? `Irányítószám: ${patient.iranyitoszam}` : ''}
${formattedDate ? `Határidő: ${formattedDate}` : ''}

${quoteRequest.szoveg ? `Kérés részletei:\n${quoteRequest.szoveg}` : ''}

Üdvözlettel,
${patient.kezeleoorvos || 'König János'}

Semmelweis Egyetem
Fogorvostudományi Kar
Fogpótlástani Klinika
      `,
    attachments: [
      {
        filename: `Arajanlatkero_${patientName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return NextResponse.json(
    { success: true, message: 'Email sikeresen elküldve a laboratóriumnak' },
    { status: 200 }
  );
});
