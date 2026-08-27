/**
 * Source-level guard tests for `GET/POST /api/episodes/[id]/scheduling-integrity`.
 *
 * Két új violation-típus és a hozzájuk tartozó repair logika védelme:
 *
 *  - EWP_DANGLING_APPOINTMENT_LINK: `ewp.appointment_id` lemondott / sikertelen /
 *    nem létező appointmentre mutat — a worklist BOOKED-matching ezt kiszűri
 *    (SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT), így a step READY-nek látszik,
 *    miközben a partial unique index és egyéb invariánsok drift-elnek.
 *  - APPOINTMENT_STEP_MISMATCH: a foglaláshoz kötött EWP `work_phase_code` / seq
 *    eltér a foglalás `step_code` / `step_seq` snapshot mezőitől — az
 *    `AppointmentBookingSection` badge és a worklist sor különböző címkét
 *    mutat ugyanarra a foglalásra.
 *
 * A repair logika csak ezt a két típust tisztítja, NEM nyúl a slot-hoz és
 * nem lép túl az audit-on.
 *
 * WP-1.2: a detektálás/javítás implementáció a `lib/scheduling-integrity.ts`
 * fájlba költözött (az automatikus szerveroldali javítás is onnan fut), a
 * route vékony wrapper maradt. A guardok változatlanok — a SRC a route és a
 * lib összefűzése, így minden korábbi assertion ugyanazt a védelmet adja.
 * Az auto-repair VISELKEDÉSÉT a
 * `__tests__/integration/scheduling-integrity-auto-repair.test.ts` fedi.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTE_SRC = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'app',
    'api',
    'episodes',
    '[id]',
    'scheduling-integrity',
    'route.ts'
  ),
  'utf8'
);

const LIB_SRC = readFileSync(
  join(__dirname, '..', '..', 'lib', 'scheduling-integrity.ts'),
  'utf8'
);

const SRC = `${ROUTE_SRC}\n${LIB_SRC}`;

describe('scheduling-integrity route — új violation-típusok (GET)', () => {
  it('EWP_DANGLING_APPOINTMENT_LINK detektálás', () => {
    expect(SRC).toMatch(/EWP_DANGLING_APPOINTMENT_LINK/);
    expect(SRC).toMatch(/SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT/);
    // A dangling-lekérdezés LEFT JOIN-ja a visible-filterrel
    expect(SRC).toMatch(/LEFT JOIN appointments a ON a\.id = ewp\.appointment_id/);
    expect(SRC).toMatch(/a\.id IS NULL\s*OR NOT \$\{SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT\}/);
  });

  it('APPOINTMENT_STEP_MISMATCH detektálás', () => {
    expect(SRC).toMatch(/APPOINTMENT_STEP_MISMATCH/);
    // Csak AKTÍV appointmentre nézi a mismatch-et
    expect(SRC).toMatch(/SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT/);
    expect(SRC).toMatch(/a\.step_code IS DISTINCT FROM ewp\.work_phase_code/);
    expect(SRC).toMatch(/a\.step_seq IS DISTINCT FROM ewp\.pathway_order_index/);
  });

  it('mindkét új violation repairable-ként jelöli magát', () => {
    const danglingBlock = SRC.match(
      /kind:\s*'EWP_DANGLING_APPOINTMENT_LINK'[\s\S]*?repairable:\s*true/
    );
    expect(danglingBlock, 'EWP_DANGLING_APPOINTMENT_LINK nincs repairable-nek jelölve').toBeTruthy();
    const mismatchBlock = SRC.match(
      /kind:\s*'APPOINTMENT_STEP_MISMATCH'[\s\S]*?repairable:\s*true/
    );
    expect(mismatchBlock, 'APPOINTMENT_STEP_MISMATCH nincs repairable-nek jelölve').toBeTruthy();
  });
});

describe('scheduling-integrity route — POST repair', () => {
  it('POST role-guarded (admin / beutalo_orvos / fogpótlástanász)', () => {
    expect(SRC).toMatch(
      /roleHandler\(\s*\[\s*'admin'\s*,\s*'beutalo_orvos'\s*,\s*'fogpótlástanász'\s*\]/
    );
  });

  it('dangling sorok takarítása audit-tal', () => {
    expect(SRC).toMatch(/integrity repair: dangling appointment_id takarítása/);
    expect(SRC).toMatch(/UPDATE episode_work_phases\s+SET appointment_id = NULL/);
    // MINDEN tényleges link-nullázás auditot ír (státusztól függetlenül),
    // dedikált change_type-pal — a sor-jelzés erre szűr, nem reason-prefixre.
    expect(SRC).toMatch(/changeType:\s*'integrity_repair'/);
  });

  it('step-mismatch javítás: az EWP az SSOT a step_code-hoz', () => {
    // A snapshot (appointments.step_code) átírása az EWP work_phase_code-ra
    expect(SRC).toMatch(
      /UPDATE appointments a\s+SET step_code = \$1, step_seq = \$2, work_phase_id = \$3/
    );
  });

  it('re-check a tranzakción belül — concurrent hívás védelme', () => {
    // Minden dangling sorra re-checkel, hogy még mindig stale-e
    expect(SRC).toMatch(/SELECT ewp\.appointment_id AS "appointmentId"/);
    expect(SRC).toMatch(/isAppointmentActive\(current\.appointmentStatus\)/);
    // Minden mismatch sorra re-checkel, hogy még mindig mismatch-e
    expect(SRC).toMatch(/stillMismatch/);
  });

  it('versenyhelyzet-őr: a recheck zárol (FOR UPDATE), az UPDATE WHERE-je guardolt', () => {
    // Dangling recheck: a munkafázis-sor zárolása (READ COMMITTED alatt az
    // in-flight foglalási tranzakció commitjáig vár, majd friss értéket lát)
    expect(SRC).toMatch(/FOR UPDATE OF ewp(?!,)/);
    // Mismatch recheck: EWP + appointment sor együtt zárolva
    expect(SRC).toMatch(/FOR UPDATE OF ewp, a/);
    // A dangling UPDATE WHERE-je a link-egyezést ÉS a stale állapotot is
    // újra megköveteli — EPQ alatt sem nullázhat friss, aktív linket
    expect(SRC).toMatch(
      /WHERE id = \$1\s+AND appointment_id = \$2\s+AND NOT EXISTS/
    );
    // A számlálók a tényleges UPDATE rowCount-ján alapulnak
    expect(SRC).toMatch(/\(updated\.rowCount \?\? 0\) === 0/);
  });

  it('multi-link (több EWP → egy aktív appointment): nem auto-javítható', () => {
    // A mismatch-select kizárja a több-linkes appointmenteket (flip-flop tilos)
    expect(SRC).toMatch(/MISMATCH_MULTI_LINK_EXCLUSION/);
    expect(SRC).toMatch(/other\.appointment_id = ewp\.appointment_id/);
    // Külön violation-kind, repairable: false — admin maradék-listára kerül
    const multiBlock = SRC.match(
      /kind:\s*'MULTI_EWP_APPOINTMENT_LINK'[\s\S]*?repairable:\s*false/
    );
    expect(multiBlock, 'MULTI_EWP_APPOINTMENT_LINK nincs nem-javíthatónak jelölve').toBeTruthy();
    // A repair mismatch-ága recheck-kor is kihagyja, ha időközben multi lett
    expect(SRC).toMatch(/current\.linkCount > 1/);
  });

  it('activity log + scheduling event a commit után', () => {
    expect(SRC).toMatch(/episode_integrity_repaired/);
    expect(SRC).toMatch(/'integrity_repaired'/);
  });

  it('üres (nincs mit javítani) esetben nem nyit tranzakciót', () => {
    expect(SRC).toMatch(
      /dangling\.rows\.length === 0\s*&&\s*mismatch\.rows\.length === 0/
    );
  });
});
