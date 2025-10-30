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
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy",
        updated_by as "updatedBy"
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
    // Authorization: require authenticated user (any allowed login)
    const requester = request.headers.get('x-user-email') || '';
    if (!requester) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges a módosításhoz' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedPatient = patientSchema.parse(body);
    
    const pool = getDbPool();
    const userEmail = request.headers.get('x-user-email') || null;
    
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
        kezelesre_erkezes_indoka = $19,
        maxilladefektus_van = $20,
        brown_fuggoleges_osztaly = $21,
        brown_vizszintes_komponens = $22,
        mandibuladefektus_van = $23,
        kovacs_dobak_osztaly = $24,
        nyelvmozgasok_akadalyozottak = $25,
        gombocos_beszed = $26,
        nyalmirigy_allapot = $27,
        fabian_fejerdy_protetikai_osztaly_felso = $28,
        fabian_fejerdy_protetikai_osztaly_also = $29,
        radioterapia = $30,
        radioterapia_dozis = $31,
        radioterapia_datum_intervallum = $32,
        chemoterapia = $33,
        chemoterapia_leiras = $34,
        fabian_fejerdy_protetikai_osztaly = $35,
        kezeleoorvos = $36,
        kezeleoorvos_intezete = $37,
        felvetel_datuma = $38,
        felso_fogpotlas_van = $39,
        felso_fogpotlas_mikor = $40,
        felso_fogpotlas_keszito = $41,
        felso_fogpotlas_elegedett = $42,
        felso_fogpotlas_problema = $43,
        also_fogpotlas_van = $44,
        also_fogpotlas_mikor = $45,
        also_fogpotlas_keszito = $46,
        also_fogpotlas_elegedett = $47,
        also_fogpotlas_problema = $48,
        meglevo_fogak = $49,
        felso_fogpotlas_tipus = $50,
        also_fogpotlas_tipus = $51,
        meglevo_implantatumok = $52,
        nem_ismert_poziciokban_implantatum = $53,
        nem_ismert_poziciokban_implantatum_reszletek = $54,
        tnm_staging = $55,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = $56
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
        created_at as "createdAt", updated_at as "updatedAt",
        created_by as "createdBy", updated_by as "updatedBy"`,
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
        validatedPatient.meglevoFogak 
          ? JSON.parse(JSON.stringify(validatedPatient.meglevoFogak))
          : {},
        validatedPatient.felsoFogpotlasTipus || null,
        validatedPatient.alsoFogpotlasTipus || null,
        validatedPatient.meglevoImplantatumok 
          ? JSON.parse(JSON.stringify(validatedPatient.meglevoImplantatumok))
          : {},
        validatedPatient.nemIsmertPoziciokbanImplantatum || false,
        validatedPatient.nemIsmertPoziciokbanImplantatumRészletek || null,
        validatedPatient.tnmStaging || null,
        userEmail
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
    // Authorization: require authenticated user (any allowed login)
    const requester = request.headers.get('x-user-email') || '';
    if (!requester) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges a törléshez' },
        { status: 401 }
      );
    }

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

