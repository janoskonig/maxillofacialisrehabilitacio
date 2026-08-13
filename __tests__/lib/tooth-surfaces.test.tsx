import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  surfaceForRegion,
  regionForSurface,
  surfaceLabel,
  cycleSurfaceMark,
  setSurface,
  readSurfaces,
  describeSurfaces,
  SURFACE_MARK_COLORS,
} from '@/components/patient-form/odontogram/tooth-surfaces';
import { ToothShapeChart } from '@/components/patient-form/odontogram/ToothShapeChart';
import { ToothShape } from '@/components/patient-form/odontogram/ToothShape';
import {
  readConditions,
  writeConditions,
  hasCaries,
  computeDMFT,
  supportsSurfaces,
} from '@/components/patient-form/odontogram/tooth-conditions';
import { ToothSurfacePicker } from '@/components/patient-form/odontogram/ToothSurfacePicker';
import { applyTreatmentOutcome } from '@/lib/tooth-treatment-outcome';

describe('felszín ↔ rajz-régió leképezés', () => {
  it('a jobb oldali kvadránsokban (1/4/5/8) a meziális felszín a jobb oldali mező', () => {
    for (const fdi of [16, 11, 46, 41, 55, 85]) {
      expect(surfaceForRegion(fdi, 'right')).toBe('mesial');
      expect(surfaceForRegion(fdi, 'left')).toBe('distal');
      expect(regionForSurface(fdi, 'mesial')).toBe('right');
    }
  });

  it('a bal oldali kvadránsokban (2/3/6/7) fordítva', () => {
    for (const fdi of [21, 26, 31, 36, 65, 75]) {
      expect(surfaceForRegion(fdi, 'left')).toBe('mesial');
      expect(surfaceForRegion(fdi, 'right')).toBe('distal');
      expect(regionForSurface(fdi, 'distal')).toBe('right');
    }
  });

  it('a gyökér felőli mező mindig vesztibuláris, a szemközti orális', () => {
    for (const fdi of [16, 26, 36, 46]) {
      expect(surfaceForRegion(fdi, 'top')).toBe('vestibular');
      expect(surfaceForRegion(fdi, 'bottom')).toBe('oral');
    }
  });

  it('a leképezés oda-vissza konzisztens', () => {
    for (const fdi of [18, 13, 24, 35, 41]) {
      for (const region of ['top', 'bottom', 'left', 'right', 'center'] as const) {
        expect(regionForSurface(fdi, surfaceForRegion(fdi, region))).toBe(region);
      }
    }
  });
});

describe('felszín-nevek', () => {
  it('fronton labiális/incizális, oldalt bukkális/okkluzális', () => {
    expect(surfaceLabel(11, 'vestibular')).toBe('Labiális');
    expect(surfaceLabel(11, 'occlusal')).toBe('Incizális');
    expect(surfaceLabel(16, 'vestibular')).toBe('Bukkális');
    expect(surfaceLabel(16, 'occlusal')).toBe('Okkluzális');
  });

  it('felül palatinális, alul lingvális', () => {
    expect(surfaceLabel(16, 'oral')).toBe('Palatinális');
    expect(surfaceLabel(46, 'oral')).toBe('Lingvális');
  });
});

describe('jelölés-ciklus', () => {
  it('ép → szuvas → tömött → ép', () => {
    expect(cycleSurfaceMark(undefined)).toBe('caries');
    expect(cycleSurfaceMark('caries')).toBe('filling');
    expect(cycleSurfaceMark('filling')).toBeUndefined();
  });

  it('a setSurface nem módosítja az eredeti térképet', () => {
    const before = { occlusal: 'caries' as const };
    const after = setSurface(before, 'mesial', 'filling');
    expect(before).toEqual({ occlusal: 'caries' });
    expect(after).toEqual({ occlusal: 'caries', mesial: 'filling' });
    expect(setSurface(after, 'occlusal', undefined)).toEqual({ mesial: 'filling' });
  });
});

describe('tárolás', () => {
  it('a felszíneket megőrzi az oda-vissza alakításban', () => {
    const stored = writeConditions({
      base: 'sound',
      caries: false,
      periapical: false,
      mobility: 0,
      surfaces: { occlusal: 'caries', mesial: 'filling' },
    });
    expect(stored).toEqual({ base: 'sound', surfaces: { occlusal: 'caries', mesial: 'filling' } });
    expect(readConditions(stored).surfaces).toEqual({ occlusal: 'caries', mesial: 'filling' });
  });

  it('üres felszín-térképnél az ép fog továbbra is törlődik', () => {
    expect(
      writeConditions({ base: 'sound', caries: false, periapical: false, mobility: 0, surfaces: {} })
    ).toBeUndefined();
  });

  it('hiányzó fogon nem tárol felszín-adatot', () => {
    expect(
      writeConditions({
        base: 'missing',
        caries: false,
        periapical: false,
        mobility: 0,
        surfaces: { occlusal: 'caries' },
      })
    ).toEqual({ base: 'missing' });
    expect(supportsSurfaces('missing')).toBe(false);
    expect(supportsSurfaces('sound')).toBe(true);
  });

  it('érvénytelen tárolt értékeket kiszűr', () => {
    expect(readSurfaces({ occlusal: 'caries', bogus: 'caries', mesial: 'valami' })).toEqual({
      occlusal: 'caries',
    });
    expect(readSurfaces(null)).toEqual({});
  });
});

describe('származtatott állapot', () => {
  it('a felszín-szintű szuvasodás a fogat is szuvassá teszi', () => {
    const c = readConditions({ base: 'sound', surfaces: { mesial: 'caries' } });
    expect(c.caries).toBe(false);
    expect(hasCaries(c)).toBe(true);
  });

  it('a DMF-T a felszín-szintű adatot is beszámítja', () => {
    const dmft = computeDMFT({
      '11': { base: 'sound', surfaces: { occlusal: 'caries' } },
      '12': { base: 'sound', surfaces: { occlusal: 'filling' } },
      '13': { base: 'missing' },
      '14': { base: 'sound' },
    });
    expect(dmft).toEqual({ d: 1, m: 1, f: 1, dmft: 3 });
  });

  it('szöveges összefoglalót ad', () => {
    expect(describeSurfaces(16, { occlusal: 'caries', mesial: 'filling' })).toBe(
      'szuvas: okkluzális · tömött: meziális'
    );
  });
});

describe('kezelés-kimenet', () => {
  it('a tömés a szuvas felszínekből tömött felszínt csinál', () => {
    const { next } = applyTreatmentOutcome(
      { base: 'sound', surfaces: { occlusal: 'caries', mesial: 'filling' } },
      'tomes'
    );
    expect(next).toEqual({ base: 'filled', surfaces: { occlusal: 'filling', mesial: 'filling' } });
  });

  it('extrakció / korona után nincs felszín-adat', () => {
    expect(applyTreatmentOutcome({ base: 'sound', surfaces: { occlusal: 'caries' } }, 'huzas').next).toEqual({
      base: 'missing',
    });
    expect(applyTreatmentOutcome({ base: 'sound', surfaces: { occlusal: 'caries' } }, 'korona').next).toEqual({
      base: 'crown',
    });
  });

  it('gyökérkezelés megtartja a felszín-jelöléseket', () => {
    expect(
      applyTreatmentOutcome({ base: 'sound', surfaces: { occlusal: 'caries' } }, 'gyokerkezeles').next
    ).toEqual({ base: 'root_canal', surfaces: { occlusal: 'caries' } });
  });
});

describe('megjelenítés', () => {
  const base = { caries: false, periapical: false, mobility: 0 } as const;

  function fills(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('path, rect'))
      .map((el) => el.getAttribute('fill') || '')
      .filter(Boolean);
  }

  it('a fog-szintű szuvas-jelző csak a keretet festi (a régi adat rajza változatlan)', () => {
    const { container } = render(
      <svg viewBox="0 0 28 40">
        <ToothShapeChart fdi={16} conditions={{ ...base, base: 'sound', caries: true }} />
      </svg>
    );
    const painted = fills(container);
    expect(painted.filter((f) => f === SURFACE_MARK_COLORS.caries)).toHaveLength(4); // 4 keret-trapéz
    expect(painted).toContain('#F7F5EA'); // a középső mező elefántcsont marad
  });

  it('a tömött alapállapot színe megmarad a középső mezőn másik felszín jelölésekor', () => {
    const { container } = render(
      <svg viewBox="0 0 28 40">
        <ToothShapeChart
          fdi={16}
          conditions={{ ...base, base: 'filled', surfaces: { mesial: 'filling' } }}
        />
      </svg>
    );
    expect(fills(container).filter((f) => f === SURFACE_MARK_COLORS.filling).length).toBeGreaterThanOrEqual(2);
  });

  it('a felszín-jelölés felülírja az alapállapot színét a saját mezőjén', () => {
    const { container } = render(
      <svg viewBox="0 0 28 40">
        <ToothShapeChart
          fdi={16}
          conditions={{ ...base, base: 'filled', surfaces: { occlusal: 'caries' } }}
        />
      </svg>
    );
    expect(fills(container)).toContain(SURFACE_MARK_COLORS.caries);
  });

  it('az egyszerű nézet a felszín-szintű tömést és szuvasodást is jelzi', () => {
    const sound = render(
      <svg viewBox="0 0 28 40">
        <ToothShape fdi={16} conditions={{ ...base, base: 'sound' }} />
      </svg>
    ).container.innerHTML;
    const withFilling = render(
      <svg viewBox="0 0 28 40">
        <ToothShape fdi={16} conditions={{ ...base, base: 'sound', surfaces: { occlusal: 'filling' } }} />
      </svg>
    ).container.innerHTML;
    const withCaries = render(
      <svg viewBox="0 0 28 40">
        <ToothShape fdi={16} conditions={{ ...base, base: 'sound', surfaces: { occlusal: 'caries' } }} />
      </svg>
    ).container.innerHTML;
    expect(withFilling).not.toBe(sound);
    expect(withCaries).not.toBe(sound);
  });
});

describe('ToothSurfacePicker', () => {
  const conditions = {
    base: 'sound' as const,
    caries: false,
    periapical: false,
    mobility: 0,
    surfaces: {},
  };

  it('felszín-gombra kattintva szuvasnak jelöl', () => {
    const onChange = vi.fn();
    render(<ToothSurfacePicker fdi={16} conditions={conditions} onChange={onChange} />);
    fireEvent.click(screen.getByText('Okkluzális'));
    expect(onChange).toHaveBeenCalledWith({ occlusal: 'caries' });
  });

  it('a rajz mezőjére kattintva ugyanaz történik', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToothSurfacePicker fdi={16} conditions={conditions} onChange={onChange} />
    );
    const mesial = Array.from(container.querySelectorAll('title')).find((t) =>
      t.textContent?.includes('Meziális')
    );
    expect(mesial).toBeTruthy();
    fireEvent.click(mesial!.parentElement!);
    expect(onChange).toHaveBeenCalledWith({ mesial: 'caries' });
  });

  it('a második kattintás tömöttre vált, a harmadik töröl', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToothSurfacePicker
        fdi={16}
        conditions={{ ...conditions, surfaces: { occlusal: 'caries' } }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('Okkluzális'));
    expect(onChange).toHaveBeenCalledWith({ occlusal: 'filling' });

    rerender(
      <ToothSurfacePicker
        fdi={16}
        conditions={{ ...conditions, surfaces: { occlusal: 'filling' } }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('Okkluzális'));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});
