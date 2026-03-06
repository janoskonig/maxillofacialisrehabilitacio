import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { PoolClient } from 'pg';

export const dynamic = 'force-dynamic';

const SIMPLE_REASSIGN_TABLES = [
  'patient_documents',
  'patient_changes',
  'patient_snapshots',
  'patient_portal_tokens',
  'patient_milestones',
  'messages',
  'communication_logs',
  'lab_quote_requests',
  'gdpr_consents',
  'ohip_reminder_log',
  'intake_status_overrides',
] as const;

const ONETO_ONE_TABLES = [
  { table: 'patient_referral', columns: ['beutalo_orvos', 'beutalo_intezmeny', 'beutalo_indokolas', 'primer_mutet_leirasa', 'mutet_ideje', 'szovettani_diagnozis', 'nyaki_blokkdisszekcio'] },
  { table: 'patient_anamnesis', columns: ['kezelesre_erkezes_indoka', 'alkoholfogyasztas', 'dohanyzas_szam', 'radioterapia', 'chemoterapia', 'bno', 'diagnozis'] },
  { table: 'patient_dental_status', columns: ['meglevo_fogak', 'meglevo_implantatumok', 'felso_fogpotlas_jellege', 'also_fogpotlas_jellege'] },
  { table: 'patient_treatment_plans', columns: ['kezelesi_terv_felso', 'kezelesi_terv_also', 'kezelesi_terv_arcot_erinto', 'kortorteneti_osszefoglalo', 'kezelesi_terv_melleklet', 'szakorvosi_velemeny'] },
] as const;

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return r.rows.length > 0;
}

async function safeReassign(client: PoolClient, table: string, primaryId: string, secondaryId: string): Promise<void> {
  if (!(await tableExists(client, table))) return;
  await client.query(
    `UPDATE ${table} SET patient_id = $1 WHERE patient_id = $2`,
    [primaryId, secondaryId],
  );
}

async function mergeOneToOneTable(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  primaryId: string,
  secondaryId: string,
): Promise<void> {
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

async function mergePatientStages(client: PoolClient, primaryId: string, secondaryId: string): Promise<void> {
  if (!(await tableExists(client, 'patient_stages'))) return;
  // Delete secondary's stages that conflict on (patient_id, stage_date)
  await client.query(
    `DELETE FROM patient_stages
     WHERE patient_id = $1
       AND stage_date IN (SELECT stage_date FROM patient_stages WHERE patient_id = $2)`,
    [secondaryId, primaryId],
  );
  await client.query(
    `UPDATE patient_stages SET patient_id = $1 WHERE patient_id = $2`,
    [primaryId, secondaryId],
  );
}

async function mergeToothTreatments(client: PoolClient, primaryId: string, secondaryId: string): Promise<void> {
  if (!(await tableExists(client, 'tooth_treatments'))) return;
  // Delete secondary's active treatments that conflict on (patient_id, tooth_number, treatment_code)
  await client.query(
    `DELETE FROM tooth_treatments tt_sec
     WHERE tt_sec.patient_id = $1
       AND tt_sec.completed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM tooth_treatments tt_pri
         WHERE tt_pri.patient_id = $2
           AND tt_pri.tooth_number = tt_sec.tooth_number
           AND tt_pri.treatment_code = tt_sec.treatment_code
           AND tt_pri.completed_at IS NULL
       )`,
    [secondaryId, primaryId],
  );
  await client.query(
    `UPDATE tooth_treatments SET patient_id = $1 WHERE patient_id = $2`,
    [primaryId, secondaryId],
  );
}

async function mergePatientIntakeItems(client: PoolClient, primaryId: string, secondaryId: string): Promise<void> {
  if (!(await tableExists(client, 'patient_intake_items'))) return;
  // Delete secondary's open intake items that conflict on (patient_id, kind) WHERE status='OPEN'
  await client.query(
    `DELETE FROM patient_intake_items
     WHERE patient_id = $1
       AND status = 'OPEN'
       AND kind IN (
         SELECT kind FROM patient_intake_items WHERE patient_id = $2 AND status = 'OPEN'
       )`,
    [secondaryId, primaryId],
  );
  await client.query(
    `UPDATE patient_intake_items SET patient_id = $1 WHERE patient_id = $2`,
    [primaryId, secondaryId],
  );
}

async function mergeEpisodesAndRelated(client: PoolClient, primaryId: string, secondaryId: string): Promise<void> {
  // Reassign episodes first, then episode-dependent tables
  if (await tableExists(client, 'patient_episodes')) {
    await client.query(
      `UPDATE patient_episodes SET patient_id = $1 WHERE patient_id = $2`,
      [primaryId, secondaryId],
    );
  }
  if (await tableExists(client, 'stage_events')) {
    await client.query(
      `UPDATE stage_events SET patient_id = $1 WHERE patient_id = $2`,
      [primaryId, secondaryId],
    );
  }
  if (await tableExists(client, 'ohip14_responses')) {
    // Episodes are already reassigned, so episode_id conflicts shouldn't happen.
    // Delete any remaining conflicts just in case.
    await client.query(
      `DELETE FROM ohip14_responses
       WHERE patient_id = $1
         AND (patient_id, episode_id, timepoint) IN (
           SELECT $2, episode_id, timepoint FROM ohip14_responses WHERE patient_id = $2
         )`,
      [secondaryId, primaryId],
    );
    await client.query(
      `UPDATE ohip14_responses SET patient_id = $1 WHERE patient_id = $2`,
      [primaryId, secondaryId],
    );
  }
}

async function mergeAppointments(client: PoolClient, primaryId: string, secondaryId: string): Promise<void> {
  if (!(await tableExists(client, 'appointments'))) return;
  // Simple reassign — time_slot_id is unique per appointment (not per patient),
  // so no conflict. The one-hard-next index is per episode_id and episodes are
  // already reassigned, so we just reassign.
  await client.query(
    `UPDATE appointments SET patient_id = $1 WHERE patient_id = $2`,
    [primaryId, secondaryId],
  );
}

async function updateDoctorMessageMentions(
  client: PoolClient,
  primaryId: string,
  secondaryId: string,
): Promise<void> {
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
    'telefonszam', 'szuletesi_datum', 'nem', 'email', 'cim', 'varos',
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

  // --- 3. Tables with unique constraints (handle conflicts) ---
  await mergePatientStages(client, primaryPatientId, secondaryPatientId);
  await mergeEpisodesAndRelated(client, primaryPatientId, secondaryPatientId);
  await mergeAppointments(client, primaryPatientId, secondaryPatientId);
  await mergeToothTreatments(client, primaryPatientId, secondaryPatientId);
  await mergePatientIntakeItems(client, primaryPatientId, secondaryPatientId);

  // --- 4. Simple reassign tables (no unique constraint conflicts) ---
  for (const table of SIMPLE_REASSIGN_TABLES) {
    await safeReassign(client, table, primaryPatientId, secondaryPatientId);
  }

  // --- 5. Doctor message mentions (JSONB) ---
  try {
    await updateDoctorMessageMentions(client, primaryPatientId, secondaryPatientId);
  } catch {
    // doctor_messages table might not exist
  }

  // --- 6. Delete secondary patient (CASCADE handles any remaining FK refs) ---
  await client.query('DELETE FROM patients WHERE id = $1', [secondaryPatientId]);

  // --- 7. Audit log ---
  await client.query(
    `INSERT INTO patient_changes (patient_id, field_name, old_value, new_value, changed_by, changed_at)
     VALUES ($1, 'merge', $2, $3, $4, NOW())`,
    [primaryPatientId, `Összevonva: ${secondaryName} (${secondaryTaj || 'TAJ nélkül'})`, `Elsődleges: ${pRow.nev}`, auth.email],
  );

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
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
