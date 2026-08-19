/**
 * OHIP-14 emlékeztető diagnosztika egy betegre.
 *
 * Megmondja, hogy a heti OHIP-14 emlékeztető (lib/ohip14-reminders.ts,
 * hétfő 08:00 Europe/Budapest, scripts/cron-sync.js) miért NEM küldött
 * levelet egy adott betegnek — pontosan ugyanazokat a kapukat lépteti
 * végig, mint az éles kód (ugyanazokat a függvényeket importálja, hogy ne
 * tudjon szétcsúszni tőle).
 *
 * Használat:
 *   npx tsx scripts/diagnose-ohip-reminder.ts "Gellért Mónika"
 *   npx tsx scripts/diagnose-ohip-reminder.ts <patient-uuid>
 *   npx tsx scripts/diagnose-ohip-reminder.ts "Gellért Mónika" T1   # konkrét timepoint
 */
import 'dotenv/config';
import { getDbPool } from '../lib/db';
import { getOhipPatientContext } from '../lib/ohip14-stage';
import { getTimepointAvailability } from '../lib/ohip14-timepoint-stage';
import { isEmailDryRun } from '../lib/email/config';
import { OHIP14_TIMEPOINTS, type OHIP14Timepoint } from '../lib/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REMINDER_COOLDOWN_DAYS = 7;

function fmt(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : '—';
}

async function main() {
  const needle = process.argv[2];
  const wantedTimepoint = (process.argv[3] as OHIP14Timepoint | undefined) ?? null;
  if (!needle) {
    console.error('Használat: npx tsx scripts/diagnose-ohip-reminder.ts "<név vagy patient id>" [timepoint]');
    process.exit(1);
  }

  const pool = getDbPool();

  // ── 0) Beteg ────────────────────────────────────────────────────────
  const patientRes = UUID_RE.test(needle)
    ? await pool.query(`SELECT id, nev, nem, email FROM patients WHERE id = $1`, [needle])
    : await pool.query(
        `SELECT id, nev, nem, email FROM patients WHERE nev ILIKE $1 ORDER BY nev LIMIT 10`,
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
  console.log(`\n=== ${patient.nev} (${patient.id}) ===`);
  console.log(`email: ${patient.email || '(nincs)'}`);

  const blockers: string[] = [];

  // ── 1) E-mail cím ───────────────────────────────────────────────────
  if (!patient.email) {
    blockers.push('A patients.email üres → a beteg bele sem kerül az emlékeztető lekérdezésébe.');
  }

  // ── 2) Nyitott epizód (a fő lekérdezés kötelező feltétele) ──────────
  const epRes = await pool.query(
    `SELECT id, status, opened_at, closed_at FROM patient_episodes
      WHERE patient_id = $1 ORDER BY opened_at DESC`,
    [patient.id],
  );
  console.log('\nEpizódok:');
  for (const e of epRes.rows) {
    console.log(`  ${e.id}  status=${e.status}  nyitva=${fmt(e.opened_at)}  zárva=${fmt(e.closed_at)}`);
  }
  const hasOpenEpisode = epRes.rows.some((e: any) => e.status === 'open');
  if (!hasOpenEpisode) {
    blockers.push(
      'Nincs "open" státuszú epizód → a sendOhipReminders fő lekérdezése (JOIN patient_episodes ... status = \'open\') kihagyja a beteget, akkor is, ha egyébként esedékes lenne a kérdőív.',
    );
  }

  // ── 3) OHIP kontextus: epizód, stádium, átadás dátuma ───────────────
  const ctx = await getOhipPatientContext(pool, patient.id);
  console.log('\nOHIP kontextus:');
  console.log(`  episodeId    = ${ctx.episodeId ?? '(nincs)'}`);
  console.log(`  stageCode    = ${ctx.stageCode ?? '(nincs stage_event)'}`);
  console.log(`  deliveryDate = ${fmt(ctx.deliveryDate)}`);

  const stageRes = await pool.query(
    `SELECT stage_code, at, episode_id FROM stage_events
      WHERE patient_id = $1 ORDER BY at DESC LIMIT 20`,
    [patient.id],
  );
  console.log('\nStádium-események (max 20):');
  if (stageRes.rows.length === 0) console.log('  (nincs)');
  for (const s of stageRes.rows) {
    const sameEp = s.episode_id === ctx.episodeId ? '' : '   ⚠ másik epizód';
    console.log(`  ${fmt(s.at)}  ${s.stage_code}  ep=${s.episode_id}${sameEp}`);
  }
  if (!ctx.deliveryDate) {
    blockers.push(
      'Nincs átadás-dátum (STAGE_6, ill. fallbackként a legkorábbi STAGE_7 esemény az aktuális epizódon) → a T1–T5 időablakok meg sem nyílnak.',
    );
  }

  // ── 4) Kitöltött timepointok ────────────────────────────────────────
  const doneRes = await pool.query(
    `SELECT timepoint, episode_id, completed_at FROM ohip14_responses
      WHERE patient_id = $1 ORDER BY completed_at`,
    [patient.id],
  );
  console.log('\nKitöltött OHIP-14 kérdőívek:');
  if (doneRes.rows.length === 0) console.log('  (nincs)');
  for (const r of doneRes.rows) {
    const sameEp = r.episode_id === ctx.episodeId ? '' : '   ⚠ másik epizód';
    console.log(`  ${r.timepoint}  ${fmt(r.completed_at)}  ep=${r.episode_id}${sameEp}`);
  }
  const completedSet = new Set(
    doneRes.rows.filter((r: any) => r.episode_id === ctx.episodeId).map((r: any) => r.timepoint),
  );

  // ── 5) Időablakok — pontosan a küldő logika sorrendjében ────────────
  console.log('\nIdőablakok (a küldő az ELSŐ nyitott, még kitöltetlen timepointot választja):');
  let pending: OHIP14Timepoint | null = null;
  for (const tp of OHIP14_TIMEPOINTS) {
    const avail = getTimepointAvailability(tp, ctx.stageCode, ctx.deliveryDate);
    const done = completedSet.has(tp);
    const mark = done ? 'kitöltve' : avail.allowed ? 'NYITVA' : 'zárva';
    console.log(
      `  ${tp}  ${mark.padEnd(9)} nyílik=${fmt(avail.opensAt)} zárul=${fmt(avail.closesAt)}` +
        (avail.reason ? `  — ${avail.reason}` : ''),
    );
    if (!done && avail.allowed && !pending) pending = tp;
  }
  console.log(`\n  → esedékes timepoint: ${pending ?? '(egy sem)'}`);
  if (!pending) {
    blockers.push('Nincs nyitott, még kitöltetlen timepoint → a beteg "skipped", és a nyitott in-app feladata lezárul.');
  }
  if (wantedTimepoint && pending !== wantedTimepoint) {
    blockers.push(
      `A keresett ${wantedTimepoint} nem az esedékes timepoint (${pending ?? 'egy sem'}) → erre az időpontra nem megy ki levél. ` +
        `A T1 ablak az átadástól a 30. napig tart; ha lecsúszott, a rendszer a következő (T2) kérdőívre emlékeztet.`,
    );
  }

  // ── 6) Cooldown ─────────────────────────────────────────────────────
  const logRes = await pool.query(
    `SELECT timepoint, sent_at, email_to FROM ohip_reminder_log
      WHERE patient_id = $1 ORDER BY sent_at DESC LIMIT 20`,
    [patient.id],
  );
  console.log('\nohip_reminder_log (max 20):');
  if (logRes.rows.length === 0) console.log('  (nincs)');
  for (const l of logRes.rows) console.log(`  ${fmt(l.sent_at)}  ${l.timepoint}  → ${l.email_to}`);
  if (pending) {
    const recent = logRes.rows.find(
      (l: any) =>
        l.timepoint === pending &&
        Date.now() - new Date(l.sent_at).getTime() < REMINDER_COOLDOWN_DAYS * 86400000,
    );
    if (recent) {
      blockers.push(
        `A ${pending} emlékeztető ${fmt(recent.sent_at)}-én már kiment → ${REMINDER_COOLDOWN_DAYS} napos cooldown miatt kihagyva.`,
      );
    }
  }

  // ── 7) Tényleges kimenő levelek ─────────────────────────────────────
  try {
    const outRes = await pool.query(
      `SELECT created_at, status, recipient, error_message, metadata->>'timepoint' AS timepoint
         FROM outbound_email_log
        WHERE email_type = 'ohip_reminder' AND metadata->>'patientId' = $1
        ORDER BY created_at DESC LIMIT 20`,
      [patient.id],
    );
    console.log('\noutbound_email_log (ohip_reminder, max 20):');
    if (outRes.rows.length === 0) console.log('  (nincs)');
    for (const o of outRes.rows) {
      console.log(
        `  ${fmt(o.created_at)}  ${o.timepoint ?? '?'}  ${o.status}  → ${o.recipient}` +
          (o.error_message ? `  HIBA: ${o.error_message}` : ''),
      );
    }
    const failed = outRes.rows.filter((o: any) => o.status === 'failed');
    if (failed.length > 0) {
      blockers.push(`Az SMTP küldés hibára futott (${failed.length} db): ${failed[0].error_message}`);
    }
    const loggedButNotSent = logRes.rows.length > 0 && outRes.rows.length === 0;
    if (loggedButNotSent) {
      blockers.push(
        'Van ohip_reminder_log bejegyzés, de nincs outbound_email_log sor → a küldés DRY-RUN módban futott (EMAIL_DRY_RUN=true vagy NODE_ENV!=production), a levél nem ment ki, a cooldown viszont bekapcsolt.',
      );
    }
  } catch {
    console.log('\noutbound_email_log: (a tábla nem létezik)');
  }

  // ── 8) Környezet ────────────────────────────────────────────────────
  console.log('\nKörnyezet:');
  console.log(`  NODE_ENV=${process.env.NODE_ENV ?? '(nincs)'}  EMAIL_DRY_RUN=${process.env.EMAIL_DRY_RUN ?? '(nincs)'}  → dryRun=${isEmailDryRun()}`);
  const smtpMissing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter((k) => !process.env[k]?.trim());
  console.log(`  hiányzó SMTP változó: ${smtpMissing.length ? smtpMissing.join(', ') : '(nincs)'}`);
  if (smtpMissing.length > 0) {
    blockers.push(`Hiányzó SMTP konfiguráció: ${smtpMissing.join(', ')} → a sendEmail hibát dob.`);
  }

  // ── Összegzés ───────────────────────────────────────────────────────
  console.log('\n=== Diagnózis ===');
  if (blockers.length === 0) {
    console.log('Nincs kódszintű blokkoló — a következő hétfő 08:00-ás futásnak ki kell küldenie a levelet.');
    console.log('Ha mégsem ment ki: ellenőrizd a Render cron logját (scripts/cron-sync.js csak isMonday && hour===8 esetén hívja a végpontot).');
  } else {
    blockers.forEach((b, i) => console.log(`${i + 1}. ${b}`));
  }
  console.log('');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
