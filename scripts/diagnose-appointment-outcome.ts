/**
 * Napi időpont-kimenetel („mi történt?") mentésének diagnosztikája egy betegre.
 *
 * Megmondja, hogy a PATCH /api/appointments/:id/status melyik kapuján akadna el
 * (vagy akadt el korábban) egy adott beteg időpontjának rögzítése. Ugyanazokat a
 * segédfüggvényeket importálja, mint az éles kód (isDeliveryStepCode), hogy ne
 * tudjon szétcsúszni tőle.
 *
 * Használat:
 *   npx tsx scripts/diagnose-appointment-outcome.ts "Kovács Andrea"
 *   npx tsx scripts/diagnose-appointment-outcome.ts <patient-uuid> 2026-08-25
 */
import 'dotenv/config';
import { getDbPool } from '../lib/db';
import { isDeliveryStepCode } from '../lib/appointment-stage-transition';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function bad(msg: string) { console.log(`  ✗ ${msg}`); }
function info(msg: string) { console.log(`  · ${msg}`); }

async function main() {
  const needle = process.argv[2];
  const day = process.argv[3] ? new Date(`${process.argv[3]}T00:00:00`) : new Date();
  if (!needle) {
    console.error('Használat: npx tsx scripts/diagnose-appointment-outcome.ts "<név vagy patient id>" [YYYY-MM-DD]');
    process.exit(1);
  }

  const pool = getDbPool();

  const patientRes = UUID_RE.test(needle)
    ? await pool.query(`SELECT id, nev, taj FROM patients WHERE id = $1`, [needle])
    : await pool.query(
        `SELECT id, nev, taj FROM patients WHERE nev ILIKE $1 ORDER BY nev LIMIT 10`,
        [`%${needle}%`],
      );

  if (patientRes.rows.length === 0) {
    console.error(`✗ Nincs találat erre: "${needle}"`);
    await pool.end();
    process.exit(1);
  }
  if (patientRes.rows.length > 1) {
    console.log(`Több egyező beteg (${patientRes.rows.length}) — add meg az id-t:`);
    for (const p of patientRes.rows) console.log(`  ${p.id}  ${p.nev}`);
    await pool.end();
    return;
  }

  const patient = patientRes.rows[0];
  const from = new Date(day); from.setHours(0, 0, 0, 0);
  const to = new Date(day); to.setHours(23, 59, 59, 999);
  console.log(`\n=== ${patient.nev} (${patient.id}) — ${from.toISOString().slice(0, 10)} ===`);

  const apptRes = await pool.query(
    `SELECT a.id, a.appointment_status, a.completion_notes, a.appointment_type, a.type_label,
            a.episode_id, a.step_code, a.work_phase_id, a.time_slot_id,
            COALESCE(a.start_time, ats.start_time, a.created_at) AS at,
            ats.start_time AS slot_start
       FROM appointments a
       LEFT JOIN available_time_slots ats ON ats.id = a.time_slot_id
      WHERE a.patient_id = $1
        AND COALESCE(a.start_time, ats.start_time, a.created_at) BETWEEN $2 AND $3
      ORDER BY COALESCE(a.start_time, ats.start_time, a.created_at)`,
    [patient.id, from.toISOString(), to.toISOString()],
  );

  if (apptRes.rows.length === 0) {
    console.log('  Nincs időpont ezen a napon ehhez a beteghez.');
    await pool.end();
    return;
  }

  for (const a of apptRes.rows) {
    console.log(`\n— Időpont ${a.id} @ ${new Date(a.at).toISOString()}`);
    info(`státusz: ${a.appointment_status ?? 'nincs (pending)'} · típus: ${a.appointment_type ?? '—'} · címke: ${a.type_label ?? '—'}`);
    info(`epizód: ${a.episode_id ?? '—'} · step_code: ${a.step_code ?? '—'} · work_phase_id: ${a.work_phase_id ?? '—'}`);
    info(`megjegyzés: ${a.completion_notes ? JSON.stringify(a.completion_notes) : '—'}`);

    // 0) Látszik-e egyáltalán a „Mai időpontok" listában?
    if (!a.time_slot_id || !a.slot_start) {
      bad('nincs available_time_slots kötés — a Mai időpontok lista (JOIN ats) NEM mutatja ezt a sort');
    } else if (new Date(a.slot_start) < from || new Date(a.slot_start) > to) {
      bad(`a slot kezdete (${new Date(a.slot_start).toISOString()}) más napra esik — a lista nem ezen a napon mutatja`);
    } else {
      ok('szerepel a Mai időpontok listájában');
    }

    // 1) Származtatott stádiumváltás (átadás-munkafázis)
    const derivedDelivery = isDeliveryStepCode(a.step_code);
    if (!derivedDelivery) {
      ok('nem átadás-munkafázis — „teljesült" mentéskor nincs automatikus stádiumváltás');
    } else {
      info('átadás-munkafázis: „teljesült" mentéskor a szerver STAGE_6-ra váltana');
      if (!a.episode_id) {
        bad('nincs epizód → a váltás kihagyva (a mentés a javítás után már NEM hasal el ezen)');
      } else {
        const ep = await pool.query(
          `SELECT id, status, reason FROM patient_episodes WHERE id = $1`, [a.episode_id],
        );
        if (ep.rows.length === 0) {
          bad('az epizód nem található → a váltás kihagyva');
        } else {
          const episode = ep.rows[0];
          info(`epizód státusz: ${episode.status} · reason: ${episode.reason}`);
          if (episode.status !== 'open') bad('az epizód nem `open` → a váltás kihagyva');
          const cat = await pool.query(
            `SELECT code FROM stage_catalog WHERE code = 'STAGE_6' AND reason = $1`, [episode.reason],
          );
          if (cat.rows.length === 0) bad('nincs STAGE_6 sor az epizód reason-jéhez a stage_catalog-ban → a váltás kihagyva');
          else ok('STAGE_6 létezik ehhez a reason-höz');
        }
      }
    }

    // 2) Recall-zár
    const recall = await pool.query(
      `SELECT id, completed_at, recall_interval_days FROM episode_tasks
        WHERE appointment_id = $1 AND task_type = 'recall_due'`,
      [a.id],
    );
    if (recall.rows.length > 0) {
      info(`recall-feladathoz kötött időpont (${recall.rows.length} db)`);
      if (a.appointment_type !== 'recall') {
        bad(`a típus „${a.appointment_type ?? 'nincs'}" — típusVÁLTÁS esetén RECALL_TYPE_LOCKED (409). Változatlan típussal a mentés megy.`);
      } else {
        ok('a típus `recall` — a zár nem szólal meg');
      }
    } else {
      ok('nincs recall-feladat kötve');
    }

    // 3) Kötelező mezők
    if (a.appointment_status === 'completed' && !a.completion_notes) {
      bad('teljesült, de nincs „mi történt?" szöveg — új mentésnél kötelező (COMPLETION_NOTES_REQUIRED)');
    }
    if (a.appointment_status === 'unsuccessful') {
      info('sikertelen státusz: a /attempt-outcome végponton keresztül állítható, a /status elutasítja');
    }
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
