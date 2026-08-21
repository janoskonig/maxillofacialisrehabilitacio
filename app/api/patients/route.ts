import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { normalizeToTreatmentTypeCode } from '@/lib/treatment-type-normalize';
import { Patient, patientSchema } from '@/lib/types';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { authedHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { PATIENT_LIST_FIELDS, PATIENT_SELECT_FIELDS } from '@/lib/queries/patient-fields';
import { REQUIRED_DOC_TAGS } from '@/lib/clinical-rules';
import { getPatientCompletenessRow } from '@/lib/patient-data-completeness';
import { recomputeReferrerUserIdSilent } from '@/lib/recompute-referrer';
import { recomputeDerivedNumericsSilent } from '@/lib/derived-numerics';
import { getPlausibilityWarnings } from '@/lib/data-plausibility';
import { markConsentPending } from '@/lib/research-registry/research-consent-service';
import { triggerConsentRequest } from '@/lib/consent-reminders';
import { requiresGuardian } from '@/lib/legal/legal-capacity';
import { applyKezeleoorvosFromForm } from '@/lib/kezeleoorvos-assignment';
import { openIntakeEpisode } from '@/lib/patient-intake-episode';
import {
  isPatientAdditionalFilter,
  isPatientQuickView,
  isPatientScope,
  type PatientAdditionalFilter,
  type PatientFilterCounts,
  type PatientQuickView,
} from '@/lib/patient-list-filters';

type ViewPreset = 'neak_pending' | 'missing_docs';

const requiredDocTagsSql = REQUIRED_DOC_TAGS
  .map((tag) => `'${tag.toLowerCase().replace(/'/g, "''")}'`)
  .join(', ');

/** A lista gyorsszűrőinek közös SQL-predikátumai. */
const HAS_OPEN_EPISODE_SQL = `EXISTS (
  SELECT 1 FROM patient_episodes pe
  WHERE pe.patient_id = p.id AND pe.status = 'open'
)`;

const HAS_FUTURE_APPOINTMENT_SQL = `EXISTS (
  SELECT 1
  FROM appointments apt
  JOIN available_time_slots ats ON ats.id = apt.time_slot_id
  WHERE apt.patient_id = p.id
    AND ats.start_time >= NOW()
    AND (apt.appointment_status IS NULL OR apt.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
    AND (apt.approval_status IS NULL OR apt.approval_status <> 'rejected')
)`;

const MISSING_REQUIRED_DOCUMENT_SQL = `NOT EXISTS (
  SELECT 1
  FROM patient_documents pd
  WHERE pd.patient_id = p.id
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(pd.tags, '[]'::jsonb)) AS tag_elem
      WHERE LOWER(tag_elem) IN (${requiredDocTagsSql})
    )
)`;

// A főoldali operatív „Hiányzó adat” a klinikai minimumot jelenti. A teljes,
// feltételes kutatási teljesség továbbra is az admin adatminőségi riport feladata.
const MISSING_CLINICAL_DATA_SQL = `(
  NULLIF(BTRIM(p.nev), '') IS NULL
  OR NULLIF(BTRIM(p.nem), '') IS NULL
  OR p.szuletesi_datum IS NULL
  OR NULLIF(BTRIM(p.taj), '') IS NULL
  OR NULLIF(BTRIM(p.email), '') IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM patient_anamnesis pa
    WHERE pa.patient_id = p.id
      AND NULLIF(BTRIM(pa.kezelesre_erkezes_indoka), '') IS NOT NULL
      AND NULLIF(BTRIM(pa.diagnozis), '') IS NOT NULL
  )
  OR NOT EXISTS (
    SELECT 1 FROM patient_dental_status pds
    WHERE pds.patient_id = p.id
      AND pds.meglevo_fogak IS NOT NULL
      AND pds.meglevo_fogak <> '{}'::jsonb
  )
  OR ${MISSING_REQUIRED_DOCUMENT_SQL}
)`;

const NO_NEXT_APPOINTMENT_SQL = `(${HAS_OPEN_EPISODE_SQL} AND NOT ${HAS_FUTURE_APPOINTMENT_SQL})`;
const STALE_STAGE_SQL = `(
  current_stage.stage_code IS NOT NULL
  AND current_stage.stage_code <> 'STAGE_7'
  AND current_stage.stage_at < NOW() - INTERVAL '60 days'
)`;
const ACTION_REQUIRED_SQL = `(
  ${MISSING_CLINICAL_DATA_SQL}
  OR ${NO_NEXT_APPOINTMENT_SQL}
  OR ${STALE_STAGE_SQL}
  OR p.kezeleoorvos_user_id IS NULL
)`;

const NEXT_CONSILIUM_SQL = `EXISTS (
  SELECT 1
  FROM consilium_session_items csi
  WHERE csi.patient_id = p.id
    AND csi.session_id = (
      SELECT cs.id
      FROM consilium_sessions cs
      WHERE btrim(coalesce(cs.institution_id, '')) = btrim(coalesce(filter_user.intezmeny, ''))
        AND cs.status = 'draft'
        AND cs.scheduled_at >= NOW()
      ORDER BY cs.scheduled_at ASC
      LIMIT 1
    )
)`;

const QUICK_VIEW_SQL: Record<Exclude<PatientQuickView, 'all'>, string> = {
  consult: `current_stage.stage_code = 'STAGE_0'`,
  preparatory: `current_stage.stage_code IN ('STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4')`,
  prosthetic: `current_stage.stage_code = 'STAGE_5'`,
  followup: `current_stage.stage_code IN ('STAGE_6', 'STAGE_7')`,
  action_required: ACTION_REQUIRED_SQL,
};

const ADDITIONAL_FILTER_SQL: Record<PatientAdditionalFilter, string> = {
  no_next_appointment: NO_NEXT_APPOINTMENT_SQL,
  next_consilium: NEXT_CONSILIUM_SQL,
  missing_data: MISSING_CLINICAL_DATA_SQL,
  missing_docs: MISSING_REQUIRED_DOCUMENT_SQL,
  stale_stage: STALE_STAGE_SQL,
  no_doctor: `p.kezeleoorvos_user_id IS NULL`,
  no_active_episode: `NOT ${HAS_OPEN_EPISODE_SQL}`,
};


export const dynamic = 'force-dynamic';

// Requires a valid session: this returns the full patient roster (név, TAJ, phone,
// email). middleware.ts does not block unauthenticated requests, so the handler must.
export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const searchParams = req.nextUrl.searchParams;
  const query = searchParams.get('q');
  const forMention = searchParams.get('forMention') === 'true';
  const view = searchParams.get('view') as ViewPreset | null;
  const requestedScope = searchParams.get('scope');
  const requestedQuickView = searchParams.get('phase');
  const requestedFilters = (searchParams.get('filters') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(isPatientAdditionalFilter);
  const includeFilterCounts = !forMention && searchParams.get('includeFilterCounts') === 'true';
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const limit = forMention ? undefined : (limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10)), 500) : undefined);
  const offset = forMention ? undefined : (offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : undefined);

  const sortParam = searchParams.get('sort');
  const directionParam = searchParams.get('direction');
  const ALLOWED_SORT_COLUMNS: Record<string, string> = { nev: 'nev', createdAt: 'created_at', kezeleoorvos: 'kezeleoorvos' };
  const sortColumn = (sortParam && ALLOWED_SORT_COLUMNS[sortParam]) || 'created_at';
  const sortDir = directionParam === 'asc' ? 'ASC' : 'DESC';
  // Kezelőorvos szerinti rendezésnél a kijelöletlen (NULL) betegek mindig a
  // lista végére kerüljenek, iránytól függetlenül.
  const nullsClause = sortColumn === 'kezeleoorvos' ? ' NULLS LAST' : '';

  const role = auth.role;
  const userEmail = auth.email;
  const canUseOwnScope = role === 'admin' || role === 'fogpótlástanász';
  const scope = isPatientScope(requestedScope) && requestedScope === 'mine' && canUseOwnScope
    ? 'mine'
    : 'all';
  const quickView: PatientQuickView = isPatientQuickView(requestedQuickView)
    ? requestedQuickView
    : 'all';
  const additionalFilters = Array.from(new Set(requestedFilters)).filter(
    (filter) => filter !== 'no_doctor' || role === 'admin',
  );
  // Régi megosztott URL-ek kompatibilitása.
  if (view === 'missing_docs' && !additionalFilters.includes('missing_docs')) {
    additionalFilters.push('missing_docs');
  }

  const baseConditions: string[] = [];
  // $1 minden listalekérdezésben a bejelentkezett user. A filter_user join
  // biztosítja az intézményhelyes „következő konzílium” meghatározását is.
  const baseParams: unknown[] = [auth.userId];

  // When forMention=true and query is in mention format (contains +),
  // skip SQL ILIKE (which can't match accented names with spaces) and
  // filter by normalized mentionFormat in JS instead
  const isMentionFormatQuery = forMention && query && query.includes('+');
  const sqlQuery = isMentionFormatQuery ? null : query;

  const needsReferralJoin = !!sqlQuery;

  const prefixedListFields = PATIENT_LIST_FIELDS.split(',').map(f => {
    const trimmed = f.trim();
    if (!trimmed) return '';
    if (trimmed.includes(' as ')) {
      const parts = trimmed.split(' as ');
      return `p.${parts[0].trim()} as ${parts[1].trim()}`;
    }
    return `p.${trimmed}`;
  }).filter(Boolean).join(', ');

  // A latest-stage LATERAL join ugyanazt a stádiumot adja, mint a beteglista
  // enrichmentje; a szűrés így még a lapozás előtt, adatbázisban történik.
  const fromParts = [
    'FROM patients p',
    'JOIN users filter_user ON filter_user.id = $1::uuid',
    `LEFT JOIN LATERAL (
       SELECT se.stage_code, se.at AS stage_at
       FROM stage_events se
       WHERE se.patient_id = p.id
       ORDER BY se.at DESC, se.created_at DESC
       LIMIT 1
     ) current_stage ON true`,
  ];
  if (needsReferralJoin) {
    fromParts.push('LEFT JOIN patient_referral r ON r.patient_id = p.id');
  }
  const fromClause = fromParts.join('\n       ');

  const selectFields = prefixedListFields;
  const orderBy = `p.${sortColumn}`;

  if (sqlQuery) {
    baseParams.push(`%${sqlQuery}%`);
    const searchParam = `$${baseParams.length}`;
    baseConditions.push(
      `(p.nev ILIKE ${searchParam} OR p.taj ILIKE ${searchParam} OR p.telefonszam ILIKE ${searchParam} OR p.email ILIKE ${searchParam} OR r.beutalo_orvos ILIKE ${searchParam} OR r.beutalo_intezmeny ILIKE ${searchParam} OR p.kezeleoorvos ILIKE ${searchParam})`,
    );
  }

  const scopedConditions = [...baseConditions];
  const scopedParams = [...baseParams];
  if (scope === 'mine') {
    scopedConditions.push('p.kezeleoorvos_user_id = $1::uuid');
  }

  const selectedConditions = [...scopedConditions];
  if (quickView !== 'all') selectedConditions.push(QUICK_VIEW_SQL[quickView]);
  selectedConditions.push(...additionalFilters.map((filter) => ADDITIONAL_FILTER_SQL[filter]));

  if (view === 'neak_pending') {
    selectedConditions.push(`EXISTS (
      SELECT 1 FROM patient_documents pd_neak
      WHERE pd_neak.patient_id = p.id
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(pd_neak.tags, '[]'::jsonb)) AS tag_elem
          WHERE LOWER(tag_elem) = 'neak'
        )
    )`);
    selectedConditions.push(MISSING_REQUIRED_DOCUMENT_SQL);
  }

  const selectedWhere = selectedConditions.length > 0
    ? `WHERE ${selectedConditions.join(' AND ')}`
    : '';
  const baseWhere = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : '';
  const scopedWhere = scopedConditions.length > 0 ? `WHERE ${scopedConditions.join(' AND ')}` : '';

  let dataQueryParams = [...scopedParams];
  let limitOffset = '';
  if (limit !== undefined && offset !== undefined) {
    dataQueryParams = [...dataQueryParams, limit, offset];
    limitOffset = ` LIMIT $${dataQueryParams.length - 1} OFFSET $${dataQueryParams.length}`;
  } else if (limit !== undefined) {
    dataQueryParams.push(limit);
    limitOffset = ` LIMIT $${dataQueryParams.length}`;
  }

  const resultPromise = pool.query(
    `SELECT ${selectFields}
     ${fromClause}
     ${selectedWhere}
     ORDER BY ${orderBy} ${sortDir}${nullsClause}${limitOffset}`,
    dataQueryParams,
  );
  const totalPromise = pool.query(
    `SELECT COUNT(*)::int AS total ${fromClause} ${selectedWhere}`,
    scopedParams,
  );

  const scopeCountParams = [...baseParams];
  const scopeCountsPromise = includeFilterCounts
    ? pool.query(
        `SELECT
           COUNT(*)::int AS "all",
           COUNT(*) FILTER (WHERE p.kezeleoorvos_user_id = $1::uuid)::int AS mine
         ${fromClause}
         ${baseWhere}`,
        scopeCountParams,
      )
    : Promise.resolve(null);

  const noDoctorCountSql = role === 'admin'
    ? `COUNT(*) FILTER (WHERE ${ADDITIONAL_FILTER_SQL.no_doctor})::int`
    : '0::int';
  const filterCountsPromise = includeFilterCounts
    ? pool.query(
        `SELECT
           COUNT(*)::int AS "all",
           COUNT(*) FILTER (WHERE ${QUICK_VIEW_SQL.consult})::int AS consult,
           COUNT(*) FILTER (WHERE ${QUICK_VIEW_SQL.preparatory})::int AS preparatory,
           COUNT(*) FILTER (WHERE ${QUICK_VIEW_SQL.prosthetic})::int AS prosthetic,
           COUNT(*) FILTER (WHERE ${QUICK_VIEW_SQL.followup})::int AS followup,
           COUNT(*) FILTER (WHERE ${QUICK_VIEW_SQL.action_required})::int AS "actionRequired",
           COUNT(*) FILTER (WHERE ${ADDITIONAL_FILTER_SQL.no_next_appointment})::int AS "noNextAppointment",
           COUNT(*) FILTER (WHERE ${ADDITIONAL_FILTER_SQL.next_consilium})::int AS "nextConsilium",
           COUNT(*) FILTER (WHERE ${ADDITIONAL_FILTER_SQL.missing_data})::int AS "missingData",
           COUNT(*) FILTER (WHERE ${ADDITIONAL_FILTER_SQL.missing_docs})::int AS "missingDocs",
           COUNT(*) FILTER (WHERE ${ADDITIONAL_FILTER_SQL.stale_stage})::int AS "staleStage",
           ${noDoctorCountSql} AS "noDoctor",
           COUNT(*) FILTER (WHERE ${ADDITIONAL_FILTER_SQL.no_active_episode})::int AS "noActiveEpisode"
         ${fromClause}
         ${scopedWhere}`,
        scopedParams,
      )
    : Promise.resolve(null);

  const [result, countResult, scopeCountsResult, filterCountsResult] = await Promise.all([
    resultPromise,
    totalPromise,
    scopeCountsPromise,
    filterCountsPromise,
  ]);
  
  const total = Number(countResult.rows[0]?.total ?? 0);

  if (!forMention) {
    const searchQuery = req.nextUrl.searchParams.get('q');
    const action = searchQuery ? 'patient_search' : 'patients_list_viewed';
    // total = COUNT(*) (szűréssel); result.rows.length max. oldalméret (pagináció) — ne keverjük össze
    const detail = searchQuery
      ? `Search query: "${searchQuery}", Total matches: ${total}, Page rows: ${result.rows.length}`
      : `Total patients: ${total}`;
    
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

  let patients = result.rows;

  if (role === 'technikus') {
    const TECHNIKUS_ALLOWED_FIELDS = new Set(['id', 'nev', 'kezeleoorvos', 'kezeleoorvosIntezete', 'createdAt', 'updatedAt']);
    patients = patients.map((p: any) => {
      const masked = { ...p };
      for (const key of Object.keys(masked)) {
        if (!TECHNIKUS_ALLOWED_FIELDS.has(key)) {
          masked[key] = null;
        }
      }
      return masked;
    });
  }

  let filterCounts: PatientFilterCounts | undefined;
  if (scopeCountsResult && filterCountsResult) {
    const scopeRow = scopeCountsResult.rows[0] ?? {};
    const row = filterCountsResult.rows[0] ?? {};
    filterCounts = {
      scopes: { all: Number(scopeRow.all ?? 0), mine: Number(scopeRow.mine ?? 0) },
      quickViews: {
        all: Number(row.all ?? 0),
        consult: Number(row.consult ?? 0),
        preparatory: Number(row.preparatory ?? 0),
        prosthetic: Number(row.prosthetic ?? 0),
        followup: Number(row.followup ?? 0),
        action_required: Number(row.actionRequired ?? 0),
      },
      additional: {
        no_next_appointment: Number(row.noNextAppointment ?? 0),
        next_consilium: Number(row.nextConsilium ?? 0),
        missing_data: Number(row.missingData ?? 0),
        missing_docs: Number(row.missingDocs ?? 0),
        stale_stage: Number(row.staleStage ?? 0),
        no_doctor: Number(row.noDoctor ?? 0),
        no_active_episode: Number(row.noActiveEpisode ?? 0),
      },
    };
  }

  return NextResponse.json({ 
    patients,
    total,
    filterCounts,
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
  
  if (role === 'beutalo_orvos' && !validatedPatient.beutaloOrvos) {
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

  // Minors require a legal guardian (törvényes képviselő) for declarations.
  if (requiresGuardian(p.szuletesiDatum) && !p.torvenyesKepviseloNev?.trim()) {
    return NextResponse.json(
      { error: 'Kiskorú páciens esetén a törvényes képviselő nevének megadása kötelező.' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');

    const coreResult = await client.query(
      `INSERT INTO patients (${p.id ? 'id, ' : ''}nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos, iranyitoszam, kezeleoorvos, kezeleoorvos_intezete, felvetel_datuma, halal_datum, torvenyes_kepviselo_nev, torvenyes_kepviselo_kapcsolat, torvenyes_kepviselo_email, created_by)
       VALUES (${p.id ? '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18' : '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17'})
       RETURNING id`,
      p.id
        ? [p.id, p.nev||null, p.taj||null, p.telefonszam||null, p.szuletesiDatum||null, p.nem||null, p.email||null, p.cim||null, p.varos||null, p.iranyitoszam||null, p.kezeleoorvos||null, p.kezeleoorvosIntezete||null, p.felvetelDatuma||null, p.halalDatum||null, p.torvenyesKepviseloNev||null, p.torvenyesKepviseloKapcsolat||null, p.torvenyesKepviseloEmail||null, userEmail]
        : [p.nev||null, p.taj||null, p.telefonszam||null, p.szuletesiDatum||null, p.nem||null, p.email||null, p.cim||null, p.varos||null, p.iranyitoszam||null, p.kezeleoorvos||null, p.kezeleoorvosIntezete||null, p.felvetelDatuma||null, p.halalDatum||null, p.torvenyesKepviseloNev||null, p.torvenyesKepviseloKapcsolat||null, p.torvenyesKepviseloEmail||null, userEmail]
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
        [newId, p.kezelesreErkezesIndoka||null, p.alkoholfogyasztas||null, p.dohanyzasSzam||null, p.maxilladefektusVan??null, p.brownFuggolegesOsztaly||null, p.brownVizszintesKomponens||null, p.mandibuladefektusVan??null, p.kovacsDobakOsztaly||null, p.nyelvmozgásokAkadályozottak??null, p.gombocosBeszed??null, p.nyalmirigyAllapot||null, p.fabianFejerdyProtetikaiOsztaly||null, p.fabianFejerdyProtetikaiOsztalyFelso||null, p.fabianFejerdyProtetikaiOsztalyAlso||null, p.radioterapia||false, p.radioterapiaDozis||null, p.radioterapiaDatumIntervallum||null, p.chemoterapia||false, p.chemoterapiaLeiras||null, p.tnmStaging||null, p.bno||null, p.diagnozis||null, p.balesetIdopont||null, p.balesetEtiologiaja||null, p.balesetEgyeb||null, Array.isArray(p.veleszuletettRendellenessegek) ? JSON.stringify(p.veleszuletettRendellenessegek) : '[]', p.veleszuletettMutetekLeirasa||null]
      ),
      client.query(
        `INSERT INTO patient_dental_status (patient_id, meglevo_fogak, meglevo_implantatumok, nem_ismert_poziciokban_implantatum, nem_ismert_poziciokban_implantatum_reszletek, felso_fogpotlas_van, felso_fogpotlas_mikor, felso_fogpotlas_keszito, felso_fogpotlas_elegedett, felso_fogpotlas_problema, felso_fogpotlas_tipus, also_fogpotlas_van, also_fogpotlas_mikor, also_fogpotlas_keszito, also_fogpotlas_elegedett, also_fogpotlas_problema, also_fogpotlas_tipus)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [newId, p.meglevoFogak && typeof p.meglevoFogak === 'object' ? p.meglevoFogak : {}, p.meglevoImplantatumok && typeof p.meglevoImplantatumok === 'object' ? p.meglevoImplantatumok : {}, p.nemIsmertPoziciokbanImplantatum||false, p.nemIsmertPoziciokbanImplantatumRészletek||null, p.felsoFogpotlasVan??null, p.felsoFogpotlasMikor||null, p.felsoFogpotlasKeszito||null, p.felsoFogpotlasElegedett??null, p.felsoFogpotlasProblema||null, p.felsoFogpotlasTipus||null, p.alsoFogpotlasVan??null, p.alsoFogpotlasMikor||null, p.alsoFogpotlasKeszito||null, p.alsoFogpotlasElegedett??null, p.alsoFogpotlasProblema||null, p.alsoFogpotlasTipus||null]
      ),
      client.query(
        `INSERT INTO patient_treatment_plans (patient_id, kezelesi_terv_felso, kezelesi_terv_also, kezelesi_terv_arcot_erinto, kortorteneti_osszefoglalo, kezelesi_terv_melleklet, szakorvosi_velemeny)
         VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7)`,
        [newId, Array.isArray(p.kezelesiTervFelso) ? JSON.stringify(p.kezelesiTervFelso) : '[]', Array.isArray(p.kezelesiTervAlso) ? JSON.stringify(p.kezelesiTervAlso) : '[]', Array.isArray(p.kezelesiTervArcotErinto) ? JSON.stringify(p.kezelesiTervArcotErinto) : '[]', p.kortortenetiOsszefoglalo||null, p.kezelesiTervMelleklet||null, p.szakorvosiVelemény||null]
      ),
    ]);

    await client.query('COMMIT');

    // Kezelőorvos: a form a nevet küldi → feloldjuk user_id-ra és KÉZI
    // (ragadós) hozzárendelést rögzítünk, amit a recompute nem ír felül.
    // Ha a név nem oldható fel ismert orvosra, a fenti INSERT szabad szövege
    // marad, és a recompute továbbra is seedelhet (assigned_at NULL).
    try {
      const assign = await applyKezeleoorvosFromForm(newId, p.kezeleoorvos, auth.userId, pool);
      if (!assign.resolved) {
        logger.warn(`Kezelőorvos név nem feloldható ismert orvosra (beteg ${newId}): "${p.kezeleoorvos}"`);
      }
    } catch (assignErr) {
      logger.error('Kezelőorvos hozzárendelés sikertelen (create):', assignErr);
    }

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

  // Új beteg → azonnal nyíljon ellátási epizód a beutaló adataiból, STAGE_0
  // („Első konzultációra vár") stádiummal, hogy a beteg ne maradjon epizód
  // nélkül a pipeline-on. A gyors felvétel űrlapon a beutaló-mezők még üresek
  // lehetnek — azokat a későbbi mentés (PUT) pótolja az epizódra is
  // (lib/patient-intake-episode.ts). Az epizód hibája ne buktassa el a beteg
  // felvételét: logolunk és megyünk tovább.
  let episode = null;
  try {
    if (validatedPatient.halalDatum) {
      logger.info(`Elhunyt beteghez automatikus epizód nem nyílik: ${result.rows[0].id}`);
    } else {
      episode = await openIntakeEpisode(pool, {
        patientId: result.rows[0].id as string,
        createdBy: userEmail,
        source: validatedPatient,
      });
      if (episode) {
        await logActivity(
          req,
          userEmail,
          'patient_episode_created',
          JSON.stringify({
            patientId: result.rows[0].id,
            episodeId: episode.id,
            reason: episode.reason,
            auto: true,
          })
        );
      }
    }
  } catch (episodeErr) {
    logger.error('Automatikus epizódnyitás sikertelen (create):', episodeErr);
  }

  // Beutaló orvos szöveges név → user_id FK (statisztika + emlékeztető-célzás).
  recomputeReferrerUserIdSilent(result.rows[0].id as string);

  // Szabad szöveges numerikus mezők → származtatott numerikus oszlopok.
  recomputeDerivedNumericsSilent(result.rows[0].id as string);

  // Beleegyezési felszólítás: a személyzet által felvett páciensnél sem GDPR,
  // sem kutatási hozzájárulás nincs rögzítve — kérjük, hogy nyilatkozzon.
  // Nem blokkol; hiba esetén a napi cron úgyis újrapróbálja.
  const createdPatient = result.rows[0];
  if (createdPatient.email) {
    try {
      await markConsentPending(
        createdPatient.id as string,
        { email: userEmail },
        'Regisztrációs felszólítás'
      );
    } catch (consentErr) {
      logger.error('Failed to mark consent pending:', consentErr);
    }
    await triggerConsentRequest(
      {
        id: createdPatient.id as string,
        email: createdPatient.email as string,
        nev: (createdPatient.nev as string) ?? null,
        nem: (createdPatient.nem as string) ?? null,
      },
      { needsNoticeAck: true, needsResearch: true }
    );
  }

  // Tanácsadó adat-teljességi visszajelzés (nem blokkol) — a kliens mentés
  // után jelezheti a hiányokat. Hiba esetén csendben kihagyjuk.
  let dataQuality = null;
  try {
    const row = await getPatientCompletenessRow(result.rows[0].id as string);
    const warnings = getPlausibilityWarnings({
      taj: validatedPatient.taj,
      szuletesiDatum: validatedPatient.szuletesiDatum,
      halalDatum: validatedPatient.halalDatum,
    });
    if (row) {
      dataQuality = {
        completenessScore: row.completenessScore,
        researchReady: row.researchReady,
        clinicalMissing: row.clinicalMissing,
        researchMissing: row.researchMissing,
        warnings,
      };
    }
  } catch (qualityError) {
    logger.error('Failed to compute data quality:', qualityError);
  }

  return NextResponse.json({ patient: result.rows[0], dataQuality, episode }, { status: 201 });
});
