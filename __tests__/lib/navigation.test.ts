import { describe, it, expect } from 'vitest';
import {
  visibleGroups,
  visibleFooter,
  mobileTabs,
  NAV_GROUPS,
  type Role,
} from '@/lib/navigation';

const ALL_ROLES: Role[] = ['admin', 'fogpótlástanász', 'technikus', 'beutalo_orvos'];

function itemIds(role: Role): string[] {
  return visibleGroups(role).flatMap((g) => g.items.map((i) => i.id));
}

describe('navigation registry', () => {
  it('mindenki látja a mindig elérhető elemeket (home, tasks, messages, calendar, waiting-times)', () => {
    for (const role of ALL_ROLES) {
      const ids = itemIds(role);
      expect(ids).toEqual(expect.arrayContaining(['home', 'tasks', 'messages', 'calendar', 'waiting-times']));
    }
  });

  it('admin minden menüpontot lát', () => {
    const ids = itemIds('admin');
    const allIds = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(ids.sort()).toEqual(allIds.sort());
  });

  it('technikus nem lát admin / konzílium / kezelési terv (benne a stádium-GANTT) / időpont-kezelés / leterheltség elemeket, de lát beteg-előkészítést', () => {
    const ids = itemIds('technikus');
    expect(ids).not.toContain('admin');
    expect(ids).not.toContain('admin-stats');
    expect(ids).not.toContain('consilium');
    // A korábbi „Stádium GANTT" oldal beolvadt a „Kezelési tervek"-be (lásd lib/navigation.ts).
    expect(ids).not.toContain('treatment-plans');
    expect(ids).not.toContain('time-slots');
    expect(ids).not.toContain('workload');
    expect(ids).toContain('pipeline');
  });

  it('beutalo_orvos: lát konzíliumot, kezelési tervet, leterheltséget, GANTT-ot, pipeline-t; nem lát admin / időpont-kezelés', () => {
    const ids = itemIds('beutalo_orvos');
    expect(ids).toEqual(expect.arrayContaining(['consilium', 'treatment-plans', 'workload', 'pipeline']));
    expect(ids).not.toContain('admin');
    expect(ids).not.toContain('admin-stats');
    expect(ids).not.toContain('time-slots');
  });

  it('fogpótlástanász látja az időpont-kezelést és az admin (folyamatok) belépőt, de nem a statisztikát', () => {
    const ids = itemIds('fogpótlástanász');
    expect(ids).toContain('time-slots');
    expect(ids).toContain('admin');
    expect(ids).not.toContain('admin-stats');
  });

  it('üres csoportok kiszűrődnek (technikusnál nincs Admin csoport)', () => {
    const groupIds = visibleGroups('technikus').map((g) => g.id);
    expect(groupIds).not.toContain('admin');
    expect(groupIds).not.toContain('konzilium');
  });

  it('mobileTabs minden szerepnél a 3 elsődleges fül (home, calendar, messages)', () => {
    for (const role of ALL_ROLES) {
      expect(mobileTabs(role).map((t) => t.id)).toEqual(['home', 'calendar', 'messages']);
    }
  });

  it('visibleFooter mindenkinek a beállítások és útmutató', () => {
    for (const role of ALL_ROLES) {
      expect(visibleFooter(role).map((i) => i.id)).toEqual(['settings', 'guide']);
    }
  });
});
