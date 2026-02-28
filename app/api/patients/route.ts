import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { normalizeToTreatmentTypeCode } from '@/lib/treatment-type-normalize';
import { Patient, patientSchema } from '@/lib/types';
import { verifyAuth } from '@/lib/auth-server';
import { sendPatientCreationNotification } from '@/lib/email';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { optionalAuthHandler, authedHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { PATIENT_SELECT_FIELDS } from '@/lib/queries/patient-fields';
import { REQUIRED_DOC_TAGS } from '@/lib/clinical-rules';

type ViewPreset = 'neak_pending' | 'missing_docs';

interface ViewBuilder {
  (baseQuery: string, params: any[], paramIndex: number, needsUserJoin: boolean): {
    whereClause: string;
    params: any[];
    paramIndex: number;
  };
}

const VIEWS: Record<ViewPreset, ViewBuilder> = {
  missing_docs: (baseQuery, params, paramIndex, needsUserJoin) => {
    const patientIdColumn = needsUserJoin ? 'p.id' : 'patients.id';
    
    const missingTagChecks = REQUIRED_DOC_TAGS.map((tag, idx) => {
      return `NOT EXISTS (
        SELECT 1 FROM patient_documents pd${idx}
        WHERE pd${idx}.patient_id = ${patientIdColumn}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(pd${idx}.tags) AS tag_elem
          WHERE LOWER(tag_elem) = LOWER($${paramIndex + idx})
        )
      )`;
    });
    
    const tagParams = REQUIRED_DOC_TAGS.map(tag => tag.toLowerCase());
    
    const whereClause = `(${missingTagChecks.join(' OR ')})`;
    
    return {
      whereClause,
      params: [...params, ...tagParams],
      paramIndex: paramIndex + tagParams.length,
    };
  },
  
  neak_pending: (baseQuery, params, paramIndex, needsUserJoin) => {
    const patientIdColumn = needsUserJoin ? 'p.id' : 'patients.id';
    
    const hasNeakDoc = `EXISTS (
      SELECT 1 FROM patient_documents pd_neak
      WHERE pd_neak.patient_id = ${patientIdColumn}
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(pd_neak.tags) AS tag_elem
        WHERE LOWER(tag_elem) = 'neak'
      )
    )`;
    
    const missingTagChecks = REQUIRED_DOC_TAGS.map((tag, idx) => {
      return `NOT EXISTS (
        SELECT 1 FROM patient_documents pd${idx}
        WHERE pd${idx}.patient_id = ${patientIdColumn}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(pd${idx}.tags) AS tag_elem
          WHERE LOWER(tag_elem) = LOWER($${paramIndex + idx})
        )
      )`;
    });
    
    const tagParams = REQUIRED_DOC_TAGS.map(tag => tag.toLowerCase());
    
    const whereClause = `${hasNeakDoc} AND (${missingTagChecks.join(' OR ')})`;
    
    return {
      whereClause,
      params: [...params, ...tagParams],
      paramIndex: paramIndex + tagParams.length,
    };
  },
};


export const dynamic = 'force-dynamic';

export const GET = optionalAuthHandler(async (req, { auth, correlationId }) => {
  const pool = getDbPool();
  const searchParams = req.nextUrl.searchParams;
  const query = searchParams.get('q');
  const forMention = searchParams.get('forMention') === 'true';
  const view = searchParams.get('view') as ViewPreset | null;
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const limit = forMention ? undefined : (limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10)), 500) : undefined);
  const offset = forMention ? undefined : (offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : undefined);

  const sortParam = searchParams.get('sort');
  const directionParam = searchParams.get('direction');
  const ALLOWED_SORT_COLUMNS: Record<string, string> = { nev: 'nev', createdAt: 'created_at' };
  const sortColumn = (sortParam && ALLOWED_SORT_COLUMNS[sortParam]) || 'created_at';
  const sortDir = directionParam === 'asc' ? 'ASC' : 'DESC';

  const role = auth?.role || null;
  const userEmail = auth?.email || null;
  
  let whereConditions: string[] = [];
  let queryParams: any[] = [];
  let paramIndex = 1;
  
  let needsUserJoin = false;
  let surgeonEmail: string | null = null;
  
  if (role === 'technikus') {
    whereConditions.push(`kezelesi_terv_arcot_erinto IS NOT NULL AND jsonb_array_length(kezelesi_terv_arcot_erinto) > 0`);
  } else if (role === 'sebészorvos' && userEmail) {
    needsUserJoin = true;
    surgeonEmail = userEmail;
  }
  
  let countResult;
  let result;
  
  if (query) {
    let fromClause: string;
    let selectFields: string;
    let orderBy: string;
    
    if (needsUserJoin && surgeonEmail) {
      const emailForQuery: string = surgeonEmail;
      fromClause = `FROM patients p JOIN users u ON u.email = $${paramIndex} AND p.beutalo_intezmeny = u.intezmeny AND u.intezmeny IS NOT NULL`;
      queryParams.push(emailForQuery);
      paramIndex++;
      selectFields = PATIENT_SELECT_FIELDS.split(',').map(f => {
        const trimmed = f.trim();
        if (trimmed.includes(' as ')) {
          const parts = trimmed.split(' as ');
          return `p.${parts[0].trim()} as ${parts[1].trim()}`;
        }
        return `p.${trimmed}`;
      }).join(', ');
      orderBy = `p.${sortColumn}`;
    } else {
      fromClause = `FROM patients`;
      selectFields = PATIENT_SELECT_FIELDS;
      orderBy = sortColumn;
    }
    
    const columnPrefix = needsUserJoin ? 'p.' : '';
    const searchBase = `(${columnPrefix}nev ILIKE $${paramIndex} OR ${columnPrefix}taj ILIKE $${paramIndex} OR ${columnPrefix}telefonszam ILIKE $${paramIndex} OR ${columnPrefix}email ILIKE $${paramIndex} OR ${columnPrefix}beutalo_orvos ILIKE $${paramIndex} OR ${columnPrefix}beutalo_intezmeny ILIKE $${paramIndex} OR ${columnPrefix}kezeleoorvos ILIKE $${paramIndex})`;
    queryParams.push(`%${query}%`);
    paramIndex++;
    
    const prefixedWhereConditions = needsUserJoin
      ? whereConditions.map(cond => cond.replace(/\b(kezelesi_terv_arcot_erinto)\b/g, 'p.$1'))
      : whereConditions;
    
    let viewCondition = '';
    if (view && VIEWS[view]) {
      const viewResult = VIEWS[view]('', queryParams, paramIndex, needsUserJoin);
      viewCondition = viewResult.whereClause;
      queryParams = viewResult.params;
      paramIndex = viewResult.paramIndex;
    }
    
    const allConditions = [
      searchBase,
      ...prefixedWhereConditions,
      ...(viewCondition ? [viewCondition] : []),
    ].filter(Boolean);
    
    const searchCondition = allConditions.join(' AND ');
    
    const countQuery = `SELECT COUNT(*) as total ${fromClause} WHERE ${searchCondition}`;
    countResult = await pool.query(countQuery, queryParams);
    
    let dataQueryParams: unknown[] = queryParams;
    let limitOffset = '';
    if (limit !== undefined && offset !== undefined) {
      dataQueryParams = [...queryParams, limit, offset];
      limitOffset = ` LIMIT $${dataQueryParams.length - 1} OFFSET $${dataQueryParams.length}`;
    } else if (limit !== undefined) {
      dataQueryParams = [...queryParams, limit];
      limitOffset = ` LIMIT $${dataQueryParams.length}`;
    }
    result = await pool.query(
      `SELECT ${selectFields}
       ${fromClause}
       WHERE ${searchCondition}
       ORDER BY ${orderBy} ${sortDir}${limitOffset}`,
      dataQueryParams
    );
  } else {
    let fromClause: string;
    let selectFields: string;
    let orderBy: string;
    let finalQueryParams: unknown[];
    
    if (needsUserJoin && surgeonEmail) {
      const emailForQuery: string = surgeonEmail;
      fromClause = `FROM patients p JOIN users u ON u.email = $1 AND p.beutalo_intezmeny = u.intezmeny AND u.intezmeny IS NOT NULL`;
      finalQueryParams = [emailForQuery, ...queryParams];
      selectFields = PATIENT_SELECT_FIELDS.split(',').map(f => {
        const trimmed = f.trim();
        if (trimmed.includes(' as ')) {
          const parts = trimmed.split(' as ');
          return `p.${parts[0].trim()} as ${parts[1].trim()}`;
        }
        return `p.${trimmed}`;
      }).join(', ');
      orderBy = `p.${sortColumn}`;
    } else {
      fromClause = `FROM patients`;
      selectFields = PATIENT_SELECT_FIELDS;
      orderBy = sortColumn;
      finalQueryParams = queryParams;
    }
    
    const prefixedWhereConditions = needsUserJoin
      ? whereConditions.map(cond => cond.replace(/\b(kezelesi_terv_arcot_erinto)\b/g, 'p.$1'))
      : whereConditions;
    
    const whereClause = prefixedWhereConditions.length > 0
      ? `WHERE ${prefixedWhereConditions.join(' AND ')}`
      : '';
    
    const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
    countResult = await pool.query(
      countQuery,
      finalQueryParams
    );
    
    let dataQueryParams: unknown[] = finalQueryParams;
    let limitOffset = '';
    if (limit !== undefined && offset !== undefined) {
      dataQueryParams = [...finalQueryParams, limit, offset];
      limitOffset = ` LIMIT $${dataQueryParams.length - 1} OFFSET $${dataQueryParams.length}`;
    } else if (limit !== undefined) {
      dataQueryParams = [...finalQueryParams, limit];
      limitOffset = ` LIMIT $${dataQueryParams.length}`;
    }
    result = await pool.query(
      `SELECT ${selectFields}
       ${fromClause}
       ${whereClause}
       ORDER BY ${orderBy} ${sortDir}${limitOffset}`,
      dataQueryParams
    );
  }
  
  const total = parseInt(countResult.rows[0].total, 10);

  if (auth && !forMention) {
    const searchQuery = req.nextUrl.searchParams.get('q');
    const action = searchQuery ? 'patient_search' : 'patients_list_viewed';
    const detail = searchQuery 
      ? `Search query: "${searchQuery}", Results: ${result.rows.length}`
      : `Total patients: ${result.rows.length}`;
    
    await logActivityWithAuth(req, auth, action, detail);
  }

  if (forMention) {
    const mentionPatients = result.rows
      .filter((row: any) => row.nev && row.nev.trim())
      .map((row: any) => {
        const nev = row.nev.trim();
        const mentionFormat = nev
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, '+')
          .replace(/[^a-z0-9+]/g, '');
        
        return {
          id: row.id,
          nev: nev,
          mentionFormat: `@${mentionFormat}`,
        };
      });

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
    patients: result.rows,
    total: total
  }, { status: 200 });
});

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  logger.info('POST /api/patients - Fogadott adatok:', JSON.stringify(body, null, 2));
  
  let validatedPatient = patientSchema.parse(body);
  logger.info('Validált adatok:', JSON.stringify(validatedPatient, null, 2));

  const pool = getDbPool();

  const validCodesResult = await pool.query(`SELECT code FROM treatment_types`);
  const validCodes = new Set((validCodesResult.rows ?? []).map((r: { code: string }) => r.code));
  const fieldErrors: Array<{ path: string; code: string; value: string }> = [];
  const normalizeAndValidate = (
    arr: Array<{ tipus?: string | null; treatmentTypeCode?: string | null; tervezettAtadasDatuma?: string | null; elkeszult?: boolean }> | null | undefined,
    fieldPrefix: string
  ): Array<{ treatmentTypeCode: string; tervezettAtadasDatuma: string | null; elkeszult: boolean }> => {
    if (!arr || !Array.isArray(arr)) return [];
    const out: Array<{ treatmentTypeCode: string; tervezettAtadasDatuma: string | null; elkeszult: boolean }> = [];
    arr.forEach((item, idx) => {
      const code = normalizeToTreatmentTypeCode(item.treatmentTypeCode) ?? normalizeToTreatmentTypeCode(item.tipus);
      if (!code || code.trim() === '') return;
      if (!validCodes.has(code)) {
        fieldErrors.push({
          path: `${fieldPrefix}.${idx}.treatmentTypeCode`,
          code: 'UNKNOWN_TREATMENT_TYPE_CODE',
          value: item.treatmentTypeCode ?? item.tipus ?? '',
        });
        return;
      }
      out.push({
        treatmentTypeCode: code,
        tervezettAtadasDatuma: item.tervezettAtadasDatuma ?? null,
        elkeszult: item.elkeszult ?? false,
      });
    });
    return out;
  };
  const normalizedFelso = normalizeAndValidate(validatedPatient.kezelesiTervFelso, 'kezelesi_terv_felso');
  const normalizedAlso = normalizeAndValidate(validatedPatient.kezelesiTervAlso, 'kezelesi_terv_also');
  if (fieldErrors.length > 0) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Invalid treatmentTypeCode', fieldErrors },
      { status: 400 }
    );
  }
  validatedPatient = {
    ...validatedPatient,
    kezelesiTervFelso: normalizedFelso,
    kezelesiTervAlso: normalizedAlso,
  };
  const userEmail = auth.email;
  const role = auth.role;
  
  if (role === 'sebészorvos' && !validatedPatient.beutaloOrvos) {
    const userResult = await pool.query(
      'SELECT doktor_neve FROM users WHERE id = $1',
      [auth.userId]
    );
    const doktorNeve = userResult.rows[0]?.doktor_neve;
    if (doktorNeve && doktorNeve.trim() !== '') {
      validatedPatient.beutaloOrvos = doktorNeve;
    }
  }
  
  if (validatedPatient.taj && validatedPatient.taj.trim() !== '') {
    const normalizedTAJ = validatedPatient.taj.replace(/-/g, '');
    
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
  
  const patientId = validatedPatient.id || null;
  
  const values: (string | number | boolean | null | Record<string, unknown>)[] = [];
  let paramIndex = 1;
  
  if (patientId) {
    values.push(patientId);
  }
  
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

  logger.info('Beteg sikeresen mentve, ID:', result.rows[0].id);
  
  await logActivity(
    req,
    userEmail,
    'patient_created',
    `Patient ID: ${result.rows[0].id}, Name: ${result.rows[0].nev || 'N/A'}`
  );

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
      logger.error('Failed to send patient creation notification email:', emailError);
    }
  }
  
  return NextResponse.json({ patient: result.rows[0] }, { status: 201 });
});
