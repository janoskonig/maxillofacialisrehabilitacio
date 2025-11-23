import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Admin statisztikák API végpont
export async function GET(request: NextRequest) {
  try {
    // Csak admin hozzáférés
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az admin statisztikák megtekintéséhez' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const now = new Date();

    // 1. BETEGEK STATISZTIKÁK
    const patientsTotal = await pool.query('SELECT COUNT(*) as total FROM patients');
    const patientsThisMonth = await pool.query(`
      SELECT COUNT(*) as total 
      FROM patients 
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `);
    const patientsLastMonth = await pool.query(`
      SELECT COUNT(*) as total 
      FROM patients 
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND created_at < DATE_TRUNC('month', CURRENT_DATE)
    `);
    const patientsByGender = await pool.query(`
      SELECT 
        COALESCE(nem, 'Nincs adat') as nem,
        COUNT(*) as darab
      FROM patients
      GROUP BY nem
      ORDER BY darab DESC
    `);
    const patientsByEtiology = await pool.query(`
      SELECT 
        COALESCE(kezelesre_erkezes_indoka, 'Nincs adat') as etiologia,
        COUNT(*) as darab
      FROM patients
      GROUP BY kezelesre_erkezes_indoka
      ORDER BY darab DESC
    `);
    const patientsByDoctor = await pool.query(`
      SELECT 
        COALESCE(kezeleoorvos, 'Nincs adat') as orvos,
        COUNT(*) as darab
      FROM patients
      WHERE kezeleoorvos IS NOT NULL
      GROUP BY kezeleoorvos
      ORDER BY darab DESC
      LIMIT 10
    `);

    // 2. FELHASZNÁLÓK STATISZTIKÁK
    const usersTotal = await pool.query('SELECT COUNT(*) as total FROM users');
    const usersByRole = await pool.query(`
      SELECT 
        role,
        COUNT(*) as darab,
        COUNT(*) FILTER (WHERE active = true) as aktiv
      FROM users
      GROUP BY role
      ORDER BY darab DESC
    `);
    const usersActive = await pool.query(`
      SELECT COUNT(*) as total 
      FROM users 
      WHERE active = true
    `);
    const usersInactive = await pool.query(`
      SELECT COUNT(*) as total 
      FROM users 
      WHERE active = false
    `);
    const usersRecent = await pool.query(`
      SELECT COUNT(*) as total 
      FROM users 
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    // 3. IDŐPONTFOGLALÁSOK STATISZTIKÁK
    const appointmentsTotal = await pool.query(`
      SELECT COUNT(*) as total 
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
    `);
    const appointmentsUpcoming = await pool.query(`
      SELECT COUNT(*) as total 
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      WHERE ats.start_time > NOW()
    `);
    const appointmentsPast = await pool.query(`
      SELECT COUNT(*) as total 
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      WHERE ats.start_time <= NOW()
    `);
    const appointmentsThisMonth = await pool.query(`
      SELECT COUNT(*) as total 
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      WHERE ats.start_time >= DATE_TRUNC('month', CURRENT_DATE)
    `);
    const appointmentsByStatus = await pool.query(`
      SELECT 
        COALESCE(a.approval_status, 'pending') as status,
        COUNT(*) as darab
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      GROUP BY a.approval_status
      ORDER BY darab DESC
    `);

    // 4. IDŐSLOTOK STATISZTIKÁK
    const timeSlotsTotal = await pool.query('SELECT COUNT(*) as total FROM available_time_slots');
    const timeSlotsAvailable = await pool.query(`
      SELECT COUNT(*) as total 
      FROM available_time_slots 
      WHERE status = 'available' AND start_time > NOW()
    `);
    const timeSlotsBooked = await pool.query(`
      SELECT COUNT(*) as total 
      FROM available_time_slots 
      WHERE status = 'booked'
    `);

    // 5. AKTIVITÁS STATISZTIKÁK
    const activityTotal = await pool.query('SELECT COUNT(*) as total FROM activity_logs');
    const activityLast7Days = await pool.query(`
      SELECT COUNT(*) as total 
      FROM activity_logs 
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    const activityLast30Days = await pool.query(`
      SELECT COUNT(*) as total 
      FROM activity_logs 
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    const activityByAction = await pool.query(`
      SELECT 
        action,
        COUNT(*) as darab
      FROM activity_logs
      GROUP BY action
      ORDER BY darab DESC
      LIMIT 10
    `);
    const activityByUser = await pool.query(`
      SELECT 
        COALESCE(user_email, 'unknown') as user_email,
        COUNT(*) as darab
      FROM activity_logs
      GROUP BY user_email
      ORDER BY darab DESC
      LIMIT 10
    `);

    // 6. VISSZAJELZÉSEK STATISZTIKÁK
    const feedbackTotal = await pool.query('SELECT COUNT(*) as total FROM feedback');
    const feedbackByStatus = await pool.query(`
      SELECT 
        status,
        COUNT(*) as darab
      FROM feedback
      GROUP BY status
      ORDER BY darab DESC
    `);
    const feedbackByType = await pool.query(`
      SELECT 
        type,
        COUNT(*) as darab
      FROM feedback
      GROUP BY type
      ORDER BY darab DESC
    `);

    // 7. DOKUMENTUMOK STATISZTIKÁK
    const documentsTotal = await pool.query('SELECT COUNT(*) as total FROM patient_documents');
    const documentsRecent = await pool.query(`
      SELECT COUNT(*) as total 
      FROM patient_documents 
      WHERE uploaded_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    return NextResponse.json({
      betegek: {
        osszes: parseInt(patientsTotal.rows[0].total),
        ebbenAHonapban: parseInt(patientsThisMonth.rows[0].total),
        multHonapban: parseInt(patientsLastMonth.rows[0].total),
        nemSzerint: patientsByGender.rows.map(row => ({
          nem: row.nem,
          darab: parseInt(row.darab)
        })),
        etiologiaSzerint: patientsByEtiology.rows.map(row => ({
          etiologia: row.etiologia,
          darab: parseInt(row.darab)
        })),
        orvosSzerint: patientsByDoctor.rows.map(row => ({
          orvos: row.orvos,
          darab: parseInt(row.darab)
        }))
      },
      felhasznalok: {
        osszes: parseInt(usersTotal.rows[0].total),
        aktiv: parseInt(usersActive.rows[0].total),
        inaktiv: parseInt(usersInactive.rows[0].total),
        utolso30Napban: parseInt(usersRecent.rows[0].total),
        szerepkorSzerint: usersByRole.rows.map(row => ({
          szerepkor: row.role,
          osszes: parseInt(row.darab),
          aktiv: parseInt(row.aktiv)
        }))
      },
      idopontfoglalasok: {
        osszes: parseInt(appointmentsTotal.rows[0].total),
        jovobeli: parseInt(appointmentsUpcoming.rows[0].total),
        multbeli: parseInt(appointmentsPast.rows[0].total),
        ebbenAHonapban: parseInt(appointmentsThisMonth.rows[0].total),
        statusSzerint: appointmentsByStatus.rows.map(row => ({
          status: row.status,
          darab: parseInt(row.darab)
        }))
      },
      idoslotok: {
        osszes: parseInt(timeSlotsTotal.rows[0].total),
        elerheto: parseInt(timeSlotsAvailable.rows[0].total),
        lefoglalt: parseInt(timeSlotsBooked.rows[0].total)
      },
      aktivitas: {
        osszes: parseInt(activityTotal.rows[0].total),
        utolso7Nap: parseInt(activityLast7Days.rows[0].total),
        utolso30Nap: parseInt(activityLast30Days.rows[0].total),
        muveletSzerint: activityByAction.rows.map(row => ({
          muvelet: row.action,
          darab: parseInt(row.darab)
        })),
        felhasznaloSzerint: activityByUser.rows.map(row => ({
          felhasznalo: row.user_email,
          darab: parseInt(row.darab)
        }))
      },
      visszajelzesek: {
        osszes: parseInt(feedbackTotal.rows[0].total),
        statusSzerint: feedbackByStatus.rows.map(row => ({
          status: row.status,
          darab: parseInt(row.darab)
        })),
        tipusSzerint: feedbackByType.rows.map(row => ({
          tipus: row.type,
          darab: parseInt(row.darab)
        }))
      },
      dokumentumok: {
        osszes: parseInt(documentsTotal.rows[0].total),
        utolso30Napban: parseInt(documentsRecent.rows[0].total)
      }
    });
  } catch (error) {
    console.error('Hiba a statisztikák lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}



