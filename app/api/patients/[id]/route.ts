import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { patientSchema } from '@/lib/types';

// Egy beteg lekérdezése ID alapján
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const pool = getDbPool();
    const result = await pool.query(
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
      WHERE id = $1`,
      [params.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    return NextResponse.json({ patient: result.rows[0] }, { status: 200 });
  } catch (error) {
    console.error('Hiba a beteg lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a beteg lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Beteg frissítése
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const validatedPatient = patientSchema.parse(body);
    
    const pool = getDbPool();
    
    const result = await pool.query(
      `UPDATE patients SET
        nev = $2,
        taj = $3,
        telefonszam = $4,
        szuletesi_datum = $5,
        nem = $6,
        email = $7,
        cim = $8,
        varos = $9,
        iranyitoszam = $10,
        beutalo_orvos = $11,
        beutalo_intezmeny = $12,
        mutet_rovid_leirasa = $13,
        mutet_ideje = $14,
        szovettani_diagnozis = $15,
        nyaki_blokkdisszekcio = $16,
        alkoholfogyasztas = $17,
        dohanyzas_szam = $18,
        maxilladefektus_van = $19,
        brown_fuggoleges_osztaly = $20,
        brown_vizszintes_komponens = $21,
        mandibuladefektus_van = $22,
        kovacs_dobak_osztaly = $23,
        nyelvmozgasok_akadalyozottak = $24,
        gombocos_beszed = $25,
        nyalmirigy_allapot = $26,
        radioterapia = $27,
        radioterapia_dozis = $28,
        radioterapia_datum_intervallum = $29,
        chemoterapia = $30,
        chemoterapia_leiras = $31,
        fabian_fejerdy_protetikai_osztaly = $32,
        kezeleoorvos = $33,
        kezeleoorvos_intezete = $34,
        felvetel_datuma = $35,
        meglevo_implantatumok = $36,
        nem_ismert_poziciokban_implantatum = $37,
        nem_ismert_poziciokban_implantatum_reszletek = $38,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
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
      [
        params.id,
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
        validatedPatient.meglevoImplantatumok 
          ? JSON.parse(JSON.stringify(validatedPatient.meglevoImplantatumok))
          : {},
        validatedPatient.nemIsmertPoziciokbanImplantatum || false,
        validatedPatient.nemIsmertPoziciokbanImplantatumRészletek || null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    return NextResponse.json({ patient: result.rows[0] }, { status: 200 });
  } catch (error: any) {
    console.error('Hiba a beteg frissítésekor:', error);
    
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Érvénytelen adatok', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Hiba történt a beteg frissítésekor' },
      { status: 500 }
    );
  }
}

// Beteg törlése
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const pool = getDbPool();
    const result = await pool.query(
      'DELETE FROM patients WHERE id = $1 RETURNING id',
      [params.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Beteg sikeresen törölve' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Hiba a beteg törlésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a beteg törlésekor' },
      { status: 500 }
    );
  }
}

