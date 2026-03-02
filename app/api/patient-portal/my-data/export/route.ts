import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  try {
    const [
      patientResult,
      referralResult,
      anamnesisResult,
      dentalResult,
      appointmentsResult,
      documentsResult,
      ohipResult,
      episodesResult,
      consentsResult,
    ] = await Promise.all([
      pool.query(
        `SELECT id, nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos, iranyitoszam,
                felvetel_datuma, kezeleoorvos, kezeleoorvos_intezete, intake_status, created_at, updated_at
         FROM patients WHERE id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT beutalo_orvos, beutalo_indokolas, beutalo_intezet, mutet_datuma, diagnozis, bno_kod
         FROM patient_referral WHERE patient_id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT anamnezis, radioterpia, radioterpia_dozisgray, radioterpia_ido, kemoterpia, kemoterpia_leiras,
                dohanyzas, alkohol, etiologia, egyeb_anamnezis, baleset_datum, kortorteneti_osszefoglalo
         FROM patient_anamnesis WHERE patient_id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT fogak, implantatum, fogpotlas
         FROM patient_dental_status WHERE patient_id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT a.id, ats.start_time, ats.end_time, a.appointment_type, a.notes, a.status,
                ats.dentist_email, a.created_at
         FROM appointments a
         JOIN available_time_slots ats ON a.time_slot_id = ats.id
         WHERE a.patient_id = $1
         ORDER BY ats.start_time DESC`,
        [patientId]
      ),
      pool.query(
        `SELECT id, filename, original_filename, mime_type, file_size, tags, uploaded_at, uploaded_by
         FROM patient_documents WHERE patient_id = $1
         ORDER BY uploaded_at DESC`,
        [patientId]
      ),
      pool.query(
        `SELECT stage, responses, completed_at, created_at
         FROM ohip14_responses WHERE patient_id = $1
         ORDER BY created_at DESC`,
        [patientId]
      ),
      pool.query(
        `SELECT id, stage, status, started_at, completed_at, notes
         FROM episodes WHERE patient_id = $1
         ORDER BY started_at DESC`,
        [patientId]
      ),
      pool.query(
        `SELECT purpose, policy_version, given_at, withdrawn_at
         FROM gdpr_consents WHERE patient_id = $1
         ORDER BY given_at DESC`,
        [patientId]
      ),
    ]);

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const exportData = {
      exportInfo: {
        exportDate: new Date().toISOString(),
        format: 'GDPR Art. 20 Data Portability Export',
        dataController: 'Maxillofacialis Rehabilitációs Rendszer',
        contact: 'janos.koenig@gmail.com',
      },
      personalData: patientResult.rows[0],
      referralData: referralResult.rows[0] || null,
      medicalHistory: anamnesisResult.rows[0] || null,
      dentalStatus: dentalResult.rows[0] || null,
      appointments: appointmentsResult.rows,
      documents: documentsResult.rows.map((doc: any) => ({
        ...doc,
        note: 'File contents are not included in this export. Contact the data controller to request document copies.',
      })),
      ohip14Responses: ohipResult.rows,
      episodes: episodesResult.rows,
      consentRecords: consentsResult.rows,
    };

    const jsonString = JSON.stringify(exportData, null, 2);

    return new NextResponse(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="gdpr-data-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (error) {
    logger.error('Error exporting patient data:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok exportálása során' },
      { status: 500 }
    );
  }
});
