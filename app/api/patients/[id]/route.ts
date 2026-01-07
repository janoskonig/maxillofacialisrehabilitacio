import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { patientSchema } from '@/lib/types';
import { verifyAuth } from '@/lib/auth-server';
import { sendAppointmentTimeSlotFreedNotification } from '@/lib/email';
import { deleteGoogleCalendarEvent, createGoogleCalendarEvent } from '@/lib/google-calendar';
import { logActivity, logActivityWithAuth } from '@/lib/activity';

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
        beutalo_indokolas as "beutaloIndokolas",
        primer_mutet_leirasa as "primerMutetLeirasa",
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
        bno, diagnozis, primer_mutet_leirasa as "primerMutetLeirasa",
        baleset_idopont as "balesetIdopont",
        baleset_etiologiaja as "balesetEtiologiaja",
        baleset_egyeb as "balesetEgyeb",
        veleszuletett_rendellenessegek as "veleszuletettRendellenessegek",
        veleszuletett_mutetek_leirasa as "veleszuletettMutetekLeirasa",
        kezelesi_terv_felso as "kezelesiTervFelso",
        kezelesi_terv_also as "kezelesiTervAlso",
        kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto",
        kortorteneti_osszefoglalo as "kortortenetiOsszefoglalo",
        kezelesi_terv_melleklet as "kezelesiTervMelleklet",
        szakorvosi_velemeny as "szakorvosiVelemény",
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
    } else if (role === 'sebészorvos' && userEmail) {
      // Sebészorvos: csak azokat a betegeket látja, akik az ő intézményéből származnak
      // Lekérdezzük a felhasználó intézményét
      const userResult = await pool.query(
        `SELECT intezmeny FROM users WHERE email = $1`,
        [userEmail]
      );
      
      if (userResult.rows.length > 0 && userResult.rows[0].intezmeny) {
        const userInstitution = userResult.rows[0].intezmeny;
        // Ellenőrizzük, hogy a beteg beutalo_intezmeny mezője egyezik-e a felhasználó intézményével
        if (patient.beutaloIntezmeny !== userInstitution) {
          return NextResponse.json(
            { error: 'Nincs jogosultsága ehhez a beteghez' },
            { status: 403 }
          );
        }
      } else {
        // Ha nincs intézmény beállítva, ne lássa a beteget
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteghez' },
          { status: 403 }
        );
      }
    }
    // fogpótlástanász, admin, editor, viewer: mindent látnak (nincs szűrés)

    // Activity logging: patient viewed (csak ha be van jelentkezve)
    const authForLogging = await verifyAuth(request);
    if (authForLogging) {
      await logActivityWithAuth(
        request,
        authForLogging,
        'patient_viewed',
        `Patient ID: ${params.id}, Name: ${result.rows[0].nev || 'N/A'}`
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
    if (role === 'sebészorvos' && userEmail) {
      // Sebészorvos: csak azokat a betegeket szerkesztheti, akik az ő intézményéből származnak
      // Lekérdezzük a felhasználó intézményét
      const userResult = await pool.query(
        `SELECT intezmeny FROM users WHERE email = $1`,
        [userEmail]
      );
      
      if (userResult.rows.length > 0 && userResult.rows[0].intezmeny) {
        const userInstitution = userResult.rows[0].intezmeny;
        // Ellenőrizzük, hogy a beteg beutalo_intezmeny mezője egyezik-e a felhasználó intézményével
        if (oldPatient.beutalo_intezmeny !== userInstitution) {
          return NextResponse.json(
            { error: 'Nincs jogosultsága ehhez a beteg szerkesztéséhez. Csak az adott intézményből származó betegeket szerkesztheti.' },
            { status: 403 }
          );
        }
      } else {
        // Ha nincs intézmény beállítva, ne szerkeszthesse a beteget
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteg szerkesztéséhez' },
          { status: 403 }
        );
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
        beutalo_indokolas = $13,
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
        primer_mutet_leirasa = $58,
        baleset_idopont = $59,
        baleset_etiologiaja = $60,
        baleset_egyeb = $61,
        veleszuletett_rendellenessegek = $62::jsonb,
        veleszuletett_mutetek_leirasa = $63,
        kezelesi_terv_felso = $64::jsonb,
        kezelesi_terv_also = $65::jsonb,
        kezelesi_terv_arcot_erinto = $66::jsonb,
        kortorteneti_osszefoglalo = $67,
        kezelesi_terv_melleklet = $68,
        szakorvosi_velemeny = $69,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = $70
      WHERE id = $1
      RETURNING 
        id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
        email, cim, varos, iranyitoszam, beutalo_orvos as "beutaloOrvos",
        beutalo_intezmeny as "beutaloIntezmeny", beutalo_indokolas as "beutaloIndokolas",
        primer_mutet_leirasa as "primerMutetLeirasa",
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
        bno, diagnozis, primer_mutet_leirasa as "primerMutetLeirasa",
        baleset_idopont as "balesetIdopont",
        baleset_etiologiaja as "balesetEtiologiaja",
        baleset_egyeb as "balesetEgyeb",
        veleszuletett_rendellenessegek as "veleszuletettRendellenessegek",
        veleszuletett_mutetek_leirasa as "veleszuletettMutetekLeirasa",
        kezelesi_terv_felso as "kezelesiTervFelso",
        kezelesi_terv_also as "kezelesiTervAlso",
        kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto",
        kortorteneti_osszefoglalo as "kortortenetiOsszefoglalo",
        kezelesi_terv_melleklet as "kezelesiTervMelleklet",
        szakorvosi_velemeny as "szakorvosiVelemény",
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
        validatedPatient.beutaloIndokolas || null,
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
        validatedPatient.primerMutetLeirasa || null,
        validatedPatient.balesetIdopont || null,
        validatedPatient.balesetEtiologiaja || null,
        validatedPatient.balesetEgyeb || null,
        validatedPatient.veleszuletettRendellenessegek && Array.isArray(validatedPatient.veleszuletettRendellenessegek)
          ? JSON.stringify(validatedPatient.veleszuletettRendellenessegek)
          : '[]',
        validatedPatient.veleszuletettMutetekLeirasa || null,
        validatedPatient.kezelesiTervFelso && Array.isArray(validatedPatient.kezelesiTervFelso)
          ? JSON.stringify(validatedPatient.kezelesiTervFelso)
          : '[]',
        validatedPatient.kezelesiTervAlso && Array.isArray(validatedPatient.kezelesiTervAlso)
          ? JSON.stringify(validatedPatient.kezelesiTervAlso)
          : '[]',
        validatedPatient.kezelesiTervArcotErinto && Array.isArray(validatedPatient.kezelesiTervArcotErinto)
          ? JSON.stringify(validatedPatient.kezelesiTervArcotErinto)
          : '[]',
        validatedPatient.kortortenetiOsszefoglalo || null,
        validatedPatient.kezelesiTervMelleklet || null,
        validatedPatient.szakorvosiVelemény || null,
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
      
      // Helper function to normalize dates to YYYY-MM-DD format
      const normalizeDate = (val: any): string => {
        if (!val) return '';
        try {
          const date = new Date(val);
          if (isNaN(date.getTime())) return String(val).trim();
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        } catch {
          return String(val).trim();
        }
      };

      // Helper function to normalize JSON objects with sorted keys
      const normalizeJSON = (val: any): string => {
        if (!val) return '{}';
        try {
          if (typeof val === 'string') {
            // Try to parse if it's a JSON string
            const parsed = JSON.parse(val);
            return normalizeJSON(parsed);
          }
          if (Array.isArray(val)) {
            // Sort array items if they are objects
            const sorted = val.map(item => {
              if (typeof item === 'object' && item !== null) {
                return Object.keys(item).sort().reduce((acc, key) => {
                  acc[key] = item[key];
                  return acc;
                }, {} as any);
              }
              return item;
            });
            return JSON.stringify(sorted);
          }
          if (typeof val === 'object' && val !== null) {
            // Sort object keys
            const sorted = Object.keys(val).sort().reduce((acc, key) => {
              acc[key] = val[key];
              return acc;
            }, {} as any);
            return JSON.stringify(sorted);
          }
          return JSON.stringify(val);
        } catch {
          return JSON.stringify(val);
        }
      };

      // Helper function to normalize values for comparison and storage
      const normalize = (val: any, fieldName?: string): string => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        
        // Handle date fields
        const dateFields = ['szuletesi_datum', 'mutet_ideje', 'felvetel_datuma', 'felso_fogpotlas_mikor', 
                           'also_fogpotlas_mikor', 'baleset_idopont', 'arajanlatkero_datuma'];
        if (fieldName && dateFields.includes(fieldName)) {
          return normalizeDate(val);
        }
        
        // Handle JSON array fields (kezelesi_terv fields)
        const jsonArrayFields = ['kezelesi_terv_felso', 'kezelesi_terv_also', 'kezelesi_terv_arcot_erinto',
                                 'veleszuletett_rendellenessegek'];
        if (fieldName && jsonArrayFields.includes(fieldName)) {
          return normalizeJSON(val);
        }
        
        if (typeof val === 'object') {
          return normalizeJSON(val);
        }
        
        return String(val).trim();
      };
      
      // Helper function to get display value (for showing in UI)
      const getDisplayValue = (val: string): string => {
        return val || '(üres)';
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
        beutalo_indokolas: 'Beutaló indokolás',
        primer_mutet_leirasa: 'Primer műtét leírása',
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
        kortorteneti_osszefoglalo: 'Kórtörténeti összefoglaló',
        kezelesi_terv_melleklet: 'Kezelési terv melléklet',
        szakorvosi_velemeny: 'Szakorvosi vélemény',
        arajanlatkero_szoveg: 'Árajánlatkérő szöveg',
        arajanlatkero_datuma: 'Árajánlatkérő dátuma',
        kezelesi_terv_also: 'Kezelési terv (alsó)',
        kezelesi_terv_arcot_erinto: 'Kezelési terv (arcot érintő rehabilitáció)',
      };
      
      // Track changes for structured logging
      const structuredChanges: Array<{
        fieldName: string;
        fieldDisplayName: string;
        oldValue: string;
        newValue: string;
      }> = [];
      
      // Check all fields for changes
      for (const [dbField, displayName] of Object.entries(fieldNames)) {
        const oldVal = normalize(oldPatient[dbField], dbField);
        let newVal: string;
        
        // Map validated patient fields back to database field names
        if (dbField === 'szuletesi_datum') newVal = normalize(validatedPatient.szuletesiDatum, dbField);
        else if (dbField === 'beutalo_orvos') newVal = normalize(validatedPatient.beutaloOrvos, dbField);
        else if (dbField === 'beutalo_intezmeny') newVal = normalize(validatedPatient.beutaloIntezmeny, dbField);
        else if (dbField === 'beutalo_indokolas') newVal = normalize(validatedPatient.beutaloIndokolas, dbField);
        else if (dbField === 'primer_mutet_leirasa') newVal = normalize(validatedPatient.primerMutetLeirasa, dbField);
        else if (dbField === 'mutet_ideje') newVal = normalize(validatedPatient.mutetIdeje, dbField);
        else if (dbField === 'szovettani_diagnozis') newVal = normalize(validatedPatient.szovettaniDiagnozis, dbField);
        else if (dbField === 'nyaki_blokkdisszekcio') newVal = normalize(validatedPatient.nyakiBlokkdisszekcio, dbField);
        else if (dbField === 'dohanyzas_szam') newVal = normalize(validatedPatient.dohanyzasSzam, dbField);
        else if (dbField === 'kezelesre_erkezes_indoka') newVal = normalize(validatedPatient.kezelesreErkezesIndoka, dbField);
        else if (dbField === 'maxilladefektus_van') newVal = normalize(validatedPatient.maxilladefektusVan, dbField);
        else if (dbField === 'brown_fuggoleges_osztaly') newVal = normalize(validatedPatient.brownFuggolegesOsztaly, dbField);
        else if (dbField === 'brown_vizszintes_komponens') newVal = normalize(validatedPatient.brownVizszintesKomponens, dbField);
        else if (dbField === 'mandibuladefektus_van') newVal = normalize(validatedPatient.mandibuladefektusVan, dbField);
        else if (dbField === 'kovacs_dobak_osztaly') newVal = normalize(validatedPatient.kovacsDobakOsztaly, dbField);
        else if (dbField === 'nyelvmozgasok_akadalyozottak') newVal = normalize(validatedPatient.nyelvmozgásokAkadályozottak, dbField);
        else if (dbField === 'gombocos_beszed') newVal = normalize(validatedPatient.gombocosBeszed, dbField);
        else if (dbField === 'nyalmirigy_allapot') newVal = normalize(validatedPatient.nyalmirigyAllapot, dbField);
        else if (dbField === 'fabian_fejerdy_protetikai_osztaly_felso') newVal = normalize(validatedPatient.fabianFejerdyProtetikaiOsztalyFelso, dbField);
        else if (dbField === 'fabian_fejerdy_protetikai_osztaly_also') newVal = normalize(validatedPatient.fabianFejerdyProtetikaiOsztalyAlso, dbField);
        else if (dbField === 'radioterapia_dozis') newVal = normalize(validatedPatient.radioterapiaDozis, dbField);
        else if (dbField === 'radioterapia_datum_intervallum') newVal = normalize(validatedPatient.radioterapiaDatumIntervallum, dbField);
        else if (dbField === 'chemoterapia_leiras') newVal = normalize(validatedPatient.chemoterapiaLeiras, dbField);
        else if (dbField === 'fabian_fejerdy_protetikai_osztaly') newVal = normalize(validatedPatient.fabianFejerdyProtetikaiOsztaly, dbField);
        else if (dbField === 'kezeleoorvos_intezete') newVal = normalize(validatedPatient.kezeleoorvosIntezete, dbField);
        else if (dbField === 'felvetel_datuma') newVal = normalize(validatedPatient.felvetelDatuma, dbField);
        else if (dbField === 'felso_fogpotlas_van') newVal = normalize(validatedPatient.felsoFogpotlasVan, dbField);
        else if (dbField === 'felso_fogpotlas_mikor') newVal = normalize(validatedPatient.felsoFogpotlasMikor, dbField);
        else if (dbField === 'felso_fogpotlas_keszito') newVal = normalize(validatedPatient.felsoFogpotlasKeszito, dbField);
        else if (dbField === 'felso_fogpotlas_elegedett') newVal = normalize(validatedPatient.felsoFogpotlasElegedett, dbField);
        else if (dbField === 'felso_fogpotlas_problema') newVal = normalize(validatedPatient.felsoFogpotlasProblema, dbField);
        else if (dbField === 'also_fogpotlas_van') newVal = normalize(validatedPatient.alsoFogpotlasVan, dbField);
        else if (dbField === 'also_fogpotlas_mikor') newVal = normalize(validatedPatient.alsoFogpotlasMikor, dbField);
        else if (dbField === 'also_fogpotlas_keszito') newVal = normalize(validatedPatient.alsoFogpotlasKeszito, dbField);
        else if (dbField === 'also_fogpotlas_elegedett') newVal = normalize(validatedPatient.alsoFogpotlasElegedett, dbField);
        else if (dbField === 'also_fogpotlas_problema') newVal = normalize(validatedPatient.alsoFogpotlasProblema, dbField);
        else if (dbField === 'felso_fogpotlas_tipus') newVal = normalize(validatedPatient.felsoFogpotlasTipus, dbField);
        else if (dbField === 'also_fogpotlas_tipus') newVal = normalize(validatedPatient.alsoFogpotlasTipus, dbField);
        else if (dbField === 'tnm_staging') newVal = normalize(validatedPatient.tnmStaging, dbField);
        else if (dbField === 'bno') newVal = normalize(validatedPatient.bno, dbField);
        else if (dbField === 'diagnozis') newVal = normalize(validatedPatient.diagnozis, dbField);
        else if (dbField === 'kezelesi_terv_felso') newVal = normalize(validatedPatient.kezelesiTervFelso, dbField);
        else if (dbField === 'kezelesi_terv_also') newVal = normalize(validatedPatient.kezelesiTervAlso, dbField);
        else if (dbField === 'kezelesi_terv_arcot_erinto') newVal = normalize(validatedPatient.kezelesiTervArcotErinto, dbField);
        else if (dbField === 'kortorteneti_osszefoglalo') newVal = normalize(validatedPatient.kortortenetiOsszefoglalo, dbField);
        else if (dbField === 'kezelesi_terv_melleklet') newVal = normalize(validatedPatient.kezelesiTervMelleklet, dbField);
        else if (dbField === 'szakorvosi_velemeny') newVal = normalize(validatedPatient.szakorvosiVelemény, dbField);
        else {
          // Direct field name mapping (camelCase to snake_case handled above)
          const camelField = dbField.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          newVal = normalize((validatedPatient as any)[camelField] ?? (validatedPatient as any)[dbField], dbField);
        }
        
        if (oldVal !== newVal) {
          const oldDisplay = getDisplayValue(oldVal);
          const newDisplay = getDisplayValue(newVal);
          changes.push(`${displayName}: "${oldDisplay}" → "${newDisplay}"`);
          
          // Store structured change
          structuredChanges.push({
            fieldName: dbField,
            fieldDisplayName: displayName,
            oldValue: oldVal,
            newValue: newVal,
          });
        }
      }
      
      // Special handling for JSONB fields
      const jsonbFields = [
        { db: 'meglevo_fogak', patient: 'meglevoFogak', name: 'Meglévő fogak' },
        { db: 'meglevo_implantatumok', patient: 'meglevoImplantatumok', name: 'Meglévő implantátumok' },
      ];
      
      for (const { db, patient, name } of jsonbFields) {
        const oldJson = oldPatient[db] ? normalizeJSON(oldPatient[db]) : '{}';
        const newJson = (validatedPatient as any)[patient] 
          ? normalizeJSON((validatedPatient as any)[patient]) 
          : '{}';
        if (oldJson !== newJson) {
          changes.push(`${name}: módosítva`);
          
          // Store structured change for JSONB fields
          structuredChanges.push({
            fieldName: db,
            fieldDisplayName: name,
            oldValue: oldJson,
            newValue: newJson,
          });
        }
      }
      
      // Log structured changes to patient_changes table
      if (structuredChanges.length > 0) {
        for (const change of structuredChanges) {
          try {
            await pool.query(
              `INSERT INTO patient_changes (patient_id, field_name, field_display_name, old_value, new_value, changed_by, ip_address)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                params.id,
                change.fieldName,
                change.fieldDisplayName,
                change.oldValue || null,
                change.newValue || null,
                userEmail,
                ipAddress
              ]
            );
          } catch (changeLogError) {
            // Log error but don't fail the request
            console.error('Failed to log structured change:', changeLogError);
          }
        }
      }
      
      // Keep existing activity_logs for compatibility
      const detailText = changes.length > 0 
        ? `Patient ID: ${params.id}, Name: ${newPatient.nev || 'N/A'}; Módosítások: ${changes.join('; ')}`
        : `Patient ID: ${params.id}, Name: ${newPatient.nev || 'N/A'}; Nincs változás`;
      
      await logActivity(request, userEmail, 'patient_updated', detailText);
    } catch (logError) {
      // Activity logging failed, but don't fail the request
      console.error('Failed to log activity:', logError);
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

// Beteg törlése (csak admin)
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

    // Only admin can delete patients
    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak admin törölhet betegeket' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const userEmail = auth.email;
    
    // Get patient details
    const patientResult = await pool.query(
      'SELECT id, nev, taj, email FROM patients WHERE id = $1',
      [params.id]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }
    
    const patient = patientResult.rows[0];
    
    // Check if patient has appointments
    const appointmentResult = await pool.query(
      `SELECT 
        a.id,
        a.time_slot_id,
        a.dentist_email,
        a.google_calendar_event_id,
        ats.start_time,
        ats.user_id as time_slot_user_id,
        ats.source as time_slot_source,
        ats.google_calendar_event_id as time_slot_google_calendar_event_id,
        u.email as time_slot_user_email
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN users u ON ats.user_id = u.id
      WHERE a.patient_id = $1`,
      [params.id]
    );

    const appointments = appointmentResult.rows;

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Delete appointments and free up time slots
      for (const appointment of appointments) {
        // Delete the appointment
        await pool.query('DELETE FROM appointments WHERE id = $1', [appointment.id]);
        
        // Update time slot status back to available
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['available', appointment.time_slot_id]
        );
      }

      // Delete the patient (this will cascade delete appointments due to ON DELETE CASCADE, but we already handled it)
      await pool.query('DELETE FROM patients WHERE id = $1', [params.id]);

      await pool.query('COMMIT');

      // Send email notifications and handle Google Calendar events for freed time slots
      for (const appointment of appointments) {
        const startTime = new Date(appointment.start_time);
        
        // Send email to dentist
        if (appointment.dentist_email) {
          try {
            await sendAppointmentTimeSlotFreedNotification(
              appointment.dentist_email,
              patient.nev,
              patient.taj,
              startTime,
              userEmail
            );
          } catch (emailError) {
            console.error('Failed to send time slot freed email to dentist:', emailError);
            // Don't fail the request if email fails
          }
        }
        
        // Handle Google Calendar events
        if (appointment.google_calendar_event_id && appointment.time_slot_user_id) {
          try {
            // Naptár ID-k lekérése a felhasználó beállításaiból
            const userCalendarResult = await pool.query(
              `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
               FROM users 
               WHERE id = $1`,
              [appointment.time_slot_user_id]
            );
            const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
            const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
            
            // Töröljük a beteg nevével létrehozott eseményt a cél naptárból
            await deleteGoogleCalendarEvent(
              appointment.time_slot_user_id,
              appointment.google_calendar_event_id,
              targetCalendarId
            );
            console.log('[Patient Deletion] Deleted patient event from target calendar');
            
            // Ha a time slot Google Calendar-ból származik, hozzuk vissza a "szabad" eseményt a forrás naptárba
            const isFromGoogleCalendar = appointment.time_slot_source === 'google_calendar' && appointment.time_slot_google_calendar_event_id;
            
            if (isFromGoogleCalendar) {
              const endTime = new Date(startTime);
              endTime.setMinutes(endTime.getMinutes() + 30); // 30 minutes duration
              
              // Létrehozzuk a "szabad" eseményt a forrás naptárba
              const szabadEventId = await createGoogleCalendarEvent(
                appointment.time_slot_user_id,
                {
                  summary: 'szabad',
                  description: 'Szabad időpont',
                  startTime: startTime,
                  endTime: endTime,
                  location: 'Maxillofaciális Rehabilitáció',
                  calendarId: sourceCalendarId,
                }
              );
              
              if (szabadEventId) {
                console.log('[Patient Deletion] Recreated "szabad" event in source calendar');
                // Frissítjük a time slot google_calendar_event_id mezőjét az új esemény ID-jával
                await pool.query(
                  `UPDATE available_time_slots 
                   SET google_calendar_event_id = $1 
                   WHERE id = $2`,
                  [szabadEventId, appointment.time_slot_id]
                );
              } else {
                console.error('[Patient Deletion] Failed to recreate "szabad" event in source calendar');
              }
            }
          } catch (error) {
            console.error('Failed to handle Google Calendar event during patient deletion:', error);
            // Nem blokkolja a beteg törlését
          }
        }
      }

      // Send email to all admins about freed time slots
      if (appointments.length > 0) {
        try {
          const adminResult = await pool.query(
            'SELECT email FROM users WHERE role = $1 AND active = true',
            ['admin']
          );
          
          if (adminResult.rows.length > 0) {
            const adminEmails = adminResult.rows.map((row: any) => row.email);
            
            // Send notification for each freed appointment
            for (const appointment of appointments) {
              const startTime = new Date(appointment.start_time);
              try {
                await sendAppointmentTimeSlotFreedNotification(
                  adminEmails,
                  patient.nev,
                  patient.taj,
                  startTime,
                  userEmail,
                  appointment.dentist_email
                );
              } catch (emailError) {
                console.error('Failed to send time slot freed email to admins:', emailError);
                // Don't fail the request if email fails
              }
            }
          }
        } catch (emailError) {
          console.error('Failed to send time slot freed email to admins:', emailError);
          // Don't fail the request if email fails
        }
      }

      // Activity logging: patient deleted
      const appointmentInfo = appointments.length > 0 
        ? `, ${appointments.length} időpont törölve és felszabadítva`
        : '';
      await logActivity(
        request,
        userEmail,
        'patient_deleted',
        `Patient ID: ${params.id}, Name: ${patient.nev || 'N/A'}${appointmentInfo}`
      );

      return NextResponse.json(
        { 
          message: 'Beteg sikeresen törölve',
          appointmentsFreed: appointments.length
        },
        { status: 200 }
      );
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Hiba a beteg törlésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a beteg törlésekor' },
      { status: 500 }
    );
  }
}

