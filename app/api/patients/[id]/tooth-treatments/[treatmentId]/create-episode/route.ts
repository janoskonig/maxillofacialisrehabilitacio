import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

/**
 * POST /api/patients/:id/tooth-treatments/:treatmentId/create-episode
 * Creates a new episode from a pending tooth treatment need.
 * Optionally auto-assigns pathway if tooth treatment type has a default_care_pathway_id.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; treatmentId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const pool = getDbPool();
    const patientId = params.id;
    const treatmentId = params.treatmentId;

    const body = await request.json().catch(() => ({}));
    const reason = (body.reason as string) || REASON_VALUES[0];
    if (!REASON_VALUES.includes(reason)) {
      return NextResponse.json({ error: 'Érvényes etiológia (reason) kötelező' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock patient row
      await client.query('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [patientId]);

      // Get tooth treatment with catalog info
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

      // Close existing open episodes for this patient
      const closingResult = await client.query(
        `SELECT id FROM patient_episodes WHERE patient_id = $1 AND status = 'open'`,
        [patientId]
      );
      const closingIds = closingResult.rows.map((r: { id: string }) => r.id);
      if (closingIds.length > 0) {
        try {
          const { invalidateIntentsForEpisodes } = await import('@/lib/intent-invalidation');
          await invalidateIntentsForEpisodes(closingIds, 'episode_closed');
        } catch (e) {
          console.error('Failed to invalidate intents for closed episodes:', e);
        }
      }
      await client.query(
        `UPDATE patient_episodes SET status = 'closed', closed_at = CURRENT_TIMESTAMP
         WHERE patient_id = $1 AND status = 'open'`,
        [patientId]
      );

      const chiefComplaint = `Fog ${tt.tooth_number} — ${tt.label_hu}`;

      // Create new episode
      const insertResult = await client.query(
        `INSERT INTO patient_episodes (
          patient_id, reason, chief_complaint, status, opened_at, created_by
        ) VALUES ($1, $2, $3, 'open', CURRENT_TIMESTAMP, $4)
        RETURNING id`,
        [patientId, reason, chiefComplaint, auth.email]
      );
      const episodeId = insertResult.rows[0]?.id;
      if (!episodeId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Epizód létrehozása sikertelen' }, { status: 500 });
      }

      // Create STAGE_0 event if table exists
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

      // Auto-assign pathway if available
      let pathwayAssigned = false;
      if (tt.default_care_pathway_id) {
        const pathwayCheck = await client.query(
          'SELECT id, steps_json FROM care_pathways WHERE id = $1',
          [tt.default_care_pathway_id]
        );
        if (pathwayCheck.rows.length > 0) {
          // Try multi-pathway (episode_pathways table)
          const epPwExists = await client.query(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'episode_pathways'`
          );
          if (epPwExists.rows.length > 0) {
            await client.query(
              `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal) VALUES ($1, $2, 0)`,
              [episodeId, tt.default_care_pathway_id]
            );
          }
          // Also set legacy field
          await client.query(
            `UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`,
            [tt.default_care_pathway_id, episodeId]
          );

          // Generate episode_steps from pathway
          const stepsJson = pathwayCheck.rows[0].steps_json;
          if (Array.isArray(stepsJson) && stepsJson.length > 0) {
            const epStepsExists = await client.query(
              `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'episode_steps'`
            );
            if (epStepsExists.rows.length > 0) {
              for (let i = 0; i < stepsJson.length; i++) {
                const step = stepsJson[i];
                await client.query(
                  `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, seq, pool, duration_minutes, default_days_offset, status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
                  [
                    episodeId,
                    step.step_code,
                    i,
                    i,
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

      // Link tooth treatment to episode
      await client.query(
        `UPDATE tooth_treatments SET episode_id = $1, status = 'episode_linked' WHERE id = $2`,
        [episodeId, treatmentId]
      );

      await client.query('COMMIT');

      await logActivity(
        request,
        auth.email,
        'tooth_treatment_episode_created',
        JSON.stringify({
          patientId,
          treatmentId,
          episodeId,
          toothNumber: tt.tooth_number,
          treatmentCode: tt.treatment_code,
          pathwayAssigned,
        })
      );

      return NextResponse.json(
        {
          episodeId,
          chiefComplaint,
          pathwayAssigned,
          treatmentId,
        },
        { status: 201 }
      );
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating episode from tooth treatment:', error);
    return NextResponse.json(
      { error: 'Hiba történt az epizód létrehozásakor' },
      { status: 500 }
    );
  }
}
