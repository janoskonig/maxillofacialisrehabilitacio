/**
 * WP-2.2 — a változásnapló magyar összefoglalója (lib/plan-history.ts).
 *
 * A fordítás egy helyen él; ez a teszt fedi a change_type-onkénti ágakat,
 * a státusz-váltás finomításait és a törölt fázis snapshot-feloldását.
 */
import { describe, expect, it } from 'vitest';
import { formatPlanHistorySummary, mapPlanHistoryRow } from '@/lib/plan-history';

function summary(
  changeType: string,
  opts: { oldStatus?: string | null; newStatus?: string | null; phaseLabel?: string | null } = {}
): string {
  return formatPlanHistorySummary({
    changeType,
    oldStatus: opts.oldStatus ?? null,
    newStatus: opts.newStatus ?? null,
    phaseLabel: 'phaseLabel' in opts ? (opts.phaseLabel ?? null) : 'Koronapróba',
  });
}

describe('formatPlanHistorySummary', () => {
  it('change_type-onkénti összefoglalók', () => {
    expect(summary('create', { newStatus: 'pending' })).toBe('hozzáadta: Koronapróba');
    expect(summary('delete', { oldStatus: 'pending', newStatus: 'deleted' })).toBe(
      'elhagyta: Koronapróba'
    );
    expect(summary('merge')).toBe('összevonta: Koronapróba');
    expect(summary('unmerge')).toBe('szétbontotta: Koronapróba');
    expect(summary('timing_change')).toBe('időzítését módosította: Koronapróba');
    expect(summary('template_apply', { newStatus: 'pending' })).toBe(
      'sablon alkalmazva: Koronapróba'
    );
    expect(summary('template_remove', { newStatus: 'deleted' })).toBe(
      'sablon eltávolítva: Koronapróba'
    );
    expect(summary('integrity_repair')).toBe('automatikus javítás: Koronapróba');
  });

  it('reorder: epizód-szintű sor, fázis-név nélkül', () => {
    expect(summary('reorder', { phaseLabel: null })).toBe('átrendezte a tervet');
  });

  it('integrity_repair fázis-snapshot nélkül is olvasható', () => {
    expect(summary('integrity_repair', { phaseLabel: null })).toBe('automatikus javítás');
  });

  it('status_change: a gyakori átmenetek saját igét kapnak', () => {
    expect(summary('status_change', { oldStatus: 'pending', newStatus: 'completed' })).toBe(
      'késznek jelölte: Koronapróba'
    );
    expect(summary('status_change', { oldStatus: 'pending', newStatus: 'skipped' })).toBe(
      'kihagyta: Koronapróba'
    );
    expect(summary('status_change', { oldStatus: 'skipped', newStatus: 'pending' })).toBe(
      'visszavette a tervbe: Koronapróba'
    );
    expect(summary('status_change', { oldStatus: 'completed', newStatus: 'pending' })).toBe(
      'újranyitotta: Koronapróba'
    );
    expect(summary('status_change', { oldStatus: 'pending', newStatus: 'scheduled' })).toBe(
      'időpontot kapott: Koronapróba'
    );
    expect(summary('status_change', { oldStatus: 'scheduled', newStatus: 'pending' })).toBe(
      'foglalása felszabadult: Koronapróba'
    );
  });

  it('status_change: ismeretlen átmenet a nyers, magyarított párra esik vissza', () => {
    expect(summary('status_change', { oldStatus: 'pending', newStatus: 'valami_uj' })).toBe(
      'állapota módosult: Koronapróba (várakozik → valami_uj)'
    );
  });

  it('ismeretlen change_type is olvasható marad', () => {
    expect(summary('uj_muvelet')).toBe('módosította: Koronapróba');
    expect(summary('uj_muvelet', { phaseLabel: null })).toBe('módosította a tervet');
  });
});

describe('mapPlanHistoryRow', () => {
  const baseRow = {
    id: 'a1',
    created_at: new Date('2026-08-20T14:12:00Z'),
    changed_by: 'doktor@example.com',
    changed_by_name: 'Dr. Kiss Anna' as string | null,
    change_type: 'delete',
    old_status: 'pending' as string | null,
    new_status: 'deleted' as string | null,
    work_phase_code: 'koronaproba' as string | null,
    custom_label: null as string | null,
    catalog_label: 'Koronapróba' as string | null,
    reason: '2 foglalás lemondva' as string | null,
  };

  it('feloldott név + fázis-címke prioritás: custom_label → katalógus → kód', () => {
    const entry = mapPlanHistoryRow(baseRow);
    expect(entry.changedBy).toBe('Dr. Kiss Anna');
    expect(entry.phaseLabel).toBe('Koronapróba');
    expect(entry.summary).toBe('elhagyta: Koronapróba');
    expect(entry.createdAt).toBe('2026-08-20T14:12:00.000Z');
    expect(entry.reason).toBe('2 foglalás lemondva');

    expect(
      mapPlanHistoryRow({ ...baseRow, custom_label: 'Egyedi címke' }).phaseLabel
    ).toBe('Egyedi címke');
    expect(mapPlanHistoryRow({ ...baseRow, catalog_label: null }).phaseLabel).toBe('koronaproba');
  });

  it('rendszer-azonosító changed_by nyersen marad, ha nincs feloldás', () => {
    const entry = mapPlanHistoryRow({
      ...baseRow,
      changed_by: 'auto-repair (doktor@example.com)',
      changed_by_name: null,
      change_type: 'integrity_repair',
    });
    expect(entry.changedBy).toBe('auto-repair (doktor@example.com)');
    expect(entry.summary).toBe('automatikus javítás: Koronapróba');
  });

  it('törölt fázis tombstone: snapshot nélküli (084 előtti) sor is olvasható', () => {
    const entry = mapPlanHistoryRow({
      ...baseRow,
      work_phase_code: null,
      custom_label: null,
      catalog_label: null,
    });
    expect(entry.phaseLabel).toBeNull();
    expect(entry.summary).toBe('elhagyta: ismeretlen fázis');
  });
});
