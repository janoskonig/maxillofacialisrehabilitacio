import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { patientSchema } from '@/lib/types';
import { verifyAuth } from '@/lib/auth-server';

// Egy beteg lekérdezése ID alapján
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const pool = getDbPool();
    
    // Ellenőrizzük a felhasználó szerepkörét és jogosultságait
    const auth = await verifyAuth(request);
    const role = auth?.role || null;
    const userEmail = auth?.email || null;
    
    // Először lekérdezzük a beteget
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
        kezelesi_terv_felso as "kezelesiTervFelso",
        kezelesi_terv_also as "kezelesiTervAlso",
        kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto",
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
    
    const patient = result.rows[0];
    
    // Szerepkör alapú jogosultság ellenőrzés
    if (role === 'technikus') {
      // Technikus: csak azokat a betegeket látja, akikhez epitézist rendeltek
      const hasEpitesis = patient.kezelesiTervArcotErinto && 
                          Array.isArray(patient.kezelesiTervArcotErinto) && 
                          patient.kezelesiTervArcotErinto.length > 0;
      if (!hasEpitesis) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteghez' },
          { status: 403 }
        );
      }
    } else if (role === 'sebészorvos') {
      // Sebészorvos: csak azokat a betegeket látja, akiket ő utalt be
      // Pontos egyezés: a beutalo_orvos mező pontosan egyezzen az email címmel
      if (!userEmail || patient.beutaloOrvos !== userEmail) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteghez' },
          { status: 403 }
        );
      }
    }
    // fogpótlástanász, admin, editor, viewer: mindent látnak (nincs szűrés)

    // Activity logging: patient viewed (csak ha be van jelentkezve)
    try {
      const auth = await verifyAuth(request);
      if (auth) {
      const ipHeader = request.headers.get('x-forwarded-for') || '';
      const ipAddress = ipHeader.split(',')[0]?.trim() || null;
      await pool.query(
        `INSERT INTO activity_logs (user_email, action, detail, ip_address)
         VALUES ($1, $2, $3, $4)`,
          [auth.email, 'patient_viewed', `Patient ID: ${params.id}, Name: ${result.rows[0].nev || 'N/A'}`, ipAddress]
      );
      }
    } catch (logError) {
      console.error('Failed to log activity:', logError);
      // Don't fail the request if logging fails
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
    // Authorization: require authenticated user
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges a módosításhoz' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedPatient = patientSchema.parse(body);
    
    const pool = getDbPool();
    const userEmail = auth.email;
    const role = auth.role;
    
    // Get old patient data for comparison
    const oldPatientResult = await pool.query(
      `SELECT * FROM patients WHERE id = $1`,
      [params.id]
    );
    
    if (oldPatientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }
    
    const oldPatient = oldPatientResult.rows[0];
    
    // Szerepkör alapú jogosultság ellenőrzés szerkesztéshez
    if (role === 'sebészorvos') {
      // Sebészorvos: csak azokat a betegeket szerkesztheti, akiket ő hozott létre (created_by)
      if (!userEmail || oldPatient.created_by !== userEmail) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteg szerkesztéséhez. Csak az általuk létrehozott betegeket szerkeszthetik.' },
          { status: 403 }
        );
      }
      // Sebészorvos esetén biztosítjuk, hogy a beutalo_orvos mező ne változzon meg
      if (validatedPatient.beutaloOrvos && validatedPatient.beutaloOrvos !== userEmail) {
        return NextResponse.json(
          { error: 'Nem módosíthatja a beutaló orvos mezőt' },
          { status: 403 }
        );
      }
      // Ha nincs beállítva, automatikusan beállítjuk
      if (!validatedPatient.beutaloOrvos) {
        validatedPatient.beutaloOrvos = userEmail;
      }
    } else if (role === 'technikus') {
      // Technikus: csak azokat a betegeket szerkesztheti, akikhez epitézist rendeltek
      const hasEpitesis = oldPatient.kezelesi_terv_arcot_erinto && 
                          Array.isArray(oldPatient.kezelesi_terv_arcot_erinto) && 
                          oldPatient.kezelesi_terv_arcot_erinto.length > 0;
      if (!hasEpitesis) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteg szerkesztéséhez' },
          { status: 403 }
        );
      }
    }
    
    // TAJ-szám egyediség ellenőrzése (ha változott)
    if (validatedPatient.taj && validatedPatient.taj.trim() !== '') {
      // Normalizáljuk a TAJ-számot (eltávolítjuk a kötőjeleket)
      const normalizedTAJ = validatedPatient.taj.replace(/-/g, '');
      const oldNormalizedTAJ = oldPatient.taj ? oldPatient.taj.replace(/-/g, '') : '';
      
      // Csak akkor ellenőrizzük, ha a TAJ-szám változott
      if (normalizedTAJ !== oldNormalizedTAJ) {
        // Ellenőrizzük, hogy létezik-e már másik beteg ezzel a TAJ-számmal
        const existingPatient = await pool.query(
          `SELECT id, nev, taj FROM patients 
           WHERE REPLACE(taj, '-', '') = $1 AND id != $2`,
          [normalizedTAJ, params.id]
        );
        
        if (existingPatient.rows.length > 0) {
          const existing = existingPatient.rows[0];
          return NextResponse.json(
            { 
              error: 'Már létezik beteg ezzel a TAJ-számmal',
              details: `A TAJ-szám (${validatedPatient.taj}) már használatban van. Beteg: ${existing.nev || 'Név nélküli'} (ID: ${existing.id})`
            },
            { status: 409 }
          );
        }
      }
    }
    
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
        bno = $56,
        diagnozis = $57,
        kezelesi_terv_felso = $58::jsonb,
        kezelesi_terv_also = $59::jsonb,
        kezelesi_terv_arcot_erinto = $60::jsonb,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = $61
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
        bno, diagnozis,
        kezelesi_terv_felso as "kezelesiTervFelso",
        kezelesi_terv_also as "kezelesiTervAlso",
        kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto",
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
        validatedPatient.bno || null,
        validatedPatient.diagnozis || null,
        validatedPatient.kezelesiTervFelso && Array.isArray(validatedPatient.kezelesiTervFelso)
          ? JSON.stringify(validatedPatient.kezelesiTervFelso)
          : '[]',
        validatedPatient.kezelesiTervAlso && Array.isArray(validatedPatient.kezelesiTervAlso)
          ? JSON.stringify(validatedPatient.kezelesiTervAlso)
          : '[]',
        validatedPatient.kezelesiTervArcotErinto && Array.isArray(validatedPatient.kezelesiTervArcotErinto)
          ? JSON.stringify(validatedPatient.kezelesiTervArcotErinto)
          : '[]',
        userEmail
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    // Activity logging: patient updated with detailed changes
    try {
      const ipHeader = request.headers.get('x-forwarded-for') || '';
      const ipAddress = ipHeader.split(',')[0]?.trim() || null;
      
      // Compare old and new values to detect changes
      const changes: string[] = [];
      const newPatient = result.rows[0];
      
      // Helper function to normalize values for comparison
      const normalize = (val: any): string => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val).trim();
      };
      
      // Field mapping: database field -> display name
      const fieldNames: Record<string, string> = {
        nev: 'Név',
        taj: 'TAJ szám',
        telefonszam: 'Telefonszám',
        szuletesi_datum: 'Születési dátum',
        nem: 'Nem',
        email: 'Email',
        cim: 'Cím',
        varos: 'Város',
        iranyitoszam: 'Irányítószám',
        beutalo_orvos: 'Beutaló orvos',
        beutalo_intezmeny: 'Beutaló intézmény',
        mutet_rovid_leirasa: 'Műtét rövid leírása',
        mutet_ideje: 'Műtét ideje',
        szovettani_diagnozis: 'Szövettani diagnózis',
        nyaki_blokkdisszekcio: 'Nyaki blokkdisszekció',
        alkoholfogyasztas: 'Alkoholfogyasztás',
        dohanyzas_szam: 'Dohányzás',
        kezelesre_erkezes_indoka: 'Kezelésre érkezés indoka',
        maxilladefektus_van: 'Maxilladefektus',
        brown_fuggoleges_osztaly: 'Brown függőleges osztály',
        brown_vizszintes_komponens: 'Brown vízszintes komponens',
        mandibuladefektus_van: 'Mandibuladefektus',
        kovacs_dobak_osztaly: 'Kovács-Dobák osztály',
        nyelvmozgasok_akadalyozottak: 'Nyelvmozgások akadályozottak',
        gombocos_beszed: 'Gombócos beszéd',
        nyalmirigy_allapot: 'Nyálmirigy állapot',
        fabian_fejerdy_protetikai_osztaly_felso: 'Fábián-Fejérdy osztály (felső)',
        fabian_fejerdy_protetikai_osztaly_also: 'Fábián-Fejérdy osztály (alsó)',
        radioterapia: 'Radioterápia',
        radioterapia_dozis: 'Radioterápia dózis',
        radioterapia_datum_intervallum: 'Radioterápia dátumintervallum',
        chemoterapia: 'Kemoterápia',
        chemoterapia_leiras: 'Kemoterápia leírás',
        fabian_fejerdy_protetikai_osztaly: 'Fábián-Fejérdy protetikai osztály',
        kezeleoorvos: 'Kezelőorvos',
        kezeleoorvos_intezete: 'Kezelőorvos intézete',
        felvetel_datuma: 'Felvétel dátuma',
        felso_fogpotlas_van: 'Felső fogpótlás van',
        felso_fogpotlas_mikor: 'Felső fogpótlás mikor',
        felso_fogpotlas_keszito: 'Felső fogpótlás készítő',
        felso_fogpotlas_elegedett: 'Felső fogpótlás elégedett',
        felso_fogpotlas_problema: 'Felső fogpótlás probléma',
        also_fogpotlas_van: 'Alsó fogpótlás van',
        also_fogpotlas_mikor: 'Alsó fogpótlás mikor',
        also_fogpotlas_keszito: 'Alsó fogpótlás készítő',
        also_fogpotlas_elegedett: 'Alsó fogpótlás elégedett',
        also_fogpotlas_problema: 'Alsó fogpótlás probléma',
        felso_fogpotlas_tipus: 'Felső fogpótlás típus',
        also_fogpotlas_tipus: 'Alsó fogpótlás típus',
        tnm_staging: 'TNM staging',
        bno: 'BNO',
        diagnozis: 'Diagnózis',
        kezelesi_terv_felso: 'Kezelési terv (felső)',
        kezelesi_terv_also: 'Kezelési terv (alsó)',
        kezelesi_terv_arcot_erinto: 'Kezelési terv (arcot érintő rehabilitáció)',
      };
      
      // Check all fields for changes
      for (const [dbField, displayName] of Object.entries(fieldNames)) {
        const oldVal = normalize(oldPatient[dbField]);
        let newVal: string;
        
        // Map validated patient fields back to database field names
        if (dbField === 'szuletesi_datum') newVal = normalize(validatedPatient.szuletesiDatum);
        else if (dbField === 'beutalo_orvos') newVal = normalize(validatedPatient.beutaloOrvos);
        else if (dbField === 'beutalo_intezmeny') newVal = normalize(validatedPatient.beutaloIntezmeny);
        else if (dbField === 'mutet_rovid_leirasa') newVal = normalize(validatedPatient.mutetRovidLeirasa);
        else if (dbField === 'mutet_ideje') newVal = normalize(validatedPatient.mutetIdeje);
        else if (dbField === 'szovettani_diagnozis') newVal = normalize(validatedPatient.szovettaniDiagnozis);
        else if (dbField === 'nyaki_blokkdisszekcio') newVal = normalize(validatedPatient.nyakiBlokkdisszekcio);
        else if (dbField === 'dohanyzas_szam') newVal = normalize(validatedPatient.dohanyzasSzam);
        else if (dbField === 'kezelesre_erkezes_indoka') newVal = normalize(validatedPatient.kezelesreErkezesIndoka);
        else if (dbField === 'maxilladefektus_van') newVal = normalize(validatedPatient.maxilladefektusVan);
        else if (dbField === 'brown_fuggoleges_osztaly') newVal = normalize(validatedPatient.brownFuggolegesOsztaly);
        else if (dbField === 'brown_vizszintes_komponens') newVal = normalize(validatedPatient.brownVizszintesKomponens);
        else if (dbField === 'mandibuladefektus_van') newVal = normalize(validatedPatient.mandibuladefektusVan);
        else if (dbField === 'kovacs_dobak_osztaly') newVal = normalize(validatedPatient.kovacsDobakOsztaly);
        else if (dbField === 'nyelvmozgasok_akadalyozottak') newVal = normalize(validatedPatient.nyelvmozgásokAkadályozottak);
        else if (dbField === 'gombocos_beszed') newVal = normalize(validatedPatient.gombocosBeszed);
        else if (dbField === 'nyalmirigy_allapot') newVal = normalize(validatedPatient.nyalmirigyAllapot);
        else if (dbField === 'fabian_fejerdy_protetikai_osztaly_felso') newVal = normalize(validatedPatient.fabianFejerdyProtetikaiOsztalyFelso);
        else if (dbField === 'fabian_fejerdy_protetikai_osztaly_also') newVal = normalize(validatedPatient.fabianFejerdyProtetikaiOsztalyAlso);
        else if (dbField === 'radioterapia_dozis') newVal = normalize(validatedPatient.radioterapiaDozis);
        else if (dbField === 'radioterapia_datum_intervallum') newVal = normalize(validatedPatient.radioterapiaDatumIntervallum);
        else if (dbField === 'chemoterapia_leiras') newVal = normalize(validatedPatient.chemoterapiaLeiras);
        else if (dbField === 'fabian_fejerdy_protetikai_osztaly') newVal = normalize(validatedPatient.fabianFejerdyProtetikaiOsztaly);
        else if (dbField === 'kezeleoorvos_intezete') newVal = normalize(validatedPatient.kezeleoorvosIntezete);
        else if (dbField === 'felvetel_datuma') newVal = normalize(validatedPatient.felvetelDatuma);
        else if (dbField === 'felso_fogpotlas_van') newVal = normalize(validatedPatient.felsoFogpotlasVan);
        else if (dbField === 'felso_fogpotlas_mikor') newVal = normalize(validatedPatient.felsoFogpotlasMikor);
        else if (dbField === 'felso_fogpotlas_keszito') newVal = normalize(validatedPatient.felsoFogpotlasKeszito);
        else if (dbField === 'felso_fogpotlas_elegedett') newVal = normalize(validatedPatient.felsoFogpotlasElegedett);
        else if (dbField === 'felso_fogpotlas_problema') newVal = normalize(validatedPatient.felsoFogpotlasProblema);
        else if (dbField === 'also_fogpotlas_van') newVal = normalize(validatedPatient.alsoFogpotlasVan);
        else if (dbField === 'also_fogpotlas_mikor') newVal = normalize(validatedPatient.alsoFogpotlasMikor);
        else if (dbField === 'also_fogpotlas_keszito') newVal = normalize(validatedPatient.alsoFogpotlasKeszito);
        else if (dbField === 'also_fogpotlas_elegedett') newVal = normalize(validatedPatient.alsoFogpotlasElegedett);
        else if (dbField === 'also_fogpotlas_problema') newVal = normalize(validatedPatient.alsoFogpotlasProblema);
        else if (dbField === 'felso_fogpotlas_tipus') newVal = normalize(validatedPatient.felsoFogpotlasTipus);
        else if (dbField === 'also_fogpotlas_tipus') newVal = normalize(validatedPatient.alsoFogpotlasTipus);
        else if (dbField === 'tnm_staging') newVal = normalize(validatedPatient.tnmStaging);
        else if (dbField === 'bno') newVal = normalize(validatedPatient.bno);
        else if (dbField === 'diagnozis') newVal = normalize(validatedPatient.diagnozis);
        else if (dbField === 'kezelesi_terv_felso') newVal = normalize(validatedPatient.kezelesiTervFelso);
        else if (dbField === 'kezelesi_terv_also') newVal = normalize(validatedPatient.kezelesiTervAlso);
        else if (dbField === 'kezelesi_terv_arcot_erinto') newVal = normalize(validatedPatient.kezelesiTervArcotErinto);
        else {
          // Direct field name mapping (camelCase to snake_case handled above)
          const camelField = dbField.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          newVal = normalize((validatedPatient as any)[camelField] ?? (validatedPatient as any)[dbField]);
        }
        
        if (oldVal !== newVal) {
          const oldDisplay = oldVal || '(üres)';
          const newDisplay = newVal || '(üres)';
          changes.push(`${displayName}: "${oldDisplay}" → "${newDisplay}"`);
        }
      }
      
      // Special handling for JSONB fields
      const jsonbFields = [
        { db: 'meglevo_fogak', patient: 'meglevoFogak', name: 'Meglévő fogak' },
        { db: 'meglevo_implantatumok', patient: 'meglevoImplantatumok', name: 'Meglévő implantátumok' },
      ];
      
      for (const { db, patient, name } of jsonbFields) {
        const oldJson = oldPatient[db] ? JSON.stringify(oldPatient[db]) : '{}';
        const newJson = (validatedPatient as any)[patient] 
          ? JSON.stringify((validatedPatient as any)[patient]) 
          : '{}';
        if (oldJson !== newJson) {
          changes.push(`${name}: módosítva`);
        }
      }
      
      const detailText = changes.length > 0 
        ? `Patient ID: ${params.id}, Name: ${newPatient.nev || 'N/A'}; Módosítások: ${changes.join('; ')}`
        : `Patient ID: ${params.id}, Name: ${newPatient.nev || 'N/A'}; Nincs változás`;
      
      await pool.query(
        `INSERT INTO activity_logs (user_email, action, detail, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [userEmail, 'patient_updated', detailText, ipAddress]
      );
    } catch (logError) {
      console.error('Failed to log activity:', logError);
      // Don't fail the request if logging fails
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
    // Authorization: require authenticated user
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges a törléshez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const role = auth.role;
    const userEmail = auth.email;
    
    // Először lekérdezzük a beteget, hogy ellenőrizhessük a jogosultságot
    const patientResult = await pool.query(
      'SELECT id, beutalo_orvos FROM patients WHERE id = $1',
      [params.id]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }
    
    const patient = patientResult.rows[0];
    
    // Szerepkör alapú jogosultság ellenőrzés törléshez
    if (role === 'sebészorvos') {
      // Sebészorvos: csak azokat a betegeket törölheti, akiket ő utalt be
      if (!userEmail || patient.beutalo_orvos !== userEmail) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteg törléséhez' },
          { status: 403 }
        );
      }
    } else if (role === 'technikus') {
      // Technikus: nem törölhet betegeket
      return NextResponse.json(
        { error: 'Nincs jogosultsága betegek törléséhez' },
        { status: 403 }
      );
    }
    
    const result = await pool.query(
      'DELETE FROM patients WHERE id = $1 RETURNING id',
      [params.id]
    );

    // Activity logging: patient deleted
    try {
      const userEmail = auth.email;
      const ipHeader = request.headers.get('x-forwarded-for') || '';
      const ipAddress = ipHeader.split(',')[0]?.trim() || null;
      await pool.query(
        `INSERT INTO activity_logs (user_email, action, detail, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [userEmail, 'patient_deleted', `Patient ID: ${params.id}`, ipAddress]
      );
    } catch (logError) {
      console.error('Failed to log activity:', logError);
      // Don't fail the request if logging fails
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

