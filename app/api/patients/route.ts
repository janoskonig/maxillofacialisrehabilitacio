import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { normalizeToTreatmentTypeCode } from '@/lib/treatment-type-normalize';
import { Patient, patientSchema } from '@/lib/types';
import { verifyAuth } from '@/lib/auth-server';
import { sendPatientCreationNotification } from '@/lib/email';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { optionalAuthHandler, authedHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { PATIENT_LIST_FIELDS, PATIENT_SELECT_FIELDS } from '@/lib/queries/patient-fields';
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

  const needsSurgeonJoin = role === 'sebészorvos' && !!userEmail;
  const needsTechnikJoin = role === 'technikus';
  const needsReferralJoin = needsSurgeonJoin || !!query;

  const prefixedListFields = PATIENT_LIST_FIELDS.split(',').map(f => {
    const trimmed = f.trim();
    if (!trimmed) return '';
    if (trimmed.includes(' as ')) {
      const parts = trimmed.split(' as ');
      return `p.${parts[0].trim()} as ${parts[1].trim()}`;
    }
    return `p.${trimmed}`;
  }).filter(Boolean).join(', ');

  // Build FROM clause with conditional JOINs to child tables
  let fromParts = ['FROM patients p'];
  if (needsReferralJoin) {
    fromParts.push('LEFT JOIN patient_referral r ON r.patient_id = p.id');
  }
  if (needsTechnikJoin) {
    fromParts.push('LEFT JOIN patient_treatment_plans t ON t.patient_id = p.id');
  }
  if (needsSurgeonJoin) {
    fromParts.push(`JOIN users u ON u.email = $${paramIndex} AND r.beutalo_intezmeny = u.intezmeny AND u.intezmeny IS NOT NULL`);
    queryParams.push(userEmail);
    paramIndex++;
  }
  const fromClause = fromParts.join('\n       ');

  if (needsTechnikJoin) {
    whereConditions.push(`t.kezelesi_terv_arcot_erinto IS NOT NULL AND jsonb_array_length(t.kezelesi_terv_arcot_erinto) > 0`);
  }

  const selectFields = prefixedListFields;
  const orderBy = `p.${sortColumn}`;

  let countResult;
  let result;

  if (query) {
    const searchBase = `(p.nev ILIKE $${paramIndex} OR p.taj ILIKE $${paramIndex} OR p.telefonszam ILIKE $${paramIndex} OR p.email ILIKE $${paramIndex} OR r.beutalo_orvos ILIKE $${paramIndex} OR r.beutalo_intezmeny ILIKE $${paramIndex} OR p.kezeleoorvos ILIKE $${paramIndex})`;
    queryParams.push(`%${query}%`);
    paramIndex++;

    let viewCondition = '';
    if (view && VIEWS[view]) {
      const viewResult = VIEWS[view]('', queryParams, paramIndex, true);
      viewCondition = viewResult.whereClause;
      queryParams = viewResult.params;
      paramIndex = viewResult.paramIndex;
    }

    const allConditions = [
      searchBase,
      ...whereConditions,
      ...(viewCondition ? [viewCondition] : []),
    ].filter(Boolean);

    const searchCondition = allConditions.join(' AND ');

    countResult = await pool.query(
      `SELECT COUNT(*) as total ${fromClause} WHERE ${searchCondition}`,
      queryParams
    );

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
    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    countResult = await pool.query(
      `SELECT COUNT(*) as total ${fromClause} ${whereClause}`,
      queryParams
    );

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
  
  const p = validatedPatient;
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');

    const coreResult = await client.query(
      `INSERT INTO patients (${p.id ? 'id, ' : ''}nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos, iranyitoszam, kezeleoorvos, kezeleoorvos_intezete, felvetel_datuma, halal_datum, created_by)
       VALUES (${p.id ? '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15' : '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14'})
       RETURNING id`,
      p.id
        ? [p.id, p.nev||null, p.taj||null, p.telefonszam||null, p.szuletesiDatum||null, p.nem||null, p.email||null, p.cim||null, p.varos||null, p.iranyitoszam||null, p.kezeleoorvos||null, p.kezeleoorvosIntezete||null, p.felvetelDatuma||null, p.halalDatum||null, userEmail]
        : [p.nev||null, p.taj||null, p.telefonszam||null, p.szuletesiDatum||null, p.nem||null, p.email||null, p.cim||null, p.varos||null, p.iranyitoszam||null, p.kezeleoorvos||null, p.kezeleoorvosIntezete||null, p.felvetelDatuma||null, p.halalDatum||null, userEmail]
    );
    const newId = coreResult.rows[0].id;

    await Promise.all([
      client.query(
        `INSERT INTO patient_referral (patient_id, beutalo_orvos, beutalo_intezmeny, beutalo_indokolas, primer_mutet_leirasa, mutet_ideje, szovettani_diagnozis, nyaki_blokkdisszekcio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId, p.beutaloOrvos||null, p.beutaloIntezmeny||null, p.beutaloIndokolas||null, p.primerMutetLeirasa||null, p.mutetIdeje||null, p.szovettaniDiagnozis||null, p.nyakiBlokkdisszekcio||null]
      ),
      client.query(
        `INSERT INTO patient_anamnesis (patient_id, kezelesre_erkezes_indoka, alkoholfogyasztas, dohanyzas_szam, maxilladefektus_van, brown_fuggoleges_osztaly, brown_vizszintes_komponens, mandibuladefektus_van, kovacs_dobak_osztaly, nyelvmozgasok_akadalyozottak, gombocos_beszed, nyalmirigy_allapot, fabian_fejerdy_protetikai_osztaly, fabian_fejerdy_protetikai_osztaly_felso, fabian_fejerdy_protetikai_osztaly_also, radioterapia, radioterapia_dozis, radioterapia_datum_intervallum, chemoterapia, chemoterapia_leiras, tnm_staging, bno, diagnozis, baleset_idopont, baleset_etiologiaja, baleset_egyeb, veleszuletett_rendellenessegek, veleszuletett_mutetek_leirasa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28)`,
        [newId, p.kezelesreErkezesIndoka||null, p.alkoholfogyasztas||null, p.dohanyzasSzam||null, p.maxilladefektusVan||false, p.brownFuggolegesOsztaly||null, p.brownVizszintesKomponens||null, p.mandibuladefektusVan||false, p.kovacsDobakOsztaly||null, p.nyelvmozgásokAkadályozottak||false, p.gombocosBeszed||false, p.nyalmirigyAllapot||null, p.fabianFejerdyProtetikaiOsztaly||null, p.fabianFejerdyProtetikaiOsztalyFelso||null, p.fabianFejerdyProtetikaiOsztalyAlso||null, p.radioterapia||false, p.radioterapiaDozis||null, p.radioterapiaDatumIntervallum||null, p.chemoterapia||false, p.chemoterapiaLeiras||null, p.tnmStaging||null, p.bno||null, p.diagnozis||null, p.balesetIdopont||null, p.balesetEtiologiaja||null, p.balesetEgyeb||null, Array.isArray(p.veleszuletettRendellenessegek) ? JSON.stringify(p.veleszuletettRendellenessegek) : '[]', p.veleszuletettMutetekLeirasa||null]
      ),
      client.query(
        `INSERT INTO patient_dental_status (patient_id, meglevo_fogak, meglevo_implantatumok, nem_ismert_poziciokban_implantatum, nem_ismert_poziciokban_implantatum_reszletek, felso_fogpotlas_van, felso_fogpotlas_mikor, felso_fogpotlas_keszito, felso_fogpotlas_elegedett, felso_fogpotlas_problema, felso_fogpotlas_tipus, also_fogpotlas_van, also_fogpotlas_mikor, also_fogpotlas_keszito, also_fogpotlas_elegedett, also_fogpotlas_problema, also_fogpotlas_tipus)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [newId, p.meglevoFogak && typeof p.meglevoFogak === 'object' ? p.meglevoFogak : {}, p.meglevoImplantatumok && typeof p.meglevoImplantatumok === 'object' ? p.meglevoImplantatumok : {}, p.nemIsmertPoziciokbanImplantatum||false, p.nemIsmertPoziciokbanImplantatumRészletek||null, p.felsoFogpotlasVan||false, p.felsoFogpotlasMikor||null, p.felsoFogpotlasKeszito||null, p.felsoFogpotlasElegedett??true, p.felsoFogpotlasProblema||null, p.felsoFogpotlasTipus||null, p.alsoFogpotlasVan||false, p.alsoFogpotlasMikor||null, p.alsoFogpotlasKeszito||null, p.alsoFogpotlasElegedett??true, p.alsoFogpotlasProblema||null, p.alsoFogpotlasTipus||null]
      ),
      client.query(
        `INSERT INTO patient_treatment_plans (patient_id, kezelesi_terv_felso, kezelesi_terv_also, kezelesi_terv_arcot_erinto, kortorteneti_osszefoglalo, kezelesi_terv_melleklet, szakorvosi_velemeny)
         VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7)`,
        [newId, Array.isArray(p.kezelesiTervFelso) ? JSON.stringify(p.kezelesiTervFelso) : '[]', Array.isArray(p.kezelesiTervAlso) ? JSON.stringify(p.kezelesiTervAlso) : '[]', Array.isArray(p.kezelesiTervArcotErinto) ? JSON.stringify(p.kezelesiTervArcotErinto) : '[]', p.kortortenetiOsszefoglalo||null, p.kezelesiTervMelleklet||null, p.szakorvosiVelemény||null]
      ),
    ]);

    await client.query('COMMIT');

    result = await pool.query(
      `SELECT ${PATIENT_SELECT_FIELDS} FROM patients_full WHERE id = $1`,
      [newId]
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

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
