import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { closeOpenSelfFillTasks } from '@/lib/patient-selffill-reminders';

export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/patient-portal/health-habits
 *
 * A beteg által önkitölthető egészségi adatok (életmód-anamnézis +
 * fogpótlás-elégedettség). Szűk whitelist: a klinikai osztályozásokhoz a
 * betegnek nincs hozzáférése. Az elégedettség-kérdések csak akkor
 * szerkeszthetők, ha az orvos rögzítette, hogy van fogpótlás.
 */
export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const pool = getDbPool();
  const res = await pool.query(
    `SELECT
       a.alkoholfogyasztas,
       a.dohanyzas_szam AS "dohanyzasSzam",
       d.felso_fogpotlas_van AS "felsoFogpotlasVan",
       d.felso_fogpotlas_elegedett AS "felsoFogpotlasElegedett",
       d.felso_fogpotlas_problema AS "felsoFogpotlasProblema",
       d.also_fogpotlas_van AS "alsoFogpotlasVan",
       d.also_fogpotlas_elegedett AS "alsoFogpotlasElegedett",
       d.also_fogpotlas_problema AS "alsoFogpotlasProblema"
     FROM patients p
     LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
     LEFT JOIN patient_dental_status d ON d.patient_id = p.id
     WHERE p.id = $1`,
    [patientId]
  );
  if (res.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }
  return NextResponse.json({ habits: res.rows[0] });
});

export const PUT = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Érvénytelen kérés' }, { status: 400 });
  }

  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 500) : null;
  const triState = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

  const alkoholfogyasztas = text(body.alkoholfogyasztas);
  const dohanyzasSzam = text(body.dohanyzasSzam);
  const felsoElegedett = triState(body.felsoFogpotlasElegedett);
  const felsoProblema = text(body.felsoFogpotlasProblema);
  const alsoElegedett = triState(body.alsoFogpotlasElegedett);
  const alsoProblema = text(body.alsoFogpotlasProblema);

  const pool = getDbPool();

  // Nem-destruktív írás: üresen hagyott mező NEM törli a meglévő értéket
  // (a beteg kiegészít, nem adminisztrál).
  await pool.query(
    `INSERT INTO patient_anamnesis (patient_id, alkoholfogyasztas, dohanyzas_szam)
     VALUES ($1, $2, $3)
     ON CONFLICT (patient_id)
     DO UPDATE SET
       alkoholfogyasztas = COALESCE(EXCLUDED.alkoholfogyasztas, patient_anamnesis.alkoholfogyasztas),
       dohanyzas_szam = COALESCE(EXCLUDED.dohanyzas_szam, patient_anamnesis.dohanyzas_szam)`,
    [patientId, alkoholfogyasztas, dohanyzasSzam]
  );

  // Elégedettség csak ott írható, ahol az orvos rögzítette a fogpótlás meglétét.
  await pool.query(
    `UPDATE patient_dental_status SET
       felso_fogpotlas_elegedett = CASE WHEN felso_fogpotlas_van IS TRUE THEN COALESCE($2, felso_fogpotlas_elegedett) ELSE felso_fogpotlas_elegedett END,
       felso_fogpotlas_problema  = CASE WHEN felso_fogpotlas_van IS TRUE THEN COALESCE($3, felso_fogpotlas_problema) ELSE felso_fogpotlas_problema END,
       also_fogpotlas_elegedett  = CASE WHEN also_fogpotlas_van IS TRUE THEN COALESCE($4, also_fogpotlas_elegedett) ELSE also_fogpotlas_elegedett END,
       also_fogpotlas_problema   = CASE WHEN also_fogpotlas_van IS TRUE THEN COALESCE($5, also_fogpotlas_problema) ELSE also_fogpotlas_problema END
     WHERE patient_id = $1`,
    [patientId, felsoElegedett, felsoProblema, alsoElegedett, alsoProblema]
  );

  // Ha minden önkitölthető mező rendezett, a nyitott nudge-feladat lezárul.
  const check = await pool.query(
    `SELECT a.alkoholfogyasztas, a.dohanyzas_szam,
            d.felso_fogpotlas_van, d.felso_fogpotlas_elegedett,
            d.also_fogpotlas_van, d.also_fogpotlas_elegedett
       FROM patients p
       LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
       LEFT JOIN patient_dental_status d ON d.patient_id = p.id
      WHERE p.id = $1`,
    [patientId]
  );
  const r = check.rows[0] ?? {};
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  const stillMissing =
    blank(r.alkoholfogyasztas) ||
    blank(r.dohanyzas_szam) ||
    (r.felso_fogpotlas_van === true && (r.felso_fogpotlas_elegedett === null || r.felso_fogpotlas_elegedett === undefined)) ||
    (r.also_fogpotlas_van === true && (r.also_fogpotlas_elegedett === null || r.also_fogpotlas_elegedett === undefined));
  if (!stillMissing) {
    await closeOpenSelfFillTasks(patientId);
  }

  return NextResponse.json({ success: true, complete: !stillMissing });
});
