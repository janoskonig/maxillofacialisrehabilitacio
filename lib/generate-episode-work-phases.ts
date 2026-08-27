/**
 * Episode work-phase generation (extracted from POST /api/episodes/:id/work-phases/generate
 * so activation, the backfill script, and the API route share one implementation).
 *
 * Idempotent: skips pathways that already have generated phases and tooth treatments
 * already turned into steps. Runs in a single transaction.
 *
 * WP-0.7 (kódaudit #01 + #07):
 *   • Az idempotencia-őr a törlés-tombstone-okat (episode_work_phase_tombstones,
 *     086-os migráció) is nézi — a törölt fázis nem "hiányzó", nem generálandó
 *     újra, és a fog-szinkron sem teszi vissza a törölt fog-fázist.
 *   • Az episode_pathways bootstrap INSERT-je nem használ ON CONFLICT-ot: a
 *     006-os migráció óta az egyediséget a 3-elemű kifejezés-index adja
 *     (episode_id, care_pathway_id, COALESCE(jaw,'_none_')), amire a 2 oszlopos
 *     arbiter-inferencia 42P10-zel hasalt, és a csupasz catch mindig a
 *     '__legacy__' fallbackra vitt. Most: 23505 → a meglévő sor visszaolvasása;
 *     42P01 (nincs episode_pathways tábla) → '__legacy__'; minden más hiba dob.
 *   • A '__legacy__' őr nem a túl széles `source_episode_pathway_id IS NULL`
 *     predikátum, hanem a sablon fázis-kódjaira szűkített kérdés — így egy
 *     ad-hoc (NULL-source) sor nem hiúsítja meg a sablon generálását.
 */

import type { Pool } from 'pg';
import { normalizePathwayWorkPhaseArray } from './pathway-work-phases-for-episode';

export type GenerateWorkPhasesResult =
  | { status: 'ok'; totalGenerated: number }
  | { status: 'not_found' }
  | { status: 'not_open' }
  | { status: 'no_pathway' };

/**
 * Generate episode_work_phases for an episode from its care pathway(s) + linked tooth
 * treatments. Returns a structured result instead of throwing HTTP errors so callers
 * (route, activation, backfill) can decide how to react.
 */
export async function generateEpisodeWorkPhases(
  pool: Pool,
  episodeId: string
): Promise<GenerateWorkPhasesResult> {
  const epRow = await pool.query(
    `SELECT pe.id, pe.patient_id, pe.care_pathway_id, pe.status
     FROM patient_episodes pe WHERE pe.id = $1`,
    [episodeId]
  );
  if (epRow.rows.length === 0) return { status: 'not_found' };

  const ep = epRow.rows[0];
  if (ep.status !== 'open') return { status: 'not_open' };

  let epPathways: Array<{ id: string; care_pathway_id: string }> = [];
  try {
    const epPathwayRows = await pool.query(
      `SELECT id, care_pathway_id FROM episode_pathways WHERE episode_id = $1 ORDER BY ordinal`,
      [episodeId]
    );
    epPathways = epPathwayRows.rows;
  } catch {
    // episode_pathways table might not exist yet
  }

  // A patient_episodes.care_pathway_id-ból bootstrapolt episode_pathways sorok
  // id-i: ezekre az őr a régi, NULL-source-ú (a hibás '__legacy__' ágon
  // generált) sablon-fázisokat is figyeli, nehogy a javítás után ugyanaz a
  // sablon másodszor is beszúródjon (kódaudit #07 "kétszer szúródik be" ága).
  const bootstrappedPathwayIds = new Set<string>();

  if (epPathways.length === 0 && ep.care_pathway_id) {
    try {
      // Nincs ON CONFLICT: a 006-os migráció a 2-oszlopos unique constraintet
      // kifejezés-indexre cserélte, amit az arbiter-inferencia nem talál meg
      // (42P10). Az ütközést a 23505-ös ág kezeli.
      const ins = await pool.query(
        `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal)
         VALUES ($1, $2, 0)
         RETURNING id, care_pathway_id`,
        [episodeId, ep.care_pathway_id]
      );
      epPathways = ins.rows;
      for (const row of ins.rows) bootstrappedPathwayIds.add(row.id);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === '23505') {
        // Párhuzamos hívás már beszúrta — a meglévő sort olvassuk vissza.
        const existing = await pool.query(
          `SELECT id, care_pathway_id FROM episode_pathways
           WHERE episode_id = $1 AND care_pathway_id = $2
           ORDER BY ordinal`,
          [episodeId, ep.care_pathway_id]
        );
        epPathways = existing.rows;
      } else if (code === '42P01') {
        // Csak a hiányzó episode_pathways tábla visz a legacy ágra.
        epPathways = [{ id: '__legacy__', care_pathway_id: ep.care_pathway_id }];
      } else {
        throw err;
      }
    }
  }

  if (epPathways.length === 0) return { status: 'no_pathway' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Törlés-tombstone tábla (086-os migráció) — régebbi környezetben még
    // hiányozhat (a lib backfill/sim scriptekből is fut), ezért probe-oljuk,
    // a hasToothCol mintájára.
    const tombstoneProbe = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'episode_work_phase_tombstones' LIMIT 1`
    );
    const hasTombstones = tombstoneProbe.rows.length > 0;

    const toothColProbe = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'episode_work_phases' AND column_name = 'tooth_treatment_id' LIMIT 1`
    );
    const hasToothCol = toothColProbe.rows.length > 0;

    const maxSeqRow = await client.query(
      `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_work_phases WHERE episode_id = $1`,
      [episodeId]
    );
    let nextSeq: number = (maxSeqRow.rows[0].max_seq ?? -1) + 1;
    let totalGenerated = 0;

    for (const epPw of epPathways) {
      // A sablont az őr ELŐTT olvassuk: a legacy őrnek a fázis-kódok kellenek.
      const pathwayRow = await client.query(
        `SELECT work_phases_json, steps_json FROM care_pathways WHERE id = $1`,
        [epPw.care_pathway_id]
      );
      const templates =
        normalizePathwayWorkPhaseArray(pathwayRow.rows[0]?.work_phases_json) ??
        normalizePathwayWorkPhaseArray(pathwayRow.rows[0]?.steps_json);

      if (!templates || templates.length === 0) continue;

      const templateCodes = templates.map((t) => t.work_phase_code);

      if (epPw.id === '__legacy__') {
        // Legacy ág (nincs episode_pathways tábla): az őr a sablon fázis-kódjaira
        // szűkít — a korábbi `source_episode_pathway_id IS NULL` predikátum egy
        // ad-hoc vagy fog-fázis sortól is "kész"-nek látta a sablont.
        const alreadyExists = await client.query(
          `SELECT 1 FROM episode_work_phases
           WHERE episode_id = $1 AND source_episode_pathway_id IS NULL
             AND work_phase_code = ANY($2::text[])
           LIMIT 1`,
          [episodeId, templateCodes]
        );
        if (alreadyExists.rows.length > 0) continue;
        if (hasTombstones) {
          const tombstoned = await client.query(
            `SELECT 1 FROM episode_work_phase_tombstones
             WHERE episode_id = $1 AND source_episode_pathway_id IS NULL
               AND work_phase_code = ANY($2::text[])
             LIMIT 1`,
            [episodeId, templateCodes]
          );
          if (tombstoned.rows.length > 0) continue;
        }
      } else {
        const alreadyExists = await client.query(
          `SELECT 1 FROM episode_work_phases WHERE source_episode_pathway_id = $1 LIMIT 1`,
          [epPw.id]
        );
        if (alreadyExists.rows.length > 0) continue;

        // Törlés-tombstone (kódaudit #01): ha ebből a sablonból már töröltek
        // fázist, a sablon nem generálandó újra — a törölt sor nem "hiányzó".
        if (hasTombstones) {
          const tombstoned = await client.query(
            `SELECT 1 FROM episode_work_phase_tombstones WHERE source_episode_pathway_id = $1 LIMIT 1`,
            [epPw.id]
          );
          if (tombstoned.rows.length > 0) continue;
        }

        // Frissen bootstrapolt episode_pathways sor (kódaudit #07 "kétszer
        // szúródik be" ága): ha a tervet korábban a hibás '__legacy__' út már
        // legenerálta (NULL-source sorok a sablon kódjaival), nem szúrjuk be
        // másodszor — az árva sorokat nem bántjuk, csak nem duplikálunk.
        if (bootstrappedPathwayIds.has(epPw.id)) {
          const legacyGenerated = await client.query(
            `SELECT 1 FROM episode_work_phases
             WHERE episode_id = $1 AND source_episode_pathway_id IS NULL
               ${hasToothCol ? 'AND tooth_treatment_id IS NULL' : ''}
               AND work_phase_code = ANY($2::text[])
             LIMIT 1`,
            [episodeId, templateCodes]
          );
          if (legacyGenerated.rows.length > 0) continue;
        }
      }

      const insertValues: unknown[] = [];
      const insertPlaceholders: string[] = [];
      let pIdx = 1;

      for (let i = 0; i < templates.length; i++) {
        const ph = templates[i];
        const sourceId = epPw.id === '__legacy__' ? null : epPw.id;
        insertPlaceholders.push(
          `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7})`
        );
        insertValues.push(
          episodeId,
          ph.work_phase_code,
          i,
          ph.pool ?? 'work',
          ph.duration_minutes ?? 30,
          ph.default_days_offset ?? 7,
          sourceId,
          nextSeq + i
        );
        pIdx += 8;
      }

      await client.query(
        `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, source_episode_pathway_id, seq)
         VALUES ${insertPlaceholders.join(', ')}`,
        insertValues
      );

      nextSeq += templates.length;
      totalGenerated += templates.length;
    }

    // Sync linked tooth treatments into steps (automatic: all episode_linked treatments become steps)
    if (hasToothCol) {
      // A törölt fog-fázis nem "hiányzó" (kódaudit #01): a tombstone-nal bíró
      // fogkezelést a szinkron kihagyja — kézzel (from-tooth-treatment) továbbra
      // is hozzáadható. A törlés emellett a tooth_treatments.status-t is
      // visszaállítja 'pending'-re, így az episode_linked szűrő sem venné fel.
      const missing = await client.query(
        `SELECT tt.id, tt.treatment_code, tt.tooth_number, ttc.label_hu as "label_hu"
         FROM tooth_treatments tt
         JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code
         WHERE tt.episode_id = $1 AND tt.status = 'episode_linked'
           AND NOT EXISTS (SELECT 1 FROM episode_work_phases es WHERE es.episode_id = tt.episode_id AND es.tooth_treatment_id = tt.id)
           ${
             hasTombstones
               ? `AND NOT EXISTS (SELECT 1 FROM episode_work_phase_tombstones t
                    WHERE t.episode_id = tt.episode_id AND t.tooth_treatment_id = tt.id)`
               : ''
           }
         ORDER BY tt.tooth_number, ttc.sort_order`,
        [episodeId]
      );
      for (const row of missing.rows) {
        const workPhaseCode = `tooth_${row.treatment_code}`;
        const customLabel = `${row.label_hu} – ${row.tooth_number}`;
        const maxIdxRow = await client.query(
          `SELECT COALESCE(MAX(pathway_order_index), -1) as max_idx FROM episode_work_phases WHERE episode_id = $1`,
          [episodeId]
        );
        const nextIdx = (maxIdxRow.rows[0].max_idx ?? -1) + 1;
        await client.query(
          `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, tooth_treatment_id, custom_label)
           VALUES ($1, $2, $3, 'work', 30, 7, $4, $5, $6)`,
          [episodeId, workPhaseCode, nextIdx, nextSeq, row.id, customLabel]
        );
        nextSeq += 1;
        totalGenerated += 1;
      }
    }

    await client.query('COMMIT');
    return { status: 'ok', totalGenerated };
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
}
