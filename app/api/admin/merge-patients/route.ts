import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { PoolClient } from 'pg';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ALL_CHILD_TABLES = [
  'appointments',
  'patient_documents',
  'patient_changes',
  'patient_snapshots',
  'patient_portal_tokens',
  'patient_stages',
  'patient_episodes',
  'stage_events',
  'patient_milestones',
  'messages',
  'communication_logs',
  'lab_quote_requests',
  'gdpr_consents',
  'tooth_treatments',
  'ohip14_responses',
  'ohip_reminder_log',
  'patient_intake_items',
  'intake_status_overrides',
  'implants',
] as const;

const ONETO_ONE_TABLES = [
  { table: 'patient_referral', columns: ['beutalo_orvos', 'beutalo_intezmeny', 'beutalo_indokolas', 'primer_mutet_leirasa', 'mutet_ideje', 'szovettani_diagnozis', 'nyaki_blokkdisszekcio'] },
  { table: 'patient_anamnesis', columns: ['kezelesre_erkezes_indoka', 'alkoholfogyasztas', 'dohanyzas_szam', 'radioterapia', 'chemoterapia', 'bno', 'diagnozis'] },
  { table: 'patient_dental_status', columns: ['meglevo_fogak', 'meglevo_implantatumok', 'felso_fogpotlas_jellege', 'also_fogpotlas_jellege'] },
  { table: 'patient_treatment_plans', columns: ['kezelesi_terv_felso', 'kezelesi_terv_also', 'kezelesi_terv_arcot_erinto', 'kortorteneti_osszefoglalo', 'kezelesi_terv_melleklet', 'szakorvosi_velemeny'] },
] as const;

async function tableHasColumn(client: PoolClient, table: string, column: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rows.length > 0;
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return r.rows.length > 0;
}

/**
 * Reassign rows from secondary to primary. If a unique constraint violation
 * occurs, delete the conflicting secondary rows (keeping primary's) and retry.
 */
async function safeReassign(client: PoolClient, table: string, primaryId: string, secondaryId: string): Promise<void> {
  if (!(await tableExists(client, table))) return;
  if (!(await tableHasColumn(client, table, 'patient_id'))) return;

  const sp = `sp_${table}_${Date.now()}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await client.query(
      `UPDATE ${table} SET patient_id = $1 WHERE patient_id = $2`,
      [primaryId, secondaryId],
    );
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (err: any) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    if (err?.code === '23505') {
      logger.warn(`[merge] Unique conflict in ${table}, removing secondary duplicates and retrying`);
      await client.query(`DELETE FROM ${table} WHERE patient_id = $1`, [secondaryId]);
    } else {
      throw err;
    }
  }
}

async function mergeOneToOneTable(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  primaryId: string,
  secondaryId: string,
): Promise<void> {
  if (!(await tableExists(client, table))) return;

  const primaryRow = await client.query(
    `SELECT * FROM ${table} WHERE patient_id = $1`,
    [primaryId],
  );
  const secondaryRow = await client.query(
    `SELECT * FROM ${table} WHERE patient_id = $1`,
    [secondaryId],
  );

  if (secondaryRow.rows.length === 0) return;
  if (primaryRow.rows.length === 0) {
    await client.query(
      `UPDATE ${table} SET patient_id = $1 WHERE patient_id = $2`,
      [primaryId, secondaryId],
    );
    return;
  }

  const primary = primaryRow.rows[0];
  const secondary = secondaryRow.rows[0];
  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const col of columns) {
    if (!(col in primary)) continue;
    const pVal = primary[col];
    const sVal = secondary[col];
    const pEmpty = pVal === null || pVal === undefined || pVal === '' ||
      (Array.isArray(pVal) && pVal.length === 0) ||
      (typeof pVal === 'object' && pVal !== null && !Array.isArray(pVal) && Object.keys(pVal).length === 0);

    if (pEmpty && sVal !== null && sVal !== undefined && sVal !== '') {
      updates.push(`${col} = $${idx}`);
      values.push(sVal);
      idx++;
    }
  }

  if (updates.length > 0) {
    values.push(primaryId);
    await client.query(
      `UPDATE ${table} SET ${updates.join(', ')} WHERE patient_id = $${idx}`,
      values,
    );
  }

  await client.query(`DELETE FROM ${table} WHERE patient_id = $1`, [secondaryId]);
}

async function updateDoctorMessageMentions(
  client: PoolClient,
  primaryId: string,
  secondaryId: string,
): Promise<void> {
  try {
    await client.query(
      `UPDATE doctor_messages
       SET mentioned_patient_ids = (
         SELECT jsonb_agg(
           CASE WHEN elem::text = $2::text THEN to_jsonb($1::text) ELSE elem END
         )
         FROM jsonb_array_elements(mentioned_patient_ids) AS elem
       )
       WHERE mentioned_patient_ids @> $2::jsonb`,
      [primaryId, JSON.stringify(secondaryId)],
    );
  } catch {
    // table or column might not exist
  }
}

async function mergeSecondaryIntoPrimary(
  client: PoolClient,
  primaryPatientId: string,
  secondaryPatientId: string,
  auth: { email: string },
): Promise<{ secondaryName: string; secondaryTaj: string }> {
  const secondaryInfo = await client.query(
    'SELECT nev, taj FROM patients WHERE id = $1',
    [secondaryPatientId],
  );
  const secondaryName = secondaryInfo.rows[0]?.nev || 'Ismeretlen';
  const secondaryTaj = secondaryInfo.rows[0]?.taj || '';

  const primaryFull = await client.query('SELECT * FROM patients WHERE id = $1', [primaryPatientId]);
  const secondaryFull = await client.query('SELECT * FROM patients WHERE id = $1', [secondaryPatientId]);
  const pRow = primaryFull.rows[0];
  const sRow = secondaryFull.rows[0];

  // --- 1. Fill empty core fields from secondary ---
  const coreCols = [
    'taj', 'telefonszam', 'szuletesi_datum', 'nem', 'email', 'cim', 'varos',
    'iranyitoszam', 'kezeleoorvos', 'kezeleoorvos_intezete', 'felvetel_datuma',
  ];
  const coreUpdates: string[] = [];
  const coreValues: any[] = [];
  let coreIdx = 1;

  for (const col of coreCols) {
    const pVal = pRow[col];
    const sVal = sRow[col];
    if ((pVal === null || pVal === undefined || pVal === '') && sVal !== null && sVal !== undefined && sVal !== '') {
      coreUpdates.push(`${col} = $${coreIdx}`);
      coreValues.push(sVal);
      coreIdx++;
    }
  }

  if (coreUpdates.length > 0) {
    coreValues.push(primaryPatientId, auth.email);
    await client.query(
      `UPDATE patients SET ${coreUpdates.join(', ')}, updated_at = NOW(), updated_by = $${coreIdx + 1} WHERE id = $${coreIdx}`,
      coreValues,
    );
  }

  // --- 2. Merge 1:1 child tables ---
  for (const { table, columns } of ONETO_ONE_TABLES) {
    await mergeOneToOneTable(client, table, columns, primaryPatientId, secondaryPatientId);
  }

  // --- 3. Reassign all child tables (with conflict handling) ---
  for (const table of ALL_CHILD_TABLES) {
    await safeReassign(client, table, primaryPatientId, secondaryPatientId);
  }

  // --- 4. Doctor message mentions (JSONB) ---
  await updateDoctorMessageMentions(client, primaryPatientId, secondaryPatientId);

  // --- 5. Delete secondary patient (CASCADE handles any remaining FK refs) ---
  await client.query('DELETE FROM patients WHERE id = $1', [secondaryPatientId]);

  // --- 6. Audit log ---
  const spAudit = `sp_audit_${Date.now()}`;
  await client.query(`SAVEPOINT ${spAudit}`);
  try {
    await client.query(
      `INSERT INTO patient_changes (patient_id, field_name, field_display_name, old_value, new_value, changed_by, changed_at)
       VALUES ($1, 'merge', 'Profil összevonás', $2, $3, $4, NOW())`,
      [primaryPatientId, `Összevonva: ${secondaryName} (${secondaryTaj || 'TAJ nélkül'})`, `Elsődleges: ${pRow.nev}`, auth.email],
    );
    await client.query(`RELEASE SAVEPOINT ${spAudit}`);
  } catch (auditErr) {
    await client.query(`ROLLBACK TO SAVEPOINT ${spAudit}`);
    logger.warn('[merge] Failed to insert audit log:', auditErr);
  }

  return { secondaryName, secondaryTaj };
}

export const POST = roleHandler(['admin'], async (req, { auth, correlationId }) => {
  const body = await req.json();
  const { primaryPatientId } = body;

  let secondaryIds: string[] = [];
  if (body.secondaryPatientIds && Array.isArray(body.secondaryPatientIds)) {
    secondaryIds = body.secondaryPatientIds;
  } else if (body.secondaryPatientId) {
    secondaryIds = [body.secondaryPatientId];
  }

  if (!primaryPatientId || secondaryIds.length === 0) {
    return NextResponse.json(
      { error: 'primaryPatientId és legalább egy secondaryPatientId megadása kötelező' },
      { status: 400 },
    );
  }

  if (secondaryIds.includes(primaryPatientId)) {
    return NextResponse.json(
      { error: 'Nem lehet ugyanazt a pácienst önmagával összevonni' },
      { status: 400 },
    );
  }

  const uniqueIds = Array.from(new Set(secondaryIds));

  const pool = getDbPool();

  const primaryResult = await pool.query('SELECT id, nev, taj FROM patients WHERE id = $1', [primaryPatientId]);
  if (primaryResult.rows.length === 0) {
    return NextResponse.json({ error: 'Elsődleges páciens nem található' }, { status: 404 });
  }

  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(', ');
  const secondaryResult = await pool.query(
    `SELECT id, nev, taj FROM patients WHERE id IN (${placeholders})`,
    uniqueIds,
  );
  if (secondaryResult.rows.length !== uniqueIds.length) {
    const found = new Set(secondaryResult.rows.map((r: any) => r.id));
    const missing = uniqueIds.filter(id => !found.has(id));
    return NextResponse.json(
      { error: `Másodlagos páciens(ek) nem található(k): ${missing.join(', ')}` },
      { status: 404 },
    );
  }

  const primary = primaryResult.rows[0];
  const mergedNames: string[] = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const secId of uniqueIds) {
      const result = await mergeSecondaryIntoPrimary(client, primaryPatientId, secId, auth);
      mergedNames.push(result.secondaryName);
    }

    await client.query('COMMIT');

    const nameList = mergedNames.map(n => `"${n}"`).join(', ');
    return NextResponse.json({
      success: true,
      message: `Sikeresen összevonva ${uniqueIds.length} páciens → "${primary.nev}": ${nameList}`,
      primaryPatientId,
      deletedPatientIds: uniqueIds,
      mergedCount: uniqueIds.length,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('[merge] Transaction failed:', {
      error: error?.message,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      table: error?.table,
    });
    const detail = error?.detail || error?.message || '';
    const constraint = error?.constraint || '';
    return NextResponse.json({
      error: `Összevonás sikertelen: ${error?.message || 'Ismeretlen hiba'}`,
      _errorMeta: { code: error?.code, detail, constraint, table: error?.table },
    }, { status: 500 });
  } finally {
    client.release();
  }
});
