/**
 * Stádium-igazítás a munkafázisokhoz — a klinikai szabály betartatása a sim
 * adaton: STAGE_5 ELŐTT csak konzultáció lehet kiadott időpont; a munkafázisok
 * (munka-pool lépések) csak STAGE_5-től léteznek.
 *
 * Minden nyitott epizódnál:
 *   - a STAGE_5-öt az ELSŐ kiadott munka-pool időponthoz keltezzük (múltbeli →
 *     az első ilyen időpont elé; csak jövőbeli munkafázis → ~most, mert a tervet
 *     már aktiválták a foglaláshoz),
 *   - a konzultációs időpont(ok)at a STAGE_5 elé keltezzük (pre-protetikai ablak),
 *   - STAGE_0 az epizód nyitásakor, STAGE_2 (árajánlatra vár) a konzultáció után,
 *   - STAGE_6, ha az „Átadás" (delivery) munkafázis teljesült,
 *   - ha NINCS kiadott munka-pool időpont (csak konzultáció / tervezett intent),
 *     az epizód pre-STAGE_5 marad (STAGE_2) — a konzultáció látszik az idővonalon.
 *
 * Idempotens: a stage_events-et minden futáskor újraírja. Meghívja a
 * treatment-plan-scenarios.ts a seedelés végén; önállóan is futtatható:
 *   npx tsx scripts/sim/align-stages.ts
 */
import type { Pool } from 'pg';

const DAY = 86_400_000;

export interface AlignedEpisode {
  episodeId: string;
  current: string;
  stage5: string | null;
}

export async function alignStagesToWorkPhases(pool: Pool, nowMs = Date.now()): Promise<AlignedEpisode[]> {
  const eps = (await pool.query(`SELECT id, opened_at FROM patient_episodes WHERE status = 'open'`)).rows as {
    id: string;
    opened_at: string | Date;
  }[];
  const out: AlignedEpisode[] = [];

  for (const ep of eps) {
    const opened = new Date(ep.opened_at).getTime();
    const appts = (
      await pool.query(
        `SELECT a.id, a.pool, a.start_time, a.time_slot_id, a.appointment_status
           FROM appointments a
          WHERE a.episode_id = $1
            AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_doctor','cancelled_by_patient'))
          ORDER BY a.start_time ASC NULLS LAST`,
        [ep.id]
      )
    ).rows as { id: string; pool: string; start_time: string; time_slot_id: string | null; appointment_status: string | null }[];

    const consults = appts.filter((a) => a.pool === 'consult');
    const works = appts
      .filter((a) => a.pool === 'work' && a.start_time)
      .map((a) => ({ ...a, t: new Date(a.start_time).getTime() }))
      .sort((x, y) => x.t - y.t);

    // STAGE_5 dátuma: az első KIADOTT munka-pool időponthoz kötve.
    let stage5: number | null = null;
    if (works.length) {
      const past = works.filter((w) => w.t < nowMs);
      stage5 = past.length ? past[0].t - 2 * DAY : nowMs - 3 * DAY;
    }

    // Konzultáció a STAGE_5 (ill. a legkorábbi munkafázis / most) ELÉ.
    const earliestWork = works.length ? works[0].t : null;
    const upper = stage5 ?? earliestWork ?? nowMs;
    let consultDate = opened + 5 * DAY;
    if (consultDate >= upper) consultDate = upper - 5 * DAY;
    if (consultDate <= opened) consultDate = opened + DAY;

    // Konzultációs időpont(ok) átkeltezése a pre-STAGE_5 ablakba.
    for (let i = 0; i < consults.length; i++) {
      const iso = new Date(consultDate + i * DAY).toISOString();
      await pool.query(`UPDATE appointments SET start_time = $2 WHERE id = $1`, [consults[i].id, iso]);
      if (consults[i].time_slot_id) {
        await pool.query(`UPDATE available_time_slots SET start_time = $2 WHERE id = $1`, [consults[i].time_slot_id, iso]);
      }
      await pool.query(
        `UPDATE episode_work_phases SET completed_at = $2 WHERE appointment_id = $1 AND status = 'completed'`,
        [consults[i].id, iso]
      );
    }

    // stage_events újraírása.
    await pool.query(`DELETE FROM stage_events WHERE episode_id = $1`, [ep.id]);
    const ins = (code: string, atMs: number) =>
      pool.query(
        `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, created_by)
         SELECT patient_id, $1, $2, $3, 'sim-align' FROM patient_episodes WHERE id = $1`,
        [ep.id, code, new Date(atMs).toISOString()]
      );

    await ins('STAGE_0', opened);
    let current = 'STAGE_0';

    // STAGE_2 (árajánlatra vár) a konzultáció után, a STAGE_5 előtt — csak ha
    // tényleg volt konzultáció (enélkül a beteg STAGE_0 „új beteg" marad).
    const stage2 = Math.min(consultDate + 7 * DAY, (stage5 ?? nowMs) - DAY);
    if (consults.length > 0 && stage2 > opened) {
      await ins('STAGE_2', stage2);
      current = 'STAGE_2';
    }

    if (stage5 != null) {
      await ins('STAGE_5', stage5);
      current = 'STAGE_5';
    }

    // STAGE_6, ha az átadás teljesült.
    const delivered = (
      await pool.query(
        `SELECT a.start_time FROM appointments a
           JOIN episode_work_phases ewp ON ewp.appointment_id = a.id
          WHERE a.episode_id = $1 AND ewp.work_phase_code = 'delivery' AND a.appointment_status = 'completed'
          LIMIT 1`,
        [ep.id]
      )
    ).rows[0] as { start_time: string } | undefined;
    if (delivered) {
      await ins('STAGE_6', new Date(delivered.start_time).getTime());
      current = 'STAGE_6';
    }

    out.push({ episodeId: ep.id, current, stage5: stage5 ? new Date(stage5).toISOString().slice(0, 10) : null });
  }

  return out;
}

// Önálló futtatás.
if (process.argv[1] && process.argv[1].endsWith('align-stages.ts')) {
  (async () => {
    await import('./load-sim-env');
    await import('./assert-sim-db');
    const { getDbPool } = await import('../../lib/db');
    const pool = getDbPool();
    const res = await alignStagesToWorkPhases(pool);
    const byCur: Record<string, number> = {};
    for (const r of res) byCur[r.current] = (byCur[r.current] ?? 0) + 1;
    console.log(`Igazítva ${res.length} epizód. Aktuális stádiumok:`, JSON.stringify(byCur));
    await pool.end();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
