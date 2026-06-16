/**
 * Showcase demo seed — realistic (but fully fictional) Hungarian demo data
 * for capturing product screenshots. Safe to re-run: clears demo rows first.
 *
 *   node scripts/seed-showcase-demo.js
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

function daysFromNow(d, hour = 9, min = 0) {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(hour, min, 0, 0);
  return dt;
}

async function main() {
  console.log('Seeding showcase demo data…');

  // ── Users ────────────────────────────────────────────────────────────────
  const hash = await bcrypt.hash('Demo1234!', 10);
  const users = [
    { email: 'admin@demo.hu', role: 'admin', name: 'Dr. Kovács Anna', int: 'Semmelweis Egyetem, Fogpótlástani Klinika' },
    { email: 'fogpotlas@demo.hu', role: 'fogpótlástanász', name: 'Dr. Nagy Péter', int: 'Semmelweis Egyetem, Fogpótlástani Klinika' },
    { email: 'technikus@demo.hu', role: 'technikus', name: 'Szabó László', int: 'DentLab Kft.' },
    { email: 'beutalo@demo.hu', role: 'beutalo_orvos', name: 'Dr. Tóth Eszter', int: 'Országos Onkológiai Intézet' },
  ];
  const userId = {};
  for (const u of users) {
    const r = await q(
      `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny, restricted_view)
       VALUES ($1,$2,$3,true,$4,$5,false)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role,
         active=true, doktor_neve=EXCLUDED.doktor_neve, intezmeny=EXCLUDED.intezmeny
       RETURNING id`,
      [u.email, hash, u.role, u.name, u.int]
    );
    userId[u.email] = r.rows[0].id;
  }
  console.log(`  users: ${Object.keys(userId).length}`);
  const provider = userId['fogpotlas@demo.hu'];
  const admin = userId['admin@demo.hu'];

  // ── Treatment types + care pathways ───────────────────────────────────────
  const ttMap = {};
  for (const [code, label, reason] of [
    ['onko_obturator', 'Onkológiai protetikai rehabilitáció', 'onkológiai kezelés utáni állapot'],
    ['trauma_defektus', 'Traumás defektus ellátása', 'traumás sérülés'],
    ['veleszuletett', 'Veleszületett rendellenesség korrekciója', 'veleszületett rendellenesség'],
  ]) {
    try {
      const r = await q(
        `INSERT INTO treatment_types (code, label_hu) VALUES ($1,$2)
         ON CONFLICT (code) DO UPDATE SET label_hu=EXCLUDED.label_hu RETURNING id`,
        [code, label]
      );
      ttMap[reason] = r.rows[0].id;
    } catch (e) {
      const r = await q(`SELECT id FROM treatment_types WHERE code=$1`, [code]);
      if (r.rows[0]) ttMap[reason] = r.rows[0].id;
    }
  }

  const pathwayId = {};
  const pathways = [
    {
      name: 'Onkológiai obturátor protézis útvonal', reason: 'onkológiai kezelés utáni állapot',
      steps: [
        { step_code: 'konzultacio', pool: 'consult', duration_minutes: 45, default_days_offset: 0 },
        { step_code: 'lenyomatvetel', pool: 'work', duration_minutes: 60, default_days_offset: 7 },
        { step_code: 'probalas', pool: 'work', duration_minutes: 45, default_days_offset: 21 },
        { step_code: 'atadas', pool: 'work', duration_minutes: 45, default_days_offset: 35 },
        { step_code: 'kontroll', pool: 'control', duration_minutes: 30, default_days_offset: 56 },
      ],
    },
    {
      name: 'Traumás defektus rehabilitációs útvonal', reason: 'traumás sérülés',
      steps: [
        { step_code: 'konzultacio', pool: 'consult', duration_minutes: 45, default_days_offset: 0 },
        { step_code: 'implantacio_terv', pool: 'work', duration_minutes: 60, default_days_offset: 14 },
        { step_code: 'lenyomatvetel', pool: 'work', duration_minutes: 60, default_days_offset: 30 },
        { step_code: 'atadas', pool: 'work', duration_minutes: 45, default_days_offset: 60 },
      ],
    },
    {
      name: 'Veleszületett rendellenesség útvonal', reason: 'veleszületett rendellenesség',
      steps: [
        { step_code: 'konzultacio', pool: 'consult', duration_minutes: 45, default_days_offset: 0 },
        { step_code: 'lenyomatvetel', pool: 'work', duration_minutes: 60, default_days_offset: 10 },
        { step_code: 'probalas', pool: 'work', duration_minutes: 45, default_days_offset: 24 },
        { step_code: 'atadas', pool: 'work', duration_minutes: 45, default_days_offset: 38 },
      ],
    },
  ];
  for (const p of pathways) {
    // care_pathways has an XOR constraint: set treatment_type_id OR reason, not both.
    const tt = ttMap[p.reason] || null;
    const r = await q(
      `INSERT INTO care_pathways (name, reason, steps_json, version, priority, treatment_type_id, owner_id)
       VALUES ($1,$2,$3,1,0,$4,$5) RETURNING id`,
      [p.name, tt ? null : p.reason, JSON.stringify(p.steps), tt, provider]
    );
    pathwayId[p.reason] = r.rows[0].id;
  }
  console.log(`  care_pathways: ${Object.keys(pathwayId).length}`);

  // ── Patients (via patients_full view trigger) ─────────────────────────────
  const T = '11111111'; // teeth helper
  const onko = 'onkológiai kezelés utáni állapot';
  const trauma = 'traumás sérülés';
  const veles = 'veleszületett rendellenesség';
  const patientsData = [
    {
      nev: 'Horváth Béla', taj: '123 456 789', telefonszam: '+36 30 111 2233', email: 'horvath.bela@example.hu',
      szuletesi_datum: '1958-03-12', nem: 'ferfi', varos: 'Budapest', iranyitoszam: '1085', cim: 'Üllői út 26.',
      reason: onko, beutalo_orvos: 'Dr. Tóth Eszter', beutalo_intezmeny: 'Országos Onkológiai Intézet',
      szovettani_diagnozis: 'Planocelluláris carcinoma (maxilla)', tnm_staging: 'pT2 N0 M0', bno: 'C03.0',
      radioterapia: true, radioterapia_dozis: '60 Gy', maxilladefektus_van: true, brown_fuggoleges_osztaly: '2', brown_vizszintes_komponens: 'b',
      dohanyzas_szam: '20 szál/nap (leszokott 2022)', nyalmirigy_allapot: 'hiposzaliváció',
      felso_fogpotlas_van: true, felso_fogpotlas_tipus: 'zárólemez', also_fogpotlas_van: true, also_fogpotlas_tipus: 'kapocselhorgonyzású részleges fémlemezes fogpótlás',
      meglevo_fogak: { 33: 'ép', 34: 'ép', 43: 'ép', 44: 'tömött' },
      meglevo_implantatumok: { 16: 'Straumann BLT 4.1x10mm, 2023.05.15' },
      diag: 'Maxilladefektus obturátor protézissel ellátva',
    },
    {
      nev: 'Kiss Mária', taj: '234 567 890', telefonszam: '+36 20 222 3344', email: 'kiss.maria@example.hu',
      szuletesi_datum: '1965-07-25', nem: 'no', varos: 'Debrecen', iranyitoszam: '4032', cim: 'Nagyerdei krt. 98.',
      reason: onko, beutalo_orvos: 'Dr. Tóth Eszter', beutalo_intezmeny: 'Országos Onkológiai Intézet',
      szovettani_diagnozis: 'Adenoid cysticus carcinoma', tnm_staging: 'pT3 N1 M0', bno: 'C06.9',
      radioterapia: true, radioterapia_dozis: '66 Gy', chemoterapia: true, chemoterapia_leiras: 'Cisplatin alapú',
      mandibuladefektus_van: true, kovacs_dobak_osztaly: '3', gombocos_beszed: true, nyalmirigy_allapot: 'hiposzaliváció',
      meglevo_fogak: { 31: 'ép', 32: 'ép', 41: 'ép', 42: 'ép' },
      diag: 'Mandibuladefektus, beszédrehabilitáció folyamatban',
    },
    {
      nev: 'Nagy János', taj: '345 678 901', telefonszam: '+36 70 333 4455', email: 'nagy.janos@example.hu',
      szuletesi_datum: '1990-11-03', nem: 'ferfi', varos: 'Szeged', iranyitoszam: '6720', cim: 'Tisza Lajos krt. 47.',
      reason: trauma, beutalo_orvos: 'Dr. Varga Gábor', beutalo_intezmeny: 'SZTE Traumatológia',
      baleset_idopont: '2024-09-18', baleset_etiologiaja: 'Közlekedési baleset (motoros)',
      mandibuladefektus_van: true, kovacs_dobak_osztaly: '2',
      meglevo_fogak: { 36: 'ép', 37: 'ép', 46: 'ép', 47: 'ép', 33: 'ép', 43: 'ép' },
      meglevo_implantatumok: { 41: 'Nobel Active 3.5x11.5mm, 2025.01.20', 31: 'Nobel Active 3.5x11.5mm, 2025.01.20' },
      diag: 'Symphysis defektus implantátum-retinált hídpótlással',
    },
    {
      nev: 'Tóth Erzsébet', taj: '456 789 012', telefonszam: '+36 30 444 5566', email: 'toth.erzsebet@example.hu',
      szuletesi_datum: '1972-01-30', nem: 'no', varos: 'Pécs', iranyitoszam: '7621', cim: 'Király u. 12.',
      reason: veles, beutalo_orvos: 'Dr. Fekete Pál', beutalo_intezmeny: 'PTE Arc-Állcsont Sebészet',
      diagnozis: 'Cheilognathopalatoschisis (operált)', bno: 'Q37.9',
      maxilladefektus_van: true, brown_fuggoleges_osztaly: '1', brown_vizszintes_komponens: 'a',
      veleszuletett_rendellenessegek: ['ajak- és szájpadhasadék'],
      felso_fogpotlas_van: true, felso_fogpotlas_tipus: 'rögzített fogpótlás fogakon elhorgonyozva',
      meglevo_fogak: { 13: 'ép', 12: 'hiányzik', 11: 'ép', 21: 'ép', 22: 'hiányzik', 23: 'ép' },
      diag: 'Palatum-elégtelenség, obturátor + beszédterápia',
    },
    {
      nev: 'Varga Sándor', taj: '567 890 123', telefonszam: '+36 20 555 6677', email: 'varga.sandor@example.hu',
      szuletesi_datum: '1949-05-14', nem: 'ferfi', varos: 'Győr', iranyitoszam: '9024', cim: 'Bartók Béla út 5.',
      reason: onko, beutalo_orvos: 'Dr. Tóth Eszter', beutalo_intezmeny: 'Petz Aladár Kórház',
      szovettani_diagnozis: 'Laphámrák (nyelvgyök)', tnm_staging: 'pT4 N2 M0', bno: 'C01',
      radioterapia: true, radioterapia_dozis: '70 Gy', nyaki_blokkdisszekcio: 'volt, kétoldali',
      dohanyzas_szam: '30 szál/nap', alkoholfogyasztas: 'rendszeres', nyalmirigy_allapot: 'hiposzaliváció',
      meglevo_fogak: {}, felso_fogpotlas_van: true, felso_fogpotlas_tipus: 'teljes lemezes fogpótlás', also_fogpotlas_van: true, also_fogpotlas_tipus: 'teljes lemezes fogpótlás',
      diag: 'Teljes fogatlanság, nyelési nehezítettség',
    },
    {
      nev: 'Balogh Katalin', taj: '678 901 234', telefonszam: '+36 70 666 7788', email: 'balogh.katalin@example.hu',
      szuletesi_datum: '1983-09-08', nem: 'no', varos: 'Budapest', iranyitoszam: '1134', cim: 'Lehel u. 41.',
      reason: trauma, beutalo_orvos: 'Dr. Varga Gábor', beutalo_intezmeny: 'Honvédkórház',
      baleset_idopont: '2025-02-11', baleset_etiologiaja: 'Esés (kerékpár)',
      meglevo_fogak: { 11: 'törött', 21: 'hiányzik', 22: 'ép', 12: 'ép' },
      diag: 'Frontfog-trauma, ideiglenes pótlás',
    },
    {
      nev: 'Molnár Zoltán', taj: '789 012 345', telefonszam: '+36 30 777 8899', email: 'molnar.zoltan@example.hu',
      szuletesi_datum: '1960-12-19', nem: 'ferfi', varos: 'Miskolc', iranyitoszam: '3530', cim: 'Széchenyi u. 70.',
      reason: onko, beutalo_orvos: 'Dr. Tóth Eszter', beutalo_intezmeny: 'BAZ Megyei Kórház',
      szovettani_diagnozis: 'Carcinoma (gingiva)', tnm_staging: 'pT2 N0 M0', bno: 'C03.1',
      radioterapia: true, radioterapia_dozis: '60 Gy', mandibuladefektus_van: true, kovacs_dobak_osztaly: '4',
      meglevo_fogak: { 33: 'ép', 34: 'ép', 35: 'ép' },
      diag: 'Részleges mandibularesectio utáni állapot',
    },
    {
      nev: 'Farkas Ágnes', taj: '890 123 456', telefonszam: '+36 20 888 9900', email: 'farkas.agnes@example.hu',
      szuletesi_datum: '2001-04-22', nem: 'no', varos: 'Szombathely', iranyitoszam: '9700', cim: 'Fő tér 3.',
      reason: veles, beutalo_orvos: 'Dr. Fekete Pál', beutalo_intezmeny: 'Markusovszky Kórház',
      diagnozis: 'Hypodontia (multiplex foghiány)', bno: 'K00.0',
      meglevo_fogak: { 16: 'ép', 26: 'ép', 36: 'ép', 46: 'ép', 11: 'ép', 21: 'ép' },
      diag: 'Multiplex foghiány, implantációs terv',
    },
    {
      nev: 'Takács Gábor', taj: '901 234 567', telefonszam: '+36 70 999 0011', email: 'takacs.gabor@example.hu',
      szuletesi_datum: '1955-08-17', nem: 'ferfi', varos: 'Kecskemét', iranyitoszam: '6000', cim: 'Rákóczi út 14.',
      reason: onko, beutalo_orvos: 'Dr. Tóth Eszter', beutalo_intezmeny: 'Bács-Kiskun Megyei Kórház',
      szovettani_diagnozis: 'Laphámrák (bucca)', tnm_staging: 'pT3 N1 M0', bno: 'C06.0',
      radioterapia: true, radioterapia_dozis: '64 Gy', maxilladefektus_van: true, brown_fuggoleges_osztaly: '3', brown_vizszintes_komponens: 'c',
      nyalmirigy_allapot: 'hiposzaliváció', meglevo_fogak: { 43: 'ép', 44: 'ép', 45: 'ép' },
      diag: 'Kiterjedt maxilladefektus, obturátor készül',
    },
    {
      nev: 'Juhász Ilona', taj: '012 345 678', telefonszam: '+36 30 123 0099', email: 'juhasz.ilona@example.hu',
      szuletesi_datum: '1978-06-05', nem: 'no', varos: 'Eger', iranyitoszam: '3300', cim: 'Dobó tér 8.',
      reason: trauma, beutalo_orvos: 'Dr. Varga Gábor', beutalo_intezmeny: 'Markhot Ferenc Kórház',
      baleset_idopont: '2024-12-02', baleset_etiologiaja: 'Munkahelyi baleset',
      maxilladefektus_van: true, brown_fuggoleges_osztaly: '1', brown_vizszintes_komponens: 'a',
      meglevo_fogak: { 14: 'ép', 13: 'ép', 23: 'ép', 24: 'ép' },
      diag: 'Alveolaris defektus, lemezes pótlás',
    },
    {
      nev: 'Simon Péter', taj: '135 246 357', telefonszam: '+36 20 246 8013', email: 'simon.peter@example.hu',
      szuletesi_datum: '1968-02-28', nem: 'ferfi', varos: 'Budapest', iranyitoszam: '1117', cim: 'Bartók Béla út 152.',
      reason: onko, beutalo_orvos: 'Dr. Tóth Eszter', beutalo_intezmeny: 'Semmelweis Egyetem',
      szovettani_diagnozis: 'Mucoepidermoid carcinoma', tnm_staging: 'pT1 N0 M0', bno: 'C08.0',
      radioterapia: false, meglevo_fogak: { 16: 'ép', 15: 'ép', 14: 'ép', 24: 'ép', 25: 'ép', 26: 'ép' },
      diag: 'Korai stádium, protetikai kontroll',
    },
    {
      nev: 'Németh Réka', taj: '246 357 468', telefonszam: '+36 70 357 4682', email: 'nemeth.reka@example.hu',
      szuletesi_datum: '1995-10-11', nem: 'no', varos: 'Veszprém', iranyitoszam: '8200', cim: 'Óváros tér 22.',
      reason: veles, beutalo_orvos: 'Dr. Fekete Pál', beutalo_intezmeny: 'Cholnoky Ferenc Kórház',
      diagnozis: 'Amelogenesis imperfecta', bno: 'K00.5',
      meglevo_fogak: { 16: 'koronázandó', 11: 'koronázandó', 21: 'koronázandó', 26: 'koronázandó' },
      diag: 'Esztétikai és funkcionális rehabilitáció koronákkal',
    },
  ];

  const patientId = {};
  for (const p of patientsData) {
    const r = await q(
      `INSERT INTO patients_full (
         nev, taj, telefonszam, email, szuletesi_datum, nem, varos, iranyitoszam, cim,
         beutalo_orvos, beutalo_intezmeny, szovettani_diagnozis, tnm_staging, bno, diagnozis,
         kezelesre_erkezes_indoka, radioterapia, radioterapia_dozis, chemoterapia, chemoterapia_leiras,
         nyaki_blokkdisszekcio, maxilladefektus_van, brown_fuggoleges_osztaly, brown_vizszintes_komponens,
         mandibuladefektus_van, kovacs_dobak_osztaly, gombocos_beszed, nyalmirigy_allapot,
         dohanyzas_szam, alkoholfogyasztas, baleset_idopont, baleset_etiologiaja,
         veleszuletett_rendellenessegek, meglevo_fogak, meglevo_implantatumok,
         felso_fogpotlas_van, felso_fogpotlas_tipus, also_fogpotlas_van, also_fogpotlas_tipus,
         kezeleoorvos, kezeleoorvos_intezete, felvetel_datuma, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,
         $21,$22,$23,$24,
         $25,$26,$27,$28,
         $29,$30,$31,$32,
         $33,$34,$35,
         $36,$37,$38,$39,
         $40,$41,$42,$43
       ) RETURNING id`,
      [
        p.nev, p.taj, p.telefonszam, p.email, p.szuletesi_datum, p.nem, p.varos, p.iranyitoszam, p.cim,
        p.beutalo_orvos || null, p.beutalo_intezmeny || null, p.szovettani_diagnozis || null, p.tnm_staging || null, p.bno || null, p.diagnozis || null,
        p.reason, !!p.radioterapia, p.radioterapia_dozis || null, !!p.chemoterapia, p.chemoterapia_leiras || null,
        p.nyaki_blokkdisszekcio || null, !!p.maxilladefektus_van, p.brown_fuggoleges_osztaly || null, p.brown_vizszintes_komponens || null,
        !!p.mandibuladefektus_van, p.kovacs_dobak_osztaly || null, !!p.gombocos_beszed, p.nyalmirigy_allapot || null,
        p.dohanyzas_szam || null, p.alkoholfogyasztas || null, p.baleset_idopont || null, p.baleset_etiologiaja || null,
        JSON.stringify(p.veleszuletett_rendellenessegek || []), JSON.stringify(p.meglevo_fogak || {}), JSON.stringify(p.meglevo_implantatumok || {}),
        !!p.felso_fogpotlas_van, p.felso_fogpotlas_tipus || null, !!p.also_fogpotlas_van, p.also_fogpotlas_tipus || null,
        'Dr. Nagy Péter', 'Semmelweis Egyetem, Fogpótlástani Klinika', daysFromNow(-60 - Math.floor(Math.random() * 120)), 'admin@demo.hu',
      ]
    );
    patientId[p.nev] = { id: r.rows[0].id, reason: p.reason, diag: p.diag };
  }
  console.log(`  patients: ${Object.keys(patientId).length}`);

  // ── Episodes ──────────────────────────────────────────────────────────────
  const episodeId = {};
  let epIdx = 0;
  for (const [nev, info] of Object.entries(patientId)) {
    const status = epIdx % 7 === 6 ? 'closed' : 'open';
    const r = await q(
      `INSERT INTO patient_episodes (patient_id, reason, chief_complaint, case_title, status, opened_at,
         care_pathway_id, care_pathway_version, assigned_provider_id, treatment_type_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10) RETURNING id`,
      [
        info.id, info.reason, info.diag, info.diag, status,
        daysFromNow(-40 - epIdx * 3),
        pathwayId[info.reason] || null, provider, ttMap[info.reason] || null, 'admin@demo.hu',
      ]
    );
    episodeId[nev] = r.rows[0].id;
    epIdx++;
  }
  console.log(`  episodes: ${Object.keys(episodeId).length}`);

  // ── Time slots + appointments ─────────────────────────────────────────────
  const patientNames = Object.keys(patientId);
  let slotCount = 0, apptCount = 0;
  const apptStatuses = ['completed', 'completed', null, null, 'no_show', null];
  for (let day = -14; day <= 14; day++) {
    // weekday only
    const probe = new Date(); probe.setDate(probe.getDate() + day);
    const dow = probe.getDay();
    if (dow === 0 || dow === 6) continue;
    for (const hour of [8, 9, 10, 11, 13, 14, 15]) {
      const start = daysFromNow(day, hour, 0);
      // ~55% of slots booked
      const booked = Math.random() < 0.55;
      const sr = await q(
        `INSERT INTO available_time_slots (user_id, start_time, status, cim, teremszam, source, slot_purpose, state, duration_minutes)
         VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,45) RETURNING id`,
        [provider, start, booked ? 'booked' : 'available', 'Üllői út 26., Budapest', `${1 + (hour % 4)}. rendelő`, hour < 12 ? 'work' : 'consult', booked ? 'booked' : 'free']
      );
      slotCount++;
      if (booked) {
        const nev = patientNames[Math.floor(Math.random() * patientNames.length)];
        const info = patientId[nev];
        let st = null;
        if (day < 0) st = apptStatuses[apptCount % apptStatuses.length] || 'completed';
        const end = new Date(start.getTime() + 45 * 60000);
        await q(
          `INSERT INTO appointments (patient_id, time_slot_id, episode_id, created_by, start_time, end_time,
             duration_minutes, pool, appointment_status, appointment_type, type_label, created_via, approval_status)
           VALUES ($1,$2,$3,'admin@demo.hu',$4,$5,45,$6,$7,$8,$9,'admin_override','approved')`,
          [info.id, sr.rows[0].id, episodeId[nev], start, end, hour < 12 ? 'work' : 'consult',
           st, hour < 12 ? 'munkafazis' : 'elso_konzultacio', hour < 12 ? 'Munkafázis' : 'Első konzultáció']
        );
        apptCount++;
      }
    }
  }
  console.log(`  time_slots: ${slotCount}, appointments: ${apptCount}`);

  // ── Consilium sessions ────────────────────────────────────────────────────
  const consilia = [
    { title: 'Onkológiai protetikai konzílium — szeptember', off: 5, status: 'active' },
    { title: 'Multidiszciplináris esetmegbeszélés', off: -3, status: 'closed' },
    { title: 'Implantációs tervezés — heti konzílium', off: 12, status: 'active' },
  ];
  for (const c of consilia) {
    await q(
      `INSERT INTO consilium_sessions (title, institution_id, scheduled_at, status, created_by, updated_by, attendees)
       VALUES ($1,$2,$3,$4,$5,$5,$6)`,
      [c.title, 'semmelweis-fogpotlastan', daysFromNow(c.off, 14, 0), c.status, 'admin@demo.hu',
       JSON.stringify([
         { name: 'Dr. Kovács Anna', role: 'fogpótlástanász' },
         { name: 'Dr. Tóth Eszter', role: 'onkológus' },
         { name: 'Dr. Varga Gábor', role: 'sebész' },
       ])]
    );
  }
  console.log(`  consilium_sessions: ${consilia.length}`);

  // ── User tasks ────────────────────────────────────────────────────────────
  const someP = Object.entries(patientId);
  const tasks = [
    { title: 'Obturátor protézis lenyomatvétel előkészítése', type: 'manual', status: 'open', due: 2, p: 'Horváth Béla', assignee: provider },
    { title: 'Beszédterápia konzílium egyeztetése', type: 'manual', status: 'open', due: 5, p: 'Kiss Mária', assignee: provider },
    { title: 'Implantátum gyári adatlap feltöltése', type: 'document_upload', status: 'open', due: 1, p: 'Nagy János', assignee: userId['technikus@demo.hu'] },
    { title: 'OHIP-14 kérdőív kiküldése (3 hónapos kontroll)', type: 'ohip14', status: 'done', due: -2, p: 'Tóth Erzsébet', assignee: provider },
    { title: 'Laborkérés: fémváz próbához', type: 'manual', status: 'open', due: 3, p: 'Takács Gábor', assignee: userId['technikus@demo.hu'] },
    { title: 'Kontroll időpont egyeztetése a beteggel', type: 'manual', status: 'open', due: 4, p: 'Molnár Zoltán', assignee: provider },
  ];
  for (const t of tasks) {
    await q(
      `INSERT INTO user_tasks (assignee_kind, assignee_user_id, patient_id, task_type, status, title, description, due_at, created_by_user_id, completed_at)
       VALUES ('staff',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t.assignee, patientId[t.p].id, t.type, t.status, t.title,
       `Beteg: ${t.p}. Automatikusan generált demo feladat.`, daysFromNow(t.due, 12, 0), admin,
       t.status === 'done' ? daysFromNow(t.due, 13, 0) : null]
    );
  }
  console.log(`  user_tasks: ${tasks.length}`);

  // ── Doctor messages (doctor↔doctor) ───────────────────────────────────────
  const dm = [
    { from: 'beutalo@demo.hu', to: 'fogpotlas@demo.hu', fromName: 'Dr. Tóth Eszter', subj: 'Beutaló: Horváth Béla', msg: 'Kedves Kollégák! A beteg radioterápiája lezárult (60 Gy), a protetikai rehabilitáció megkezdhető. A részletes onkológiai zárójelentést csatoltam.' },
    { from: 'fogpotlas@demo.hu', to: 'beutalo@demo.hu', fromName: 'Dr. Nagy Péter', subj: 'Re: Beutaló: Horváth Béla', msg: 'Köszönöm, időpontot adtunk a jövő hétre konzultációra. Az obturátor protézis tervezését elkezdjük.' },
    { from: 'fogpotlas@demo.hu', to: 'admin@demo.hu', fromName: 'Dr. Nagy Péter', subj: 'Konzílium — Kiss Mária esete', msg: 'A beszédrehabilitáció miatt érdemes lenne logopédust is bevonni a következő konzíliumba.' },
  ];
  for (const m of dm) {
    await q(
      `INSERT INTO doctor_messages (sender_id, recipient_id, sender_email, sender_name, subject, message, created_at, delivery_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'delivered')`,
      [userId[m.from], userId[m.to], m.from, m.fromName, m.subj, m.msg, daysFromNow(-Math.floor(Math.random() * 6) - 1, 10, 0)]
    );
  }
  console.log(`  doctor_messages: ${dm.length}`);

  // ── Patient ↔ doctor messages ─────────────────────────────────────────────
  try {
    await q(
      `INSERT INTO messages (patient_id, sender_type, sender_email, subject, message, created_at, delivery_status)
       VALUES ($1,'patient'::message_sender,$2,$3,$4,$5,'delivered')`,
      [patientId['Nagy János'].id, 'nagy.janos@example.hu', 'Kérdés az időpontról',
       'Tisztelt Doktor Úr! Szeretném megerősíteni a jövő heti időpontomat. Köszönöm!', daysFromNow(-2, 9, 30)]
    );
  } catch (e) {
    // sender_type may not be an enum named message_sender; fall back to text
    await q(
      `INSERT INTO messages (patient_id, sender_type, sender_email, subject, message, created_at, delivery_status)
       VALUES ($1,$2,$3,$4,$5,$6,'delivered')`,
      [patientId['Nagy János'].id, 'patient', 'nagy.janos@example.hu', 'Kérdés az időpontról',
       'Tisztelt Doktor Úr! Szeretném megerősíteni a jövő heti időpontomat. Köszönöm!', daysFromNow(-2, 9, 30)]
    ).catch(() => console.log('  (messages skipped)'));
  }

  // ── OHIP-14 responses ─────────────────────────────────────────────────────
  function ohipRow(patientNev, episodeNev, timepoint, dayOff, severity) {
    const v = severity; // 0..4 baseline answer level
    const ans = [];
    for (let i = 1; i <= 14; i++) ans.push(Math.max(0, Math.min(4, v + (i % 3 === 0 ? -1 : 0))));
    const sum = (a, b) => ans.slice(a - 1, b).reduce((x, y) => x + y, 0);
    return q(
      `INSERT INTO ohip14_responses (patient_id, episode_id, timepoint, completed_at, completed_by_patient,
         q1_functional_limitation,q2_functional_limitation,q3_physical_pain,q4_physical_pain,
         q5_psychological_discomfort,q6_psychological_discomfort,q7_physical_disability,q8_physical_disability,
         q9_psychological_disability,q10_psychological_disability,q11_social_disability,q12_social_disability,
         q13_handicap,q14_handicap, total_score,
         functional_limitation_score,physical_pain_score,psychological_discomfort_score,
         physical_disability_score,psychological_disability_score,social_disability_score,handicap_score, created_by)
       VALUES ($1,$2,$3,$4,true,
         $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22,$23,$24,$25,$26,'admin@demo.hu')`,
      [patientId[patientNev].id, episodeId[episodeNev], timepoint, daysFromNow(dayOff, 11, 0),
       ...ans, ans.reduce((x, y) => x + y, 0),
       sum(1, 2), sum(3, 4), sum(5, 6), sum(7, 8), sum(9, 10), sum(11, 12), sum(13, 14)]
    );
  }
  await ohipRow('Horváth Béla', 'Horváth Béla', 'T0', -50, 3);
  await ohipRow('Horváth Béla', 'Horváth Béla', 'T2', -5, 1);
  await ohipRow('Kiss Mária', 'Kiss Mária', 'T0', -40, 4);
  await ohipRow('Tóth Erzsébet', 'Tóth Erzsébet', 'T0', -30, 2);
  console.log('  ohip14_responses: 4');

  // ── Feedback ──────────────────────────────────────────────────────────────
  const fb = [
    { type: 'suggestion', title: 'Naptárnézet havi exportja', desc: 'Jó lenne a havi naptárt PDF-be exportálni a heti értekezletekhez.', status: 'open', email: 'fogpotlas@demo.hu' },
    { type: 'bug', title: 'Mobil nézetben a táblázat túlcsordul', desc: 'A betegek listája mobilon vízszintesen görgethető, nehéz olvasni.', status: 'resolved', email: 'technikus@demo.hu' },
  ];
  for (const f of fb) {
    await q(
      `INSERT INTO feedback (user_email, type, title, description, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [f.email, f.type, f.title, f.desc, f.status, daysFromNow(-Math.floor(Math.random() * 10) - 1)]
    );
  }
  console.log(`  feedback: ${fb.length}`);

  console.log('Done.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
