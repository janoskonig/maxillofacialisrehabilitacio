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
      consentsResult,
    ] = await Promise.all([
      pool.query(
        `SELECT id, nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos, iranyitoszam,
                felvetel_datuma, kezeleoorvos, kezeleoorvos_intezete, intake_status, created_at, updated_at
         FROM patients WHERE id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT beutalo_orvos, beutalo_indokolas, beutalo_intezmeny, mutet_ideje, szovettani_diagnozis
         FROM patient_referral WHERE patient_id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT kezelesre_erkezes_indoka, alkoholfogyasztas, dohanyzas_szam,
                radioterapia, radioterapia_dozis, radioterapia_datum_intervallum,
                chemoterapia, chemoterapia_leiras,
                tnm_staging, bno, diagnozis,
                baleset_idopont, baleset_etiologiaja, baleset_egyeb
         FROM patient_anamnesis WHERE patient_id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT meglevo_fogak, meglevo_implantatumok,
                felso_fogpotlas_van, felso_fogpotlas_tipus,
                also_fogpotlas_van, also_fogpotlas_tipus
         FROM patient_dental_status WHERE patient_id = $1`,
        [patientId]
      ),
      pool.query(
        `SELECT a.id, ats.start_time, a.appointment_type, a.appointment_status,
                ats.dentist_email, a.created_at
         FROM appointments a
         JOIN available_time_slots ats ON a.time_slot_id = ats.id
         WHERE a.patient_id = $1
         ORDER BY ats.start_time DESC`,
        [patientId]
      ),
      pool.query(
        `SELECT id, filename, file_size, mime_type, description, tags, uploaded_at, uploaded_by
         FROM patient_documents WHERE patient_id = $1
         ORDER BY uploaded_at DESC`,
        [patientId]
      ),
      pool.query(
        `SELECT timepoint, total_score, completed_at, created_at
         FROM ohip14_responses WHERE patient_id = $1
         ORDER BY created_at DESC`,
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
