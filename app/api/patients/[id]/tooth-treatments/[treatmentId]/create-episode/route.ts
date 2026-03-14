import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { logActivity } from '@/lib/activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

/**
 * POST /api/patients/:id/tooth-treatments/:treatmentId/create-episode
 *
 * Links a pending tooth treatment to an episode:
 *  - If the patient already has an open episode, the treatment is linked to it.
 *  - If no open episode exists, a new one is created.
 * Optionally auto-assigns the default pathway from the tooth treatment catalog.
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const treatmentId = params.treatmentId;

  const body = await req.json().catch(() => ({}));
  const reason = (body.reason as string) || REASON_VALUES[0];
  if (!REASON_VALUES.includes(reason)) {
    return NextResponse.json({ error: 'Érvényes etiológia (reason) kötelező' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [patientId]);

    const ttResult = await client.query(
      `SELECT tt.id, tt.tooth_number, tt.treatment_code, tt.status, tt.episode_id,
              tc.label_hu, tc.default_care_pathway_id
       FROM tooth_treatments tt
       JOIN tooth_treatment_catalog tc ON tt.treatment_code = tc.code
       WHERE tt.id = $1 AND tt.patient_id = $2
       FOR UPDATE`,
      [treatmentId, patientId]
    );

    if (ttResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Fog-kezelési igény nem található' }, { status: 404 });
    }

    const tt = ttResult.rows[0];
    if (tt.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Csak pending státuszú kezelési igényhez hozható létre epizód' },
        { status: 409 }
      );
    }

    // Check for existing open episode
    const existingEpisode = await client.query(
      `SELECT id, chief_complaint FROM patient_episodes WHERE patient_id = $1 AND status = 'open' LIMIT 1`,
      [patientId]
    );

    let episodeId: string;
    let linkedToExisting = false;

    if (existingEpisode.rows.length > 0) {
      // Link to existing active episode
      episodeId = existingEpisode.rows[0].id;
      linkedToExisting = true;
    } else {
      // No active episode — create a new one
      const chiefComplaint = `Fog ${tt.tooth_number} — ${tt.label_hu}`;
      const insertResult = await client.query(
        `INSERT INTO patient_episodes (
          patient_id, reason, chief_complaint, status, opened_at, created_by
        ) VALUES ($1, $2, $3, 'open', CURRENT_TIMESTAMP, $4)
        RETURNING id`,
        [patientId, reason, chiefComplaint, auth.email]
      );
      episodeId = insertResult.rows[0]?.id;
      if (!episodeId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Epizód létrehozása sikertelen' }, { status: 500 });
      }

      const stageEventsExists = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
      );
      if (stageEventsExists.rows.length > 0) {
        await client.query(
          `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, created_by)
           VALUES ($1, $2, 'STAGE_0', CURRENT_TIMESTAMP, $3)`,
          [patientId, episodeId, auth.email]
        );
      }
    }

    // Auto-assign pathway if the tooth treatment type has a default and it's not already on the episode
    let pathwayAssigned = false;
    if (tt.default_care_pathway_id) {
      const pathwayCheck = await client.query(
        'SELECT id, steps_json FROM care_pathways WHERE id = $1',
        [tt.default_care_pathway_id]
      );
      if (pathwayCheck.rows.length > 0) {
        const epPwExists = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'episode_pathways'`
        );
        if (epPwExists.rows.length > 0) {
          // Only add if not already assigned to this episode
          const alreadyAssigned = await client.query(
            `SELECT 1 FROM episode_pathways WHERE episode_id = $1 AND care_pathway_id = $2`,
            [episodeId, tt.default_care_pathway_id]
          );
          if (alreadyAssigned.rows.length === 0) {
            const ordRow = await client.query(
              `SELECT COALESCE(MAX(ordinal), -1) + 1 as next_ord FROM episode_pathways WHERE episode_id = $1`,
              [episodeId]
            );
            const ordinal = ordRow.rows[0].next_ord;
            await client.query(
              `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal) VALUES ($1, $2, $3)`,
              [episodeId, tt.default_care_pathway_id, ordinal]
            );

            if (ordinal === 0) {
              await client.query(
                `UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2 AND care_pathway_id IS NULL`,
                [tt.default_care_pathway_id, episodeId]
              );
            }

            const stepsJson = pathwayCheck.rows[0].steps_json;
            if (Array.isArray(stepsJson) && stepsJson.length > 0) {
              const epStepsExists = await client.query(
                `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'episode_steps'`
              );
              if (epStepsExists.rows.length > 0) {
                const maxSeqRow = await client.query(
                  `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_steps WHERE episode_id = $1`,
                  [episodeId]
                );
                const nextSeq: number = (maxSeqRow.rows[0].max_seq ?? -1) + 1;
                for (let i = 0; i < stepsJson.length; i++) {
                  const step = stepsJson[i];
                  await client.query(
                    `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, seq, pool, duration_minutes, default_days_offset, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
                    [
                      episodeId,
                      step.step_code,
                      i,
                      nextSeq + i,
                      step.pool || 'work',
                      step.duration_minutes || 30,
                      step.default_days_offset || 0,
                    ]
                  );
                }
              }
            }
            pathwayAssigned = true;
          }
        }
      }
    }

    // Link tooth treatment to episode
    await client.query(
      `UPDATE tooth_treatments SET episode_id = $1, status = 'episode_linked' WHERE id = $2`,
      [episodeId, treatmentId]
    );

    // Always create an episode_step for this tooth treatment (unless one already exists)
    const alreadyStep = await client.query(
      `SELECT 1 FROM episode_steps WHERE episode_id = $1 AND tooth_treatment_id = $2`,
      [episodeId, treatmentId]
    );
    if (alreadyStep.rows.length === 0) {
      const stepSeqRow = await client.query(
        `SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq,
                COALESCE(MAX(pathway_order_index), -1) + 1 AS next_idx
         FROM episode_steps WHERE episode_id = $1`,
        [episodeId]
      );
      const nextSeq: number = stepSeqRow.rows[0].next_seq;
      const nextIdx: number = stepSeqRow.rows[0].next_idx;
      const stepCode = `tooth_${tt.treatment_code}`;
      const customLabel = `${tt.label_hu} – ${tt.tooth_number}`;

      await client.query(
        `INSERT INTO episode_steps
           (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, tooth_treatment_id, custom_label, status)
         VALUES ($1, $2, $3, 'work', 30, 7, $4, $5, $6, 'pending')`,
        [episodeId, stepCode, nextIdx, nextSeq, treatmentId, customLabel]
      );
    }

    await client.query('COMMIT');

    await logActivity(
      req,
      auth.email,
      linkedToExisting ? 'tooth_treatment_episode_linked' : 'tooth_treatment_episode_created',
      JSON.stringify({
        patientId,
        treatmentId,
        episodeId,
        toothNumber: tt.tooth_number,
        treatmentCode: tt.treatment_code,
        pathwayAssigned,
        linkedToExisting,
      })
    );

    return NextResponse.json(
      {
        episodeId,
        pathwayAssigned,
        treatmentId,
        linkedToExisting,
      },
      { status: linkedToExisting ? 200 : 201 }
    );
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
});
