/**
 * Source-level guard tests for `lib/episode-work-phase-revert-lookup.ts`.
 *
 * Az itt definiált helperek tisztázzák az EWP-revert flow-okat (status
 * route + attempt-outcome route közös írási mellékhatása). A tesztek
 * a fájl forrásszintű invariánsaira fókuszálnak (DB nélkül), és
 * regressziós védelmet adnak a fontosabb szemantikai részletekre:
 *
 *   - findEwpForAppointmentRevert a legerősebb-jel sorrendet követi
 *     (workPhaseId > appointment_id-link > code-only),
 *   - revertWorkPhaseLinkToPending mindig UPDATE + audit-pár,
 *     soha nem csak az egyik,
 *   - a probe cache-t használja az inline information_schema helyett.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'lib', 'episode-work-phase-revert-lookup.ts'),
  'utf8'
);

describe('episode-work-phase-revert-lookup — source invariants', () => {
  it('findEwpForAppointmentRevert exportálva', () => {
    expect(SRC).toMatch(/export async function findEwpForAppointmentRevert/);
  });

  it('preferencia-sorrend: workPhaseId → appointment_id-link → code-only', () => {
    // 1. Direct lookup workPhaseId-vel
    expect(SRC).toMatch(/if \(workPhaseId\)/);
    // 2. appointment_id-egyezés bárhol az epizódban
    expect(SRC).toMatch(
      /WHERE episode_id = \$1 AND appointment_id = \$2/
    );
    // 3. Code-only csak ha pontosan 1 találat
    expect(SRC).toMatch(/byCode\.rows\.length === 1/);
  });

  it('multi-step esetben (több azonos work_phase_code) nem tévedünk', () => {
    // A code-only fallback rows.length !== 1 esetén null-t ad vissza,
    // nem csendben kihagyja a revert-et.
    expect(SRC).toMatch(/return null;/);
  });

  it('FOR UPDATE minden olvasó query-n', () => {
    // A helpert tranzakcióban hívjuk; a sorokat zárolni kell, hogy ne
    // legyen TOCTOU race a hívó update-elésével.
    const forUpdateCount = (SRC.match(/FOR UPDATE/g) ?? []).length;
    expect(forUpdateCount).toBeGreaterThanOrEqual(3);
  });

  it('a code-only fallback a probe cache-t használja inline subquery helyett', () => {
    // A korábbi inline `NOT EXISTS (SELECT 1 FROM information_schema.columns ...)`
    // mintát modulszintű cache-re cseréltük (lib/schema-probe.ts), ezért
    // a forráskódban már nem lehet inline subquery.
    expect(SRC).toMatch(/getMergedFilterFragment/);
    expect(SRC).not.toMatch(/SELECT 1 FROM information_schema\.columns/);
  });

  it('revertWorkPhaseLinkToPending mindig UPDATE + audit-pár', () => {
    expect(SRC).toMatch(/export async function revertWorkPhaseLinkToPending/);
    expect(SRC).toMatch(
      /UPDATE episode_work_phases\s+SET status = 'pending', appointment_id = NULL/
    );
    expect(SRC).toMatch(/INSERT INTO episode_work_phase_audit/);
  });
});
