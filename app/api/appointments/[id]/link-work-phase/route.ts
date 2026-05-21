import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { logActivity } from '@/lib/activity';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { linkAppointmentToWorkPhase } from '@/lib/link-appointment-work-phase';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/appointments/:id/link-work-phase
 *
 * Meglévő jövőbeli foglalás összekötése egy munkafázissal (slot változatlan).
 * Epizód nélküli foglalásoknál (pl. páciens portál) body.episodeId kötelező.
 */
export const PATCH = roleHandler(
  ['admin', 'beutalo_orvos', 'fogpótlástanász'],
  async (req, { auth, params }) => {
    const appointmentId = params.id;
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const targetWorkPhaseId =
      typeof body?.targetWorkPhaseId === 'string' && body.targetWorkPhaseId.length > 0
        ? body.targetWorkPhaseId
        : null;
    const episodeId =
      typeof body?.episodeId === 'string' && body.episodeId.length > 0
        ? body.episodeId
        : null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

    if (!targetWorkPhaseId) {
      return NextResponse.json({ error: 'targetWorkPhaseId kötelező' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    const changedBy = auth.email ?? auth.userId ?? 'unknown';

    try {
      await client.query('BEGIN');
      const result = await linkAppointmentToWorkPhase(client, {
        appointmentId,
        targetWorkPhaseId,
        episodeId,
        reason,
        changedBy,
      });
      if (!result.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: result.error,
            ...(result.linkedAppointmentId && { linkedAppointmentId: result.linkedAppointmentId }),
          },
          { status: result.status }
        );
      }
      await client.query('COMMIT');

      try {
        await logActivity(
          req,
          auth.email,
          'appointment_linked_work_phase',
          `Appointment ${appointmentId} → ${result.workPhaseCode}${reason ? ` — ${reason}` : ''}`
        );
      } catch {
        /* non-blocking */
      }

      try {
        await projectRemainingSteps(result.episodeId);
        await emitSchedulingEvent('appointment', appointmentId, 'work_phase_linked');
        await emitSchedulingEvent('episode', result.episodeId, 'REPROJECT_INTENTS');
      } catch {
        /* non-blocking */
      }

      return NextResponse.json({
        ok: true,
        appointmentId,
        workPhaseId: result.workPhaseId,
        workPhaseCode: result.workPhaseCode,
        stepSeq: result.stepSeq,
        episodeId: result.episodeId,
        cleanedStaleLink: result.cleanedStaleLink,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('[appointments/link-work-phase] transaction failed', {
        appointmentId,
        targetWorkPhaseId,
        err,
      });
      return NextResponse.json(
        { error: 'Hozzárendelés nem sikerült — adatbázis hiba' },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  }
);
