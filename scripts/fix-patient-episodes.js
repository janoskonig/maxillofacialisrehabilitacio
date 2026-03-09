/**
 * Fix patient a0eb15e8-003e-44ff-b4d4-18906b64d898:
 * Tooth-treatment "Epizód" buttons created separate episodes per tooth,
 * closing the original. This script merges them back into the original episode.
 */
const fs = require('fs');
const path = require('path');

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL nincs beállítva!');
  process.exit(1);
}

const PATIENT_ID = 'a0eb15e8-003e-44ff-b4d4-18906b64d898';

async function run() {
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('render.com') || connectionString.includes('amazonaws.com')
      ? { rejectUnauthorized: false }
      : false,
  });

  const client = await pool.connect();
  try {
    // List all episodes for the patient
    const allEpisodes = await client.query(
      `SELECT id, chief_complaint, status, opened_at, closed_at
       FROM patient_episodes
       WHERE patient_id = $1
       ORDER BY opened_at ASC`,
      [PATIENT_ID]
    );
    console.log(`Found ${allEpisodes.rows.length} episodes for patient:`);
    for (const ep of allEpisodes.rows) {
      console.log(`  [${ep.status}] ${ep.chief_complaint} (${ep.id}) opened=${ep.opened_at}`);
    }

    // Identify the original episode (the one that is NOT a "Fog XX —" auto-created one)
    const originalEpisode = allEpisodes.rows.find(
      (ep) => !ep.chief_complaint.startsWith('Fog ')
    );
    if (!originalEpisode) {
      console.error('Could not find the original (non-tooth) episode!');
      process.exit(1);
    }
    console.log(`\nOriginal episode: "${originalEpisode.chief_complaint}" (${originalEpisode.id})`);

    // Identify spurious tooth-created episodes
    const spuriousEpisodes = allEpisodes.rows.filter(
      (ep) => ep.chief_complaint.startsWith('Fog ') && ep.id !== originalEpisode.id
    );
    if (spuriousEpisodes.length === 0) {
      console.log('No spurious tooth episodes found — nothing to fix.');
      await pool.end();
      return;
    }
    console.log(`Spurious episodes to merge: ${spuriousEpisodes.length}`);
    for (const ep of spuriousEpisodes) {
      console.log(`  → "${ep.chief_complaint}" (${ep.id})`);
    }

    const spuriousIds = spuriousEpisodes.map((ep) => ep.id);

    await client.query('BEGIN');

    // 1. Re-link tooth_treatments from spurious episodes to original
    const ttUpdate = await client.query(
      `UPDATE tooth_treatments
       SET episode_id = $1
       WHERE patient_id = $2 AND episode_id = ANY($3)`,
      [originalEpisode.id, PATIENT_ID, spuriousIds]
    );
    console.log(`\nRe-linked ${ttUpdate.rowCount} tooth treatments to original episode.`);

    // 2. Move episode_pathways from spurious episodes to original (skip duplicates)
    for (const spId of spuriousIds) {
      const pathways = await client.query(
        `SELECT care_pathway_id, jaw FROM episode_pathways WHERE episode_id = $1`,
        [spId]
      );
      for (const pw of pathways.rows) {
        const exists = await client.query(
          `SELECT 1 FROM episode_pathways
           WHERE episode_id = $1 AND care_pathway_id = $2 AND COALESCE(jaw, '_none_') = COALESCE($3, '_none_')`,
          [originalEpisode.id, pw.care_pathway_id, pw.jaw]
        );
        if (exists.rows.length === 0) {
          const ordRow = await client.query(
            `SELECT COALESCE(MAX(ordinal), -1) + 1 as next_ord FROM episode_pathways WHERE episode_id = $1`,
            [originalEpisode.id]
          );
          await client.query(
            `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal, jaw) VALUES ($1, $2, $3, $4)`,
            [originalEpisode.id, pw.care_pathway_id, ordRow.rows[0].next_ord, pw.jaw]
          );
          console.log(`  Moved pathway ${pw.care_pathway_id} (jaw=${pw.jaw}) to original episode.`);
        }
      }
    }

    // 3. Move episode_steps from spurious episodes to original, re-sequencing
    const maxSeqRow = await client.query(
      `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_steps WHERE episode_id = $1`,
      [originalEpisode.id]
    );
    let nextSeq = (maxSeqRow.rows[0].max_seq ?? -1) + 1;

    // Also update source_episode_pathway_id to point to correct pathway in original
    const stepsUpdate = await client.query(
      `UPDATE episode_steps SET episode_id = $1
       WHERE episode_id = ANY($2)`,
      [originalEpisode.id, spuriousIds]
    );
    console.log(`Moved ${stepsUpdate.rowCount} episode_steps to original episode.`);

    // Re-sequence all steps in the original episode
    await client.query(
      `WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY seq, pathway_order_index) - 1 as new_seq
        FROM episode_steps WHERE episode_id = $1
      )
      UPDATE episode_steps SET seq = numbered.new_seq
      FROM numbered WHERE episode_steps.id = numbered.id`,
      [originalEpisode.id]
    );
    console.log('Re-sequenced episode_steps.');

    // 4. Move stage_events from spurious episodes to original
    const seUpdate = await client.query(
      `UPDATE stage_events SET episode_id = $1
       WHERE episode_id = ANY($2)`,
      [originalEpisode.id, spuriousIds]
    );
    console.log(`Moved ${seUpdate.rowCount} stage_events to original episode.`);

    // 5. Delete episode_pathways and then the spurious episodes themselves
    await client.query(
      `DELETE FROM episode_pathways WHERE episode_id = ANY($1)`,
      [spuriousIds]
    );
    const delResult = await client.query(
      `DELETE FROM patient_episodes WHERE id = ANY($1)`,
      [spuriousIds]
    );
    console.log(`Deleted ${delResult.rowCount} spurious episodes.`);

    // 6. Reopen the original episode if it was closed
    if (originalEpisode.status !== 'open') {
      await client.query(
        `UPDATE patient_episodes SET status = 'open', closed_at = NULL WHERE id = $1`,
        [originalEpisode.id]
      );
      console.log('Reopened original episode.');
    } else {
      console.log('Original episode is already open.');
    }

    // 7. Update legacy care_pathway_id on the original episode
    const firstPathway = await client.query(
      `SELECT care_pathway_id FROM episode_pathways WHERE episode_id = $1 ORDER BY ordinal LIMIT 1`,
      [originalEpisode.id]
    );
    if (firstPathway.rows.length > 0) {
      await client.query(
        `UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`,
        [firstPathway.rows[0].care_pathway_id, originalEpisode.id]
      );
    }

    await client.query('COMMIT');

    // Verify final state
    const finalEpisodes = await client.query(
      `SELECT id, chief_complaint, status, opened_at FROM patient_episodes WHERE patient_id = $1 ORDER BY opened_at`,
      [PATIENT_ID]
    );
    console.log(`\n=== Final state: ${finalEpisodes.rows.length} episode(s) ===`);
    for (const ep of finalEpisodes.rows) {
      console.log(`  [${ep.status}] ${ep.chief_complaint} (${ep.id})`);
    }

    const linkedTreatments = await client.query(
      `SELECT tt.tooth_number, tt.treatment_code, tt.status, tt.episode_id
       FROM tooth_treatments tt WHERE tt.patient_id = $1 ORDER BY tt.tooth_number`,
      [PATIENT_ID]
    );
    console.log(`\nTooth treatments (${linkedTreatments.rows.length}):`);
    for (const t of linkedTreatments.rows) {
      console.log(`  Fog ${t.tooth_number} — ${t.treatment_code} [${t.status}] → episode ${t.episode_id}`);
    }

    console.log('\nDone!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fix failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
