import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { Patient, patientSchema } from '@/lib/types';
import { verifyAuth } from '@/lib/auth-server';
import { sendPatientCreationNotification } from '@/lib/email';
import { logActivity, logActivityWithAuth } from '@/lib/activity';

// Patient SELECT lista - közös használatra
const PATIENT_SELECT_FIELDS = `
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
  bno,
  diagnozis,
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
  halal_datum as "halalDatum",
  created_at as "createdAt",
  updated_at as "updatedAt",
  created_by as "createdBy",
  updated_by as "updatedBy"
`;

// Összes beteg lekérdezése
export async function GET(request: NextRequest) {
  try {
    const pool = getDbPool();
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const forMention = searchParams.get('forMention') === 'true';

    // Ellenőrizzük a felhasználó szerepkörét és jogosultságait
    const auth = await verifyAuth(request);
    const role = auth?.role || null;
    const userEmail = auth?.email || null;
    
    // Szerepkör alapú szűrés meghatározása
    let whereConditions: string[] = [];
    let queryParams: string[] = [];
    let paramIndex = 1;
    
    // JOIN szükséges-e a users táblával (sebészorvos szerepkör esetén)
    let needsUserJoin = false;
    // Lokális változó a userEmail-hez, amely garantáltan string, ha needsUserJoin igaz
    let surgeonEmail: string | null = null;
    
    if (role === 'technikus') {
      // Technikus: csak azokat a betegeket látja, akikhez arcot érintő kezelési terv van
      // Ellenőrizzük, hogy a kezelesi_terv_arcot_erinto mező nem NULL és nem üres tömb (tömb hossza > 0)
      whereConditions.push(`kezelesi_terv_arcot_erinto IS NOT NULL AND jsonb_array_length(kezelesi_terv_arcot_erinto) > 0`);
    } else if (role === 'sebészorvos' && userEmail) {
      // Optimalizálás: JOIN használata a users táblával az intézmény lekérdezéséhez
      // Így egyetlen query-ben megkapjuk az intézményt és a betegeket
      needsUserJoin = true;
      surgeonEmail = userEmail; // Most már garantáltan string, mert ellenőriztük
      // A JOIN feltételt a FROM részben kezeljük
    }
    // fogpótlástanász, admin, editor, viewer: mindent látnak (nincs szűrés)
    
    let countResult;
    let result;
    
    if (query) {
      // FROM klauzula építése JOIN-nal ha szükséges
      let fromClause: string;
      let selectFields: string;
      let orderBy: string;
      
      if (needsUserJoin && surgeonEmail) {
        // JOIN esetén prefixeljük a mezőket 'p.'-vel
        // surgeonEmail garantáltan string, mert csak akkor állítjuk be, ha userEmail nem null
        const emailForQuery: string = surgeonEmail; // Type assertion: már ellenőriztük, hogy nem null
        fromClause = `FROM patients p JOIN users u ON u.email = $${paramIndex} AND p.beutalo_intezmeny = u.intezmeny AND u.intezmeny IS NOT NULL`;
        queryParams.push(emailForQuery);
        paramIndex++;
        // SELECT mezők prefixelése
        selectFields = PATIENT_SELECT_FIELDS.split(',').map(f => {
          const trimmed = f.trim();
          // Ha már van alias (pl. "as something"), ne módosítsuk
          if (trimmed.includes(' as ')) {
            const parts = trimmed.split(' as ');
            return `p.${parts[0].trim()} as ${parts[1].trim()}`;
          }
          return `p.${trimmed}`;
        }).join(', ');
        orderBy = 'p.created_at';
      } else {
        fromClause = `FROM patients`;
        selectFields = PATIENT_SELECT_FIELDS;
        orderBy = 'created_at';
      }
      
      // Keresés - prefixeljük az oszlopokat, ha JOIN van
      const columnPrefix = needsUserJoin ? 'p.' : '';
      const searchBase = `(${columnPrefix}nev ILIKE $${paramIndex} OR ${columnPrefix}taj ILIKE $${paramIndex} OR ${columnPrefix}telefonszam ILIKE $${paramIndex} OR ${columnPrefix}email ILIKE $${paramIndex} OR ${columnPrefix}beutalo_orvos ILIKE $${paramIndex} OR ${columnPrefix}beutalo_intezmeny ILIKE $${paramIndex} OR ${columnPrefix}kezeleoorvos ILIKE $${paramIndex})`;
      queryParams.push(`%${query}%`);
      paramIndex++;
      
      // WHERE feltételek prefixelése, ha JOIN van
      const prefixedWhereConditions = needsUserJoin
        ? whereConditions.map(cond => cond.replace(/\b(kezelesi_terv_arcot_erinto)\b/g, 'p.$1'))
        : whereConditions;
      
      const searchCondition = prefixedWhereConditions.length > 0
        ? `${searchBase} AND ${prefixedWhereConditions.join(' AND ')}`
        : searchBase;
      
      // Count query
      const countQuery = `SELECT COUNT(*) as total ${fromClause} WHERE ${searchCondition}`;
      countResult = await pool.query(countQuery, queryParams);
      
      // Data query without pagination - get all results
      result = await pool.query(
        `SELECT ${selectFields}
         ${fromClause}
         WHERE ${searchCondition}
         ORDER BY ${orderBy} DESC`,
        queryParams
      );
    } else {
      // Összes beteg
      // FROM klauzula építése JOIN-nal ha szükséges
      let fromClause: string;
      let selectFields: string;
      let orderBy: string;
      let finalQueryParams: unknown[];
      
      if (needsUserJoin && surgeonEmail) {
        // surgeonEmail garantáltan string, mert csak akkor állítjuk be, ha userEmail nem null
        const emailForQuery: string = surgeonEmail; // Type assertion: már ellenőriztük, hogy nem null
        fromClause = `FROM patients p JOIN users u ON u.email = $1 AND p.beutalo_intezmeny = u.intezmeny AND u.intezmeny IS NOT NULL`;
        finalQueryParams = [emailForQuery, ...queryParams];
        // SELECT mezők prefixelése
        selectFields = PATIENT_SELECT_FIELDS.split(',').map(f => {
          const trimmed = f.trim();
          // Ha már van alias (pl. "as something"), ne módosítsuk
          if (trimmed.includes(' as ')) {
            const parts = trimmed.split(' as ');
            return `p.${parts[0].trim()} as ${parts[1].trim()}`;
          }
          return `p.${trimmed}`;
        }).join(', ');
        orderBy = 'p.created_at';
      } else {
        fromClause = `FROM patients`;
        selectFields = PATIENT_SELECT_FIELDS;
        orderBy = 'created_at';
        finalQueryParams = queryParams;
      }
      
      // WHERE feltételek prefixelése, ha JOIN van
      const prefixedWhereConditions = needsUserJoin
        ? whereConditions.map(cond => cond.replace(/\b(kezelesi_terv_arcot_erinto)\b/g, 'p.$1'))
        : whereConditions;
      
      const whereClause = prefixedWhereConditions.length > 0
        ? `WHERE ${prefixedWhereConditions.join(' AND ')}`
        : '';
      
      // Count query
      const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
      countResult = await pool.query(
        countQuery,
        finalQueryParams
      );
      
      // Data query without pagination - get all results
      result = await pool.query(
        `SELECT ${selectFields}
         ${fromClause}
         ${whereClause}
         ORDER BY ${orderBy} DESC`,
        finalQueryParams
      );
    }
    
    const total = parseInt(countResult.rows[0].total, 10);

    // Activity logging: patients list viewed or searched (csak ha be van jelentkezve)
    if (auth && !forMention) {
      const searchQuery = request.nextUrl.searchParams.get('q');
      const action = searchQuery ? 'patient_search' : 'patients_list_viewed';
      const detail = searchQuery 
        ? `Search query: "${searchQuery}", Results: ${result.rows.length}`
        : `Total patients: ${result.rows.length}`;
      
      await logActivityWithAuth(request, auth, action, detail);
    }

    // Ha forMention=true, csak id és nev mezőket adunk vissza mention formátumban
    if (forMention) {
      const mentionPatients = result.rows
        .filter((row: any) => row.nev && row.nev.trim()) // Csak akiknek van neve
        .map((row: any) => {
          const nev = row.nev.trim();
          // Vezetéknév+keresztnév formátum (kisbetű, ékezetek nélkül)
          const mentionFormat = nev
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Ékezetek eltávolítása
            .replace(/\s+/g, '+') // Szóközök + jellel
            .replace(/[^a-z0-9+]/g, ''); // Csak betűk, számok és +
          
          return {
            id: row.id,
            nev: nev, // Eredeti név megjelenítéshez
            mentionFormat: `@${mentionFormat}`, // @vezeteknev+keresztnev formátum
          };
        });

      // Ha van q paraméter és + jelet tartalmaz (mention formátum), akkor szűrjük a mention formátum alapján
      if (query && query.includes('+')) {
        const queryNormalized = query.toLowerCase().replace('@', '').trim();
        const filtered = mentionPatients.filter((p: any) => {
          const mentionWithoutAt = p.mentionFormat.substring(1).toLowerCase();
          return mentionWithoutAt === queryNormalized || mentionWithoutAt.includes(queryNormalized);
        });
        return NextResponse.json({ 
          patients: filtered
        }, { status: 200 });
      }

      return NextResponse.json({ 
        patients: mentionPatients
      }, { status: 200 });
    }

    return NextResponse.json({ 
      patients: result.rows
    }, { status: 200 });
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
    const role = auth.role;
    
    // Sebészorvos esetén automatikusan beállítjuk a beutalo_orvos mezőt
    if (role === 'sebészorvos' && !validatedPatient.beutaloOrvos) {
      // Lekérdezzük a felhasználó teljes nevét (doktor_neve)
      const userResult = await pool.query(
        'SELECT doktor_neve FROM users WHERE id = $1',
        [auth.userId]
      );
      const doktorNeve = userResult.rows[0]?.doktor_neve;
      // Csak akkor töltjük ki, ha van teljes név (ne az emailt használjuk)
      if (doktorNeve && doktorNeve.trim() !== '') {
        validatedPatient.beutaloOrvos = doktorNeve;
      }
      // Ha nincs doktor_neve, akkor üresen hagyjuk (a felhasználó tölti ki manuálisan)
    }
    
    // TAJ-szám egyediség ellenőrzése
    if (validatedPatient.taj && validatedPatient.taj.trim() !== '') {
      // Normalizáljuk a TAJ-számot (eltávolítjuk a kötőjeleket)
      const normalizedTAJ = validatedPatient.taj.replace(/-/g, '');
      
      // Ellenőrizzük, hogy létezik-e már beteg ezzel a TAJ-számmal
      const existingPatient = await pool.query(
        `SELECT id, nev, taj FROM patients 
         WHERE REPLACE(taj, '-', '') = $1`,
        [normalizedTAJ]
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
    
    // Új betegnél ne generáljunk ID-t, hagyjuk az adatbázisnak generálni (DEFAULT generate_uuid())
    // Csak import esetén használjuk a megadott ID-t
    const patientId = validatedPatient.id || null;
    
    // Építjük a paraméterek tömbjét és a SQL query-t
    const values: (string | number | boolean | null | Record<string, unknown>)[] = [];
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
      validatedPatient.halalDatum || null,
      userEmail
    );
    
    // SQL query építése
    const idPart = patientId ? 'id, ' : '';
    const paramPlaceholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await pool.query(
      `INSERT INTO patients (
        ${idPart}nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos,
        iranyitoszam, beutalo_orvos, beutalo_intezmeny, beutalo_indokolas,
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
        tnm_staging, bno, diagnozis, primer_mutet_leirasa,
        baleset_idopont, baleset_etiologiaja, baleset_egyeb,
        veleszuletett_rendellenessegek, veleszuletett_mutetek_leirasa,
        kezelesi_terv_felso, kezelesi_terv_also, kezelesi_terv_arcot_erinto,
        kortorteneti_osszefoglalo, kezelesi_terv_melleklet, szakorvosi_velemeny,
        halal_datum, created_by
      ) VALUES (
        ${paramPlaceholders}
      )
      RETURNING 
        id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
        email, cim, varos, iranyitoszam, beutalo_orvos as "beutaloOrvos",
        beutalo_intezmeny as "beutaloIntezmeny", beutalo_indokolas as "beutaloIndokolas",
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
        halal_datum as "halalDatum",
        created_at as "createdAt", updated_at as "updatedAt",
        created_by as "createdBy", updated_by as "updatedBy"`,
      values
    );

    console.log('Beteg sikeresen mentve, ID:', result.rows[0].id);
    
    // Activity logging: patient created
    await logActivity(
      request,
      userEmail,
      'patient_created',
      `Patient ID: ${result.rows[0].id}, Name: ${result.rows[0].nev || 'N/A'}`
    );

    // Send email notification to admins if surgeon created the patient
    if (role === 'sebészorvos') {
      try {
        const adminResult = await pool.query(
          `SELECT email FROM users WHERE role = 'admin' AND active = true`
        );
        const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
        
        if (adminEmails.length > 0) {
          await sendPatientCreationNotification(
            adminEmails,
            result.rows[0].nev,
            result.rows[0].taj,
            userEmail,
            result.rows[0].createdAt || new Date().toISOString()
          );
        }
      } catch (emailError) {
        console.error('Failed to send patient creation notification email:', emailError);
        // Don't fail the request if email fails
      }
    }
    
    return NextResponse.json({ patient: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('Hiba a beteg mentésekor:', error);
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : { error };
    console.error('Hiba részletei:', errorDetails);
    
    // PostgreSQL hiba kódok ellenőrzése
    if (error && typeof error === 'object' && 'code' in error) {
      console.error('PostgreSQL hiba:', {
        code: (error as { code?: string }).code,
        detail: (error as { detail?: string }).detail,
        constraint: (error as { constraint?: string }).constraint,
      });
    }
    
    // Zod validation error ellenőrzése
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError' && 'errors' in error) {
      return NextResponse.json(
        { error: 'Érvénytelen adatok', details: (error as { errors: unknown }).errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Hiba történt a beteg mentésekor' },
      { status: 500 }
    );
  }
}

