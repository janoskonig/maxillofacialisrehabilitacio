import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

export type TimelineStepStatus = 'completed' | 'booked' | 'in_progress' | 'no_show' | 'projected' | 'overdue';

interface TimelineStep {
  stepCode: string;
  stepSeq: number;
  label: string;
  pool: string;
  durationMinutes: number;
  status: TimelineStepStatus;
  windowStart: string | null;
  windowEnd: string | null;
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string | null;
  intentId: string | null;
  intentState: string | null;
}

interface TimelineEpisode {
  episodeId: string;
  patientId: string;
  patientName: string;
  reason: string;
  status: string;
  openedAt: string;
  carePathwayName: string | null;
  assignedProviderName: string | null;
  treatmentTypeLabel: string | null;
  steps: TimelineStep[];
  etaHeuristic: string | null;
}

/** Protetikai fázis: csak itt jelennek meg betervezett időpontok (ablakok/dátumok). */
const PROTETIKAI_STAGE_CODES = ['STAGE_5', 'STAGE_6', 'STAGE_7'] as const;

/**
 * GET /api/treatment-plan-timeline
 * Query params: status (open|closed|all), providerId, limit, offset
 * Betervezett időpontok (ablak/dátum) csak protetikai fázisban (STAGE_5/6/7) jelennek meg.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    if (!['admin', 'sebészorvos', 'fogpótlástanász'].includes(auth.role)) {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const episodeStatus = searchParams.get('status') ?? 'open';
    const providerId = searchParams.get('providerId');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const pool = getDbPool();
    const now = new Date();

    // 1. Fetch episodes with pathway and with at least one kezelési terv filled on patient profile (Felső/Alsó/Arcot érintő)
    const whereParts: string[] = [
      'pe.care_pathway_id IS NOT NULL',
      `(
        (p.kezelesi_terv_felso IS NOT NULL AND jsonb_array_length(p.kezelesi_terv_felso) > 0)
        OR (p.kezelesi_terv_also IS NOT NULL AND jsonb_array_length(p.kezelesi_terv_also) > 0)
        OR (p.kezelesi_terv_arcot_erinto IS NOT NULL AND jsonb_array_length(p.kezelesi_terv_arcot_erinto) > 0)
      )`,
    ];
    const params: unknown[] = [];
    let pi = 1;

    if (episodeStatus !== 'all') {
      whereParts.push(`pe.status = $${pi}`);
      params.push(episodeStatus);
      pi++;
    }
    if (providerId) {
      whereParts.push(`pe.assigned_provider_id = $${pi}`);
      params.push(providerId);
      pi++;
    }

    params.push(limit, offset);
    const episodesResult = await pool.query(
      `SELECT pe.id as episode_id, pe.patient_id, pe.reason, pe.status, pe.opened_at,
              p.nev as patient_name,
              cp.name as care_pathway_name, cp.steps_json,
              u.doktor_neve as assigned_provider_name,
              tt.label_hu as treatment_type_label
       FROM patient_episodes pe
       JOIN patients p ON pe.patient_id = p.id
       JOIN care_pathways cp ON pe.care_pathway_id = cp.id
       LEFT JOIN users u ON pe.assigned_provider_id = u.id
       LEFT JOIN treatment_types tt ON pe.treatment_type_id = tt.id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY pe.opened_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      params
    );

    if (episodesResult.rows.length === 0) {
      return NextResponse.json({
        episodes: [],
        meta: { serverNow: now.toISOString(), fetchedAt: now.toISOString(), timezone: 'Europe/Budapest', ordering: 'eta_asc' },
      });
    }

    const episodeIds = episodesResult.rows.map((r: { episode_id: string }) => r.episode_id);

    // 2. Batch fetch appointments, intents, and current stage per episode
    const [apptsResult, intentsResult, stagesResult] = await Promise.all([
      pool.query(
        `SELECT id, episode_id, step_code, step_seq, start_time, appointment_status
         FROM appointments
         WHERE episode_id = ANY($1)
           AND step_code IS NOT NULL
           AND appointment_status IS DISTINCT FROM 'cancelled_by_doctor'
           AND appointment_status IS DISTINCT FROM 'cancelled_by_patient'
         ORDER BY step_seq ASC`,
        [episodeIds]
      ),
      pool.query(
        `SELECT id, episode_id, step_code, step_seq, window_start, window_end, state
         FROM slot_intents
         WHERE episode_id = ANY($1)
           AND state IN ('open', 'expired', 'converted')
         ORDER BY step_seq ASC`,
        [episodeIds]
      ),
      pool.query(
        `SELECT DISTINCT ON (episode_id) episode_id, stage_code
         FROM stage_events
         WHERE episode_id = ANY($1)
         ORDER BY episode_id, at DESC`,
        [episodeIds]
      ),
    ]);

    const stageByEpisode = new Map<string, string>();
    for (const row of stagesResult.rows as { episode_id: string; stage_code: string }[]) {
      stageByEpisode.set(row.episode_id, row.stage_code);
    }

    // Index by episode_id
    const apptsByEpisode = new Map<string, typeof apptsResult.rows>();
    for (const a of apptsResult.rows) {
      const arr = apptsByEpisode.get(a.episode_id) ?? [];
      arr.push(a);
      apptsByEpisode.set(a.episode_id, arr);
    }
    const intentsByEpisode = new Map<string, typeof intentsResult.rows>();
    for (const i of intentsResult.rows) {
      const arr = intentsByEpisode.get(i.episode_id) ?? [];
      arr.push(i);
      intentsByEpisode.set(i.episode_id, arr);
    }

    // 3. Build timeline per episode
    const episodes: TimelineEpisode[] = [];
    for (const ep of episodesResult.rows) {
      const steps: TimelineStep[] = [];
      const pathwaySteps = ep.steps_json as Array<{
        step_code: string; label?: string; pool: string; duration_minutes?: number;
      }>;
      if (!pathwaySteps || !Array.isArray(pathwaySteps)) continue;

      const appts = apptsByEpisode.get(ep.episode_id) ?? [];
      const intents = intentsByEpisode.get(ep.episode_id) ?? [];
      const currentStage = stageByEpisode.get(ep.episode_id) ?? null;
      const isProtetikai = currentStage != null && (PROTETIKAI_STAGE_CODES as readonly string[]).includes(currentStage);

      // Index appointments and intents by step_seq
      const apptBySeq = new Map<number, (typeof appts)[0]>();
      for (const a of appts) {
        if (a.step_seq != null) apptBySeq.set(a.step_seq, a);
      }
      const intentBySeq = new Map<number, (typeof intents)[0]>();
      for (const i of intents) {
        if (i.step_seq != null) intentBySeq.set(i.step_seq, i);
      }

      let etaHeuristic: string | null = null;

      for (let seq = 0; seq < pathwaySteps.length; seq++) {
        const ps = pathwaySteps[seq];
        const appt = apptBySeq.get(seq);
        const intent = intentBySeq.get(seq);

        let status: TimelineStepStatus;
        let windowStart: string | null = null;
        let windowEnd: string | null = null;

        if (appt) {
          const apptStatus = appt.appointment_status;
          if (apptStatus === 'completed') {
            status = 'completed';
          } else if (apptStatus === 'no_show') {
            status = 'no_show';
          } else {
            // NULL status = pending/booked
            const apptStart = new Date(appt.start_time);
            status = apptStart > now ? 'booked' : 'in_progress';
            windowStart = appt.start_time;
            if (apptStart > now) {
              etaHeuristic = appt.start_time;
            }
          }
        } else if (intent && intent.state === 'open' && isProtetikai) {
          // Betervezett időpontok (ablak/dátum) csak protetikai fázisban
          const wEnd = intent.window_end ? new Date(intent.window_end) : null;
          if (wEnd && wEnd < now) {
            status = 'overdue';
          } else {
            status = 'projected';
          }
          windowStart = intent.window_start;
          windowEnd = intent.window_end;
          if (intent.window_end) {
            etaHeuristic = intent.window_end;
          }
        } else if (intent && intent.state === 'open' && !isProtetikai) {
          // Nem protetikai: ne mutassunk ablakot/dátumot, csak „tervezett” státusz
          const wEnd = intent.window_end ? new Date(intent.window_end) : null;
          status = wEnd && wEnd < now ? 'overdue' : 'projected';
          windowStart = null;
          windowEnd = null;
        } else {
          status = 'projected';
        }

        steps.push({
          stepCode: ps.step_code,
          stepSeq: seq,
          label: ps.label ?? ps.step_code,
          pool: ps.pool,
          durationMinutes: ps.duration_minutes ?? 30,
          status,
          windowStart,
          windowEnd,
          appointmentId: appt?.id ?? null,
          appointmentStart: appt?.start_time ?? null,
          appointmentStatus: appt?.appointment_status ?? null,
          intentId: intent?.id ?? null,
          intentState: intent?.state ?? null,
        });
      }

      episodes.push({
        episodeId: ep.episode_id,
        patientId: ep.patient_id,
        patientName: ep.patient_name,
        reason: ep.reason,
        status: ep.status,
        openedAt: ep.opened_at,
        carePathwayName: ep.care_pathway_name,
        assignedProviderName: ep.assigned_provider_name,
        treatmentTypeLabel: ep.treatment_type_label,
        steps,
        etaHeuristic,
      });
    }

    // Sort by ETA ascending (earliest deadline first)
    episodes.sort((a, b) => {
      if (!a.etaHeuristic && !b.etaHeuristic) return 0;
      if (!a.etaHeuristic) return 1;
      if (!b.etaHeuristic) return -1;
      return new Date(a.etaHeuristic).getTime() - new Date(b.etaHeuristic).getTime();
    });

    return NextResponse.json({
      episodes,
      meta: {
        serverNow: now.toISOString(),
        fetchedAt: now.toISOString(),
        timezone: 'Europe/Budapest',
        ordering: 'eta_asc',
      },
    });
  } catch (error) {
    return handleApiError(error, 'Hiba történt a kezelési terv idővonal lekérdezésekor');
  }
}
