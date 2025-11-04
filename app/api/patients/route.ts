import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { Patient, patientSchema } from '@/lib/types';
import { verifyAuth } from '@/lib/auth-server';

// Összes beteg lekérdezése
export async function GET(request: NextRequest) {
  try {
    const pool = getDbPool();
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    let result;
    
    if (query) {
      // Keresés
      result = await pool.query(
        `SELECT 
          id,
          nev,
          taj,
          telefonszam,
          szuletesi_datum as "szuletesiDatum",
          nem,
          email,
          cim,
          varos,
          iranyitoszam,
          beutalo_orvos as "beutaloOrvos",
          beutalo_intezmeny as "beutaloIntezmeny",
          mutet_rovid_leirasa as "mutetRovidLeirasa",
          mutet_ideje as "mutetIdeje",
          szovettani_diagnozis as "szovettaniDiagnozis",
          nyaki_blokkdisszekcio as "nyakiBlokkdisszekcio",
          alkoholfogyasztas,
          dohanyzas_szam as "dohanyzasSzam",
          kezelesre_erkezes_indoka as "kezelesreErkezesIndoka",
          maxilladefektus_van as "maxilladefektusVan",
          brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
          brown_vizszintes_komponens as "brownVizszintesKomponens",
          mandibuladefektus_van as "mandibuladefektusVan",
          kovacs_dobak_osztaly as "kovacsDobakOsztaly",
          nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
          gombocos_beszed as "gombocosBeszed",
          nyalmirigy_allapot as "nyalmirigyAllapot",
          fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso",
          fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso",
          radioterapia,
          radioterapia_dozis as "radioterapiaDozis",
          radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
          chemoterapia,
          chemoterapia_leiras as "chemoterapiaLeiras",
          fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
          kezeleoorvos,
          kezeleoorvos_intezete as "kezeleoorvosIntezete",
          felvetel_datuma as "felvetelDatuma",
          felso_fogpotlas_van as "felsoFogpotlasVan",
          felso_fogpotlas_mikor as "felsoFogpotlasMikor",
          felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
          felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
          felso_fogpotlas_problema as "felsoFogpotlasProblema",
          also_fogpotlas_van as "alsoFogpotlasVan",
          also_fogpotlas_mikor as "alsoFogpotlasMikor",
          also_fogpotlas_keszito as "alsoFogpotlasKeszito",
          also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
          also_fogpotlas_problema as "alsoFogpotlasProblema",
          meglevo_fogak as "meglevoFogak",
          felso_fogpotlas_tipus as "felsoFogpotlasTipus",
          also_fogpotlas_tipus as "alsoFogpotlasTipus",
          meglevo_implantatumok as "meglevoImplantatumok",
          nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
          nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
          tnm_staging as "tnmStaging",
          kezelesi_terv_felso as "kezelesiTervFelso",
          kezelesi_terv_also as "kezelesiTervAlso",
          created_at as "createdAt",
          updated_at as "updatedAt",
          created_by as "createdBy",
          updated_by as "updatedBy"
        FROM patients
        WHERE 
          nev ILIKE $1 OR
          taj ILIKE $1 OR
          telefonszam ILIKE $1 OR
          email ILIKE $1 OR
          beutalo_orvos ILIKE $1 OR
          beutalo_intezmeny ILIKE $1 OR
          kezeleoorvos ILIKE $1
        ORDER BY created_at DESC`,
        [`%${query}%`]
      );
    } else {
      // Összes beteg
      result = await pool.query(
        `SELECT 
          id,
          nev,
          taj,
          telefonszam,
          szuletesi_datum as "szuletesiDatum",
          nem,
          email,
          cim,
          varos,
          iranyitoszam,
          beutalo_orvos as "beutaloOrvos",
          beutalo_intezmeny as "beutaloIntezmeny",
          mutet_rovid_leirasa as "mutetRovidLeirasa",
          mutet_ideje as "mutetIdeje",
          szovettani_diagnozis as "szovettaniDiagnozis",
          nyaki_blokkdisszekcio as "nyakiBlokkdisszekcio",
          alkoholfogyasztas,
          dohanyzas_szam as "dohanyzasSzam",
          kezelesre_erkezes_indoka as "kezelesreErkezesIndoka",
          maxilladefektus_van as "maxilladefektusVan",
          brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
          brown_vizszintes_komponens as "brownVizszintesKomponens",
          mandibuladefektus_van as "mandibuladefektusVan",
          kovacs_dobak_osztaly as "kovacsDobakOsztaly",
          nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
          gombocos_beszed as "gombocosBeszed",
          nyalmirigy_allapot as "nyalmirigyAllapot",
          fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso",
          fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso",
          radioterapia,
          radioterapia_dozis as "radioterapiaDozis",
          radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
          chemoterapia,
          chemoterapia_leiras as "chemoterapiaLeiras",
          fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
          kezeleoorvos,
          kezeleoorvos_intezete as "kezeleoorvosIntezete",
          felvetel_datuma as "felvetelDatuma",
          felso_fogpotlas_van as "felsoFogpotlasVan",
          felso_fogpotlas_mikor as "felsoFogpotlasMikor",
          felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
          felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
          felso_fogpotlas_problema as "felsoFogpotlasProblema",
          also_fogpotlas_van as "alsoFogpotlasVan",
          also_fogpotlas_mikor as "alsoFogpotlasMikor",
          also_fogpotlas_keszito as "alsoFogpotlasKeszito",
          also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
          also_fogpotlas_problema as "alsoFogpotlasProblema",
          meglevo_fogak as "meglevoFogak",
          felso_fogpotlas_tipus as "felsoFogpotlasTipus",
          also_fogpotlas_tipus as "alsoFogpotlasTipus",
          meglevo_implantatumok as "meglevoImplantatumok",
          nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
          nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
          tnm_staging as "tnmStaging",
          kezelesi_terv_felso as "kezelesiTervFelso",
          kezelesi_terv_also as "kezelesiTervAlso",
          created_at as "createdAt",
          updated_at as "updatedAt",
          created_by as "createdBy",
          updated_by as "updatedBy"
        FROM patients
        ORDER BY created_at DESC`
      );
    }

    // Activity logging: patients list viewed or searched (csak ha be van jelentkezve)
    try {
      const auth = await verifyAuth(request);
      if (auth) {
        const ipHeader = request.headers.get('x-forwarded-for') || '';
        const ipAddress = ipHeader.split(',')[0]?.trim() || null;
        const searchQuery = request.nextUrl.searchParams.get('q');
        const action = searchQuery ? 'patient_search' : 'patients_list_viewed';
        const detail = searchQuery
          ? `Search query: "${searchQuery}", Results: ${result.rows.length}`
          : `Total patients: ${result.rows.length}`;
      
        await pool.query(
          `INSERT INTO activity_logs (user_email, action, detail, ip_address)
           VALUES ($1, $2, $3, $4)`,
          [auth.email, action, detail, ipAddress]
        );
      }
    } catch (logError) {
      console.error('Failed to log activity:', logError);
      // Don't fail the request if logging fails
    }

    return NextResponse.json({ patients: result.rows }, { status: 200 });
  } catch (error) {
    console.error('Hiba a betegek lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a betegek lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Új beteg létrehozása
export async function POST(request: NextRequest) {
  try {
    // Hitelesítés ellenőrzése
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    console.log('POST /api/patients - Fogadott adatok:', JSON.stringify(body, null, 2));
    
    // Validálás Zod schemával
    const validatedPatient = patientSchema.parse(body);
    console.log('Validált adatok:', JSON.stringify(validatedPatient, null, 2));
    
    const pool = getDbPool();
    const userEmail = auth.email;
    
    // Új betegnél ne generáljunk ID-t, hagyjuk az adatbázisnak generálni (DEFAULT generate_uuid())
    // Csak import esetén használjuk a megadott ID-t
    const patientId = validatedPatient.id || null;
    
    // Építjük a paraméterek tömbjét és a SQL query-t
    const values: any[] = [];
    let paramIndex = 1;
    
    // Ha van ID, hozzáadjuk
    if (patientId) {
      values.push(patientId);
    }
    
    // Összes többi mező
    values.push(
      validatedPatient.nev || null,
      validatedPatient.taj || null,
      validatedPatient.telefonszam || null,
      validatedPatient.szuletesiDatum || null,
      validatedPatient.nem || null,
      validatedPatient.email || null,
      validatedPatient.cim || null,
      validatedPatient.varos || null,
      validatedPatient.iranyitoszam || null,
      validatedPatient.beutaloOrvos || null,
      validatedPatient.beutaloIntezmeny || null,
      validatedPatient.mutetRovidLeirasa || null,
      validatedPatient.mutetIdeje || null,
      validatedPatient.szovettaniDiagnozis || null,
      validatedPatient.nyakiBlokkdisszekcio || null,
      validatedPatient.alkoholfogyasztas || null,
      validatedPatient.dohanyzasSzam || null,
      validatedPatient.kezelesreErkezesIndoka || null,
      validatedPatient.maxilladefektusVan || false,
      validatedPatient.brownFuggolegesOsztaly || null,
      validatedPatient.brownVizszintesKomponens || null,
      validatedPatient.mandibuladefektusVan || false,
      validatedPatient.kovacsDobakOsztaly || null,
      validatedPatient.nyelvmozgásokAkadályozottak || false,
      validatedPatient.gombocosBeszed || false,
      validatedPatient.nyalmirigyAllapot || null,
      validatedPatient.fabianFejerdyProtetikaiOsztalyFelso || null,
      validatedPatient.fabianFejerdyProtetikaiOsztalyAlso || null,
      validatedPatient.radioterapia || false,
      validatedPatient.radioterapiaDozis || null,
      validatedPatient.radioterapiaDatumIntervallum || null,
      validatedPatient.chemoterapia || false,
      validatedPatient.chemoterapiaLeiras || null,
      validatedPatient.fabianFejerdyProtetikaiOsztaly || null,
      validatedPatient.kezeleoorvos || null,
      validatedPatient.kezeleoorvosIntezete || null,
      validatedPatient.felvetelDatuma || null,
      validatedPatient.felsoFogpotlasVan || false,
      validatedPatient.felsoFogpotlasMikor || null,
      validatedPatient.felsoFogpotlasKeszito || null,
      validatedPatient.felsoFogpotlasElegedett ?? true,
      validatedPatient.felsoFogpotlasProblema || null,
      validatedPatient.alsoFogpotlasVan || false,
      validatedPatient.alsoFogpotlasMikor || null,
      validatedPatient.alsoFogpotlasKeszito || null,
      validatedPatient.alsoFogpotlasElegedett ?? true,
      validatedPatient.alsoFogpotlasProblema || null,
      validatedPatient.meglevoFogak && typeof validatedPatient.meglevoFogak === 'object'
        ? validatedPatient.meglevoFogak
        : {},
      validatedPatient.felsoFogpotlasTipus || null,
      validatedPatient.alsoFogpotlasTipus || null,
      // meglevoImplantatumok - PostgreSQL automatikusan kezeli az objektum -> JSONB konverziót
      validatedPatient.meglevoImplantatumok && typeof validatedPatient.meglevoImplantatumok === 'object'
        ? validatedPatient.meglevoImplantatumok
        : {},
      validatedPatient.nemIsmertPoziciokbanImplantatum || false,
      validatedPatient.nemIsmertPoziciokbanImplantatumRészletek || null,
      validatedPatient.tnmStaging || null,
      validatedPatient.kezelesiTervFelso && Array.isArray(validatedPatient.kezelesiTervFelso)
        ? JSON.stringify(validatedPatient.kezelesiTervFelso)
        : '[]',
      validatedPatient.kezelesiTervAlso && Array.isArray(validatedPatient.kezelesiTervAlso)
        ? JSON.stringify(validatedPatient.kezelesiTervAlso)
        : '[]',
      userEmail
    );
    
    // SQL query építése
    const idPart = patientId ? 'id, ' : '';
    const paramPlaceholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await pool.query(
      `INSERT INTO patients (
        ${idPart}nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos,
        iranyitoszam, beutalo_orvos, beutalo_intezmeny, mutet_rovid_leirasa,
        mutet_ideje, szovettani_diagnozis, nyaki_blokkdisszekcio,
        alkoholfogyasztas, dohanyzas_szam, kezelesre_erkezes_indoka, maxilladefektus_van,
        brown_fuggoleges_osztaly, brown_vizszintes_komponens,
        mandibuladefektus_van, kovacs_dobak_osztaly,
        nyelvmozgasok_akadalyozottak, gombocos_beszed, nyalmirigy_allapot,
        fabian_fejerdy_protetikai_osztaly_felso, fabian_fejerdy_protetikai_osztaly_also,
        radioterapia, radioterapia_dozis, radioterapia_datum_intervallum,
        chemoterapia, chemoterapia_leiras, fabian_fejerdy_protetikai_osztaly,
        kezeleoorvos, kezeleoorvos_intezete, felvetel_datuma,
        felso_fogpotlas_van, felso_fogpotlas_mikor, felso_fogpotlas_keszito, felso_fogpotlas_elegedett, felso_fogpotlas_problema,
        also_fogpotlas_van, also_fogpotlas_mikor, also_fogpotlas_keszito, also_fogpotlas_elegedett, also_fogpotlas_problema,
        meglevo_fogak, felso_fogpotlas_tipus, also_fogpotlas_tipus,
        meglevo_implantatumok, nem_ismert_poziciokban_implantatum,
        nem_ismert_poziciokban_implantatum_reszletek,
        tnm_staging,
        kezelesi_terv_felso, kezelesi_terv_also,
        created_by
      ) VALUES (
        ${paramPlaceholders}
      )
      RETURNING 
        id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
        email, cim, varos, iranyitoszam, beutalo_orvos as "beutaloOrvos",
        beutalo_intezmeny as "beutaloIntezmeny", mutet_rovid_leirasa as "mutetRovidLeirasa",
        mutet_ideje as "mutetIdeje", szovettani_diagnozis as "szovettaniDiagnozis",
        nyaki_blokkdisszekcio as "nyakiBlokkdisszekcio", alkoholfogyasztas,
        dohanyzas_szam as "dohanyzasSzam", kezelesre_erkezes_indoka as "kezelesreErkezesIndoka", maxilladefektus_van as "maxilladefektusVan",
        brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
        brown_vizszintes_komponens as "brownVizszintesKomponens",
        mandibuladefektus_van as "mandibuladefektusVan",
        kovacs_dobak_osztaly as "kovacsDobakOsztaly",
        nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
        gombocos_beszed as "gombocosBeszed", nyalmirigy_allapot as "nyalmirigyAllapot",
        fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso",
        fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso",
        radioterapia, radioterapia_dozis as "radioterapiaDozis",
        radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
        chemoterapia, chemoterapia_leiras as "chemoterapiaLeiras",
        fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
        kezeleoorvos, kezeleoorvos_intezete as "kezeleoorvosIntezete",
        felvetel_datuma as "felvetelDatuma",
        felso_fogpotlas_van as "felsoFogpotlasVan",
        felso_fogpotlas_mikor as "felsoFogpotlasMikor",
        felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
        felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
        felso_fogpotlas_problema as "felsoFogpotlasProblema",
        also_fogpotlas_van as "alsoFogpotlasVan",
        also_fogpotlas_mikor as "alsoFogpotlasMikor",
        also_fogpotlas_keszito as "alsoFogpotlasKeszito",
        also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
        also_fogpotlas_problema as "alsoFogpotlasProblema",
        meglevo_fogak as "meglevoFogak",
        felso_fogpotlas_tipus as "felsoFogpotlasTipus",
        also_fogpotlas_tipus as "alsoFogpotlasTipus",
        meglevo_implantatumok as "meglevoImplantatumok",
        nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
        nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
        tnm_staging as "tnmStaging",
        kezelesi_terv_felso as "kezelesiTervFelso",
        kezelesi_terv_also as "kezelesiTervAlso",
        created_at as "createdAt", updated_at as "updatedAt",
        created_by as "createdBy", updated_by as "updatedBy"`,
      values
    );

    console.log('Beteg sikeresen mentve, ID:', result.rows[0].id);
    
    // Activity logging: patient created
    try {
      const ipHeader = request.headers.get('x-forwarded-for') || '';
      const ipAddress = ipHeader.split(',')[0]?.trim() || null;
      await pool.query(
        `INSERT INTO activity_logs (user_email, action, detail, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [userEmail, 'patient_created', `Patient ID: ${result.rows[0].id}, Name: ${result.rows[0].nev || 'N/A'}`, ipAddress]
      );
    } catch (logError) {
      console.error('Failed to log activity:', logError);
      // Don't fail the request if logging fails
    }
    
    return NextResponse.json({ patient: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error('Hiba a beteg mentésekor:', error);
    console.error('Hiba részletei:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint
    });
    
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Érvénytelen adatok', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Hiba történt a beteg mentésekor' },
      { status: 500 }
    );
  }
}

