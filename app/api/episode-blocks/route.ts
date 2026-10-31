import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** All waiting obstacles, including episodes without a treatment pathway. */
export const GET = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async () => {
  const result = await getDbPool().query(
    `SELECT b.id, b.episode_id as "episodeId", b.key, b.active,
       b.waiting_on as "waitingOn", b.waiting_since as "waitingSince",
       b.expected_unblock_date as "expectedUnblockDate", b.expires_at as "expiresAt",
       b.note, b.created_at as "createdAt", b.resolved_at as "resolvedAt",
       b.resolution_note as "resolutionNote", pe.patient_id as "patientId", p.nev as "patientName",
       COALESCE(pe.case_title, pe.chief_complaint) as "episodeTitle",
       pe.assigned_provider_id as "assignedProviderId", u.doktor_neve as "assignedProviderName",
       sc.label_hu as "currentStageLabel"
     FROM episode_blocks b
     JOIN patient_episodes pe ON pe.id = b.episode_id
     JOIN patients p ON p.id = pe.patient_id
     LEFT JOIN users u ON u.id = pe.assigned_provider_id
     LEFT JOIN LATERAL (
       SELECT stage_code FROM stage_events WHERE episode_id = pe.id ORDER BY at DESC LIMIT 1
     ) stage ON true
     LEFT JOIN stage_catalog sc ON sc.code = stage.stage_code AND sc.reason = pe.reason
     WHERE b.active = true AND (b.expires_at IS NULL OR b.expires_at > CURRENT_TIMESTAMP)
       AND pe.status = 'open'
     ORDER BY b.waiting_since ASC, b.id`
  );
  return NextResponse.json({ obstacles: result.rows, serverNow: new Date().toISOString() });
});
