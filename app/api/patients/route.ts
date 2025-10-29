import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { Patient, patientSchema } from '@/lib/types';

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
          maxilladefektus_van as "maxilladefektusVan",
          brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
          brown_vizszintes_komponens as "brownVizszintesKomponens",
          mandibuladefektus_van as "mandibuladefektusVan",
          kovacs_dobak_osztaly as "kovacsDobakOsztaly",
          nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
          gombocos_beszed as "gombocosBeszed",
          nyalmirigy_allapot as "nyalmirigyAllapot",
          radioterapia,
          radioterapia_dozis as "radioterapiaDozis",
          radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
          chemoterapia,
          chemoterapia_leiras as "chemoterapiaLeiras",
          fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
          kezeleoorvos,
          kezeleoorvos_intezete as "kezeleoorvosIntezete",
          felvetel_datuma as "felvetelDatuma",
          meglevo_implantatumok as "meglevoImplantatumok",
          nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
          nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
          created_at as "createdAt",
          updated_at as "updatedAt"
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
          maxilladefektus_van as "maxilladefektusVan",
          brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
          brown_vizszintes_komponens as "brownVizszintesKomponens",
          mandibuladefektus_van as "mandibuladefektusVan",
          kovacs_dobak_osztaly as "kovacsDobakOsztaly",
          nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
          gombocos_beszed as "gombocosBeszed",
          nyalmirigy_allapot as "nyalmirigyAllapot",
          radioterapia,
          radioterapia_dozis as "radioterapiaDozis",
          radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
          chemoterapia,
          chemoterapia_leiras as "chemoterapiaLeiras",
          fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
          kezeleoorvos,
          kezeleoorvos_intezete as "kezeleoorvosIntezete",
          felvetel_datuma as "felvetelDatuma",
          meglevo_implantatumok as "meglevoImplantatumok",
          nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
          nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM patients
        ORDER BY created_at DESC`
      );
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
    const body = await request.json();
    console.log('POST /api/patients - Fogadott adatok:', JSON.stringify(body, null, 2));
    
    // Validálás Zod schemával
    const validatedPatient = patientSchema.parse(body);
    console.log('Validált adatok:', JSON.stringify(validatedPatient, null, 2));
    
    const pool = getDbPool();
    
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
      validatedPatient.nev,
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
      validatedPatient.maxilladefektusVan || false,
      validatedPatient.brownFuggolegesOsztaly || null,
      validatedPatient.brownVizszintesKomponens || null,
      validatedPatient.mandibuladefektusVan || false,
      validatedPatient.kovacsDobakOsztaly || null,
      validatedPatient.nyelvmozgásokAkadályozottak || false,
      validatedPatient.gombocosBeszed || false,
      validatedPatient.nyalmirigyAllapot || null,
      validatedPatient.radioterapia || false,
      validatedPatient.radioterapiaDozis || null,
      validatedPatient.radioterapiaDatumIntervallum || null,
      validatedPatient.chemoterapia || false,
      validatedPatient.chemoterapiaLeiras || null,
      validatedPatient.fabianFejerdyProtetikaiOsztaly || null,
      validatedPatient.kezeleoorvos || null,
      validatedPatient.kezeleoorvosIntezete || null,
      validatedPatient.felvetelDatuma || null,
      // meglevoImplantatumok - PostgreSQL automatikusan kezeli az objektum -> JSONB konverziót
      validatedPatient.meglevoImplantatumok && typeof validatedPatient.meglevoImplantatumok === 'object'
        ? validatedPatient.meglevoImplantatumok
        : {},
      validatedPatient.nemIsmertPoziciokbanImplantatum || false,
      validatedPatient.nemIsmertPoziciokbanImplantatumRészletek || null,
    );
    
    // SQL query építése
    const idPart = patientId ? 'id, ' : '';
    const paramPlaceholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await pool.query(
      `INSERT INTO patients (
        ${idPart}nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos,
        iranyitoszam, beutalo_orvos, beutalo_intezmeny, mutet_rovid_leirasa,
        mutet_ideje, szovettani_diagnozis, nyaki_blokkdisszekcio,
        alkoholfogyasztas, dohanyzas_szam, maxilladefektus_van,
        brown_fuggoleges_osztaly, brown_vizszintes_komponens,
        mandibuladefektus_van, kovacs_dobak_osztaly,
        nyelvmozgasok_akadalyozottak, gombocos_beszed, nyalmirigy_allapot,
        radioterapia, radioterapia_dozis, radioterapia_datum_intervallum,
        chemoterapia, chemoterapia_leiras, fabian_fejerdy_protetikai_osztaly,
        kezeleoorvos, kezeleoorvos_intezete, felvetel_datuma,
        meglevo_implantatumok, nem_ismert_poziciokban_implantatum,
        nem_ismert_poziciokban_implantatum_reszletek
      ) VALUES (
        ${paramPlaceholders}
      )
      RETURNING 
        id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
        email, cim, varos, iranyitoszam, beutalo_orvos as "beutaloOrvos",
        beutalo_intezmeny as "beutaloIntezmeny", mutet_rovid_leirasa as "mutetRovidLeirasa",
        mutet_ideje as "mutetIdeje", szovettani_diagnozis as "szovettaniDiagnozis",
        nyaki_blokkdisszekcio as "nyakiBlokkdisszekcio", alkoholfogyasztas,
        dohanyzas_szam as "dohanyzasSzam", maxilladefektus_van as "maxilladefektusVan",
        brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
        brown_vizszintes_komponens as "brownVizszintesKomponens",
        mandibuladefektus_van as "mandibuladefektusVan",
        kovacs_dobak_osztaly as "kovacsDobakOsztaly",
        nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
        gombocos_beszed as "gombocosBeszed", nyalmirigy_allapot as "nyalmirigyAllapot",
        radioterapia, radioterapia_dozis as "radioterapiaDozis",
        radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
        chemoterapia, chemoterapia_leiras as "chemoterapiaLeiras",
        fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
        kezeleoorvos, kezeleoorvos_intezete as "kezeleoorvosIntezete",
        felvetel_datuma as "felvetelDatuma", meglevo_implantatumok as "meglevoImplantatumok",
        nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
        nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
        created_at as "createdAt", updated_at as "updatedAt"`,
      values
    );

    console.log('Beteg sikeresen mentve, ID:', result.rows[0].id);
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

