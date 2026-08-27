import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getDbPool } from '@/lib/db';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import type { PlanHistoryEntry } from '@/lib/plan-history';
import { GET as getPlanHistory } from '@/app/api/episodes/[id]/plan-history/route';
import { POST as createWorkPhase } from '@/app/api/episodes/[id]/work-phases/route';
import {
  PATCH as patchWorkPhase,
  DELETE as deleteWorkPhase,
} from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { PATCH as reorderWorkPhases } from '@/app/api/episodes/[id]/work-phases/reorder/route';
import { POST as mergeWorkPhases } from '@/app/api/episodes/[id]/work-phases/merge/route';

/**
 * WP-2.2 — GET /api/episodes/:id/plan-history.
 *
 * A WP-2.1 tesztje (work-phase-audit-mutations) a TÁBLÁT fedi; ez a teszt az
 * ENDPOINTOT: időrendben csökkenő sorrend, lapozás (limit+offset, count,
 * hasMore), changed_by feloldás emberi névre, törölt fázis snapshot-
 * megjelenítés és a magyar summary. Viselkedési teszt: a valódi mutáló
 * route-okon át keletkezik a napló, majd a valódi GET handlert hívjuk.
 */

const WP22_CATALOG_CODE = 'wp22_proba_fazis';

afterEach(async () => {
  await getDbPool().query(`DELETE FROM work_phase_catalog WHERE work_phase_code = $1`, [
    WP22_CATALOG_CODE,
  ]);
  await cleanupCreated();
});

async function makeDoctor(doktorNeve: string): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász', doktorNeve });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

async function callPlanHistory(
  episodeId: string,
  user: TestAuthUser,
  query = ''
): Promise<{ status: number; body: { entries: PlanHistoryEntry[]; count: number; limit: number; offset: number; hasMore: boolean } }> {
  const req = await authedRequest(
    `http://test.local/api/episodes/${episodeId}/plan-history${query}`,
    { user }
  );
  const res = await getPlanHistory(req, { params: { id: episodeId } });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/episodes/:id/plan-history (WP-2.2)', () => {
  it('6 mutáció után 6 sor időrendben csökkenő sorrendben, helyes change_type-pal; a törölt fázis sora olvasható; lapozás és count helyes', async () => {
    const doctor = await makeDoctor('Dr. Kiss Anna');
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const pool = getDbPool();

    // Katalógus-címke a feloldás teszteléséhez (a teszt-DB katalógusa üres).
    await pool.query(
      `INSERT INTO work_phase_catalog (work_phase_code, label_hu, is_active)
       VALUES ($1, 'Próbafázis (WP-2.2)', true)
       ON CONFLICT (work_phase_code) DO UPDATE SET label_hu = EXCLUDED.label_hu`,
      [WP22_CATALOG_CODE]
    );

    // Seed (factory, audit nélkül): két meglévő fázis.
    const x = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: WP22_CATALOG_CODE,
      seq: 0,
      durationMinutes: 30,
    });
    const y = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'atadas',
      seq: 1,
    });

    // 1. LÉTREHOZÁS (szabadszöveges).
    const createReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases`,
      { user: doctor, method: 'POST', body: { label: 'Egyedi köztes fázis' } }
    );
    const createRes = await createWorkPhase(createReq, { params: { id: episode.id } });
    expect(createRes.status).toBe(201);
    const zId: string = (await createRes.json()).workPhase.id;

    // 2. IDŐZÍTÉS-MÓDOSÍTÁS (X: 30 → 55 perc).
    const timingReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${x.id}`,
      { user: doctor, method: 'PATCH', body: { durationMinutes: 55 } }
    );
    expect(
      (await patchWorkPhase(timingReq, { params: { id: episode.id, workPhaseId: x.id } })).status
    ).toBe(200);

    // 3. ÁTRENDEZÉS ([X, Y, Z] → [Z, X, Y]).
    const reorderReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/reorder`,
      { user: doctor, method: 'PATCH', body: { stepIds: [zId, x.id, y.id] } }
    );
    expect((await reorderWorkPhases(reorderReq, { params: { id: episode.id } })).status).toBe(200);

    // 4. ÖSSZEVONÁS (Y beolvasztása X alá).
    const mergeReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/merge`,
      { user: doctor, method: 'POST', body: { stepIds: [x.id, y.id] } }
    );
    expect((await mergeWorkPhases(mergeReq, { params: { id: episode.id } })).status).toBe(200);

    // 5. STÁTUSZ-VÁLTÁS (X: pending → completed).
    const statusReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${x.id}`,
      { user: doctor, method: 'PATCH', body: { status: 'completed' } }
    );
    expect(
      (await patchWorkPhase(statusReq, { params: { id: episode.id, workPhaseId: x.id } })).status
    ).toBe(200);

    // 6. TÖRLÉS (Z — az 1-ben létrehozott szabadszöveges fázis).
    const deleteReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${zId}`,
      { user: doctor, method: 'DELETE' }
    );
    expect(
      (await deleteWorkPhase(deleteReq, { params: { id: episode.id, workPhaseId: zId } })).status
    ).toBe(200);

    // ── A GET: teljes lista, csökkenő időrendben ──────────────────────────
    const full = await callPlanHistory(episode.id, doctor);
    expect(full.status).toBe(200);
    expect(full.body.count).toBe(6);
    expect(full.body.entries).toHaveLength(6);
    expect(full.body.hasMore).toBe(false);

    // Időrendben CSÖKKENŐ: a legutóbbi mutáció (törlés) az első.
    expect(full.body.entries.map((e) => e.changeType)).toEqual([
      'delete',
      'status_change',
      'merge',
      'reorder',
      'timing_change',
      'create',
    ]);
    const timestamps = full.body.entries.map((e) => new Date(e.createdAt).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
    }

    // changed_by feloldás: a doktor e-mailje helyett a doktor_neve jelenik meg.
    for (const entry of full.body.entries) {
      expect(entry.changedBy).toBe('Dr. Kiss Anna');
    }

    // Törölt fázis sora a snapshotból olvasható (FK már NULL, a címke él).
    const deleteEntry = full.body.entries[0];
    expect(deleteEntry.phaseLabel).toBe('Egyedi köztes fázis');
    expect(deleteEntry.summary).toBe('elhagyta: Egyedi köztes fázis');
    expect(deleteEntry.newStatus).toBe('deleted');
    expect(deleteEntry.reason).toContain('törölve');
    // A create sor is a tombstone-snapshotból oldódik fel (a Z már nem él).
    const createEntry = full.body.entries[5];
    expect(createEntry.changeType).toBe('create');
    expect(createEntry.phaseLabel).toBe('Egyedi köztes fázis');
    expect(createEntry.summary).toBe('hozzáadta: Egyedi köztes fázis');

    // Katalógus-címke feloldás: az X kódja a katalógusból kap magyar nevet.
    const timingEntry = full.body.entries[4];
    expect(timingEntry.workPhaseCode).toBe(WP22_CATALOG_CODE);
    expect(timingEntry.phaseLabel).toBe('Próbafázis (WP-2.2)');
    expect(timingEntry.summary).toBe('időzítését módosította: Próbafázis (WP-2.2)');

    // Epizód-szintű reorder-sor: nincs fázis, a summary mégis mond valamit.
    const reorderEntry = full.body.entries[3];
    expect(reorderEntry.phaseLabel).toBeNull();
    expect(reorderEntry.summary).toBe('átrendezte a tervet');

    // ── Lapozás: 4+2, átfedés és kihagyás nélkül ─────────────────────────
    const page1 = await callPlanHistory(episode.id, doctor, '?limit=4&offset=0');
    expect(page1.body.entries).toHaveLength(4);
    expect(page1.body.count).toBe(6);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.limit).toBe(4);

    const page2 = await callPlanHistory(episode.id, doctor, '?limit=4&offset=4');
    expect(page2.body.entries).toHaveLength(2);
    expect(page2.body.offset).toBe(4);
    expect(page2.body.hasMore).toBe(false);

    const pagedIds = [...page1.body.entries, ...page2.body.entries].map((e) => e.id);
    expect(pagedIds).toEqual(full.body.entries.map((e) => e.id));
  });

  it('rendszer-azonosító changed_by (auto-repair) nyersen marad, nem oldódik fel', async () => {
    const doctor = await makeDoctor('Dr. Rendszer Teszt');
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const phase = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
    });

    // Így ír a scheduling-integrity auto-repair (WP-1.2): rendszer-azonosítóval.
    await insertWorkPhaseAudit(getDbPool(), {
      episodeWorkPhaseId: phase.id,
      episodeId: episode.id,
      oldStatus: 'scheduled',
      newStatus: 'scheduled',
      changedBy: `auto-repair (${doctor.email})`,
      changeType: 'integrity_repair',
      reason: 'Stale foglalás-link nullázva',
    });

    const res = await callPlanHistory(episode.id, doctor);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const entry = res.body.entries[0];
    expect(entry.changedBy).toBe(`auto-repair (${doctor.email})`);
    expect(entry.changeType).toBe('integrity_repair');
    expect(entry.summary).toBe('automatikus javítás: lenyomat');
    expect(entry.reason).toBe('Stale foglalás-link nullázva');
  });

  it('nemlétező epizódra 404, hitelesítés nélkül 401', async () => {
    const doctor = await makeDoctor('Dr. Négyszáznégy');
    const ghostId = '00000000-0000-4000-8000-000000000000';
    const notFound = await callPlanHistory(ghostId, doctor);
    expect(notFound.status).toBe(404);

    const anonReq = new NextRequest(`http://test.local/api/episodes/${ghostId}/plan-history`);
    const anonRes = await getPlanHistory(anonReq, { params: { id: ghostId } });
    expect(anonRes.status).toBe(401);
  });
});
