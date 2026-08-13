import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import {
  normalizeOdontogramStyle,
  useOdontogramStyle,
} from '@/components/patient-form/odontogram/odontogram-style';
import { ToothShapeChart } from '@/components/patient-form/odontogram/ToothShapeChart';
import { BASE_OPTIONS } from '@/components/patient-form/odontogram/tooth-conditions';

describe('normalizeOdontogramStyle', () => {
  it('csak az ismert értékeket fogadja el, minden mást chart-ra normalizál', () => {
    expect(normalizeOdontogramStyle('silhouette')).toBe('silhouette');
    expect(normalizeOdontogramStyle('chart')).toBe('chart');
    expect(normalizeOdontogramStyle(null)).toBe('chart');
    expect(normalizeOdontogramStyle(undefined)).toBe('chart');
    expect(normalizeOdontogramStyle('garbage')).toBe('chart');
  });
});

describe('useOdontogramStyle', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('alapértelmezése a grafikus (chart) nézet', () => {
    const { result } = renderHook(() => useOdontogramStyle());
    expect(result.current[0]).toBe('chart');
  });

  it('a beállítás localStorage-ba kerül és visszaolvasható', () => {
    const { result } = renderHook(() => useOdontogramStyle());
    act(() => result.current[1]('silhouette'));
    expect(result.current[0]).toBe('silhouette');
    expect(window.localStorage.getItem('odontogram-style')).toBe('silhouette');

    const { result: fresh } = renderHook(() => useOdontogramStyle());
    expect(fresh.current[0]).toBe('silhouette');
  });

  it('több példány szinkronban marad', () => {
    const a = renderHook(() => useOdontogramStyle());
    const b = renderHook(() => useOdontogramStyle());
    act(() => a.result.current[1]('silhouette'));
    expect(b.result.current[0]).toBe('silhouette');
    act(() => b.result.current[1]('chart'));
    expect(a.result.current[0]).toBe('chart');
  });
});

describe('ToothShapeChart', () => {
  it('minden alapállapotra és mindkét állcsontra renderel', () => {
    for (const base of BASE_OPTIONS) {
      for (const fdi of [16, 11, 24, 33, 41, 47]) {
        const { container, unmount } = render(
          <svg>
            <ToothShapeChart
              fdi={fdi}
              conditions={{ base, caries: false, periapical: false, mobility: 0 }}
            />
          </svg>
        );
        expect(container.querySelector('svg g, svg path, svg rect')).toBeTruthy();
        unmount();
      }
    }
  });

  it('kísérő jelzések (szuvas, periapikális, mobilitás) nem dobnak hibát', () => {
    const { container } = render(
      <svg>
        <ToothShapeChart
          fdi={36}
          conditions={{ base: 'filled', caries: true, periapical: true, mobility: 2 }}
        />
      </svg>
    );
    expect(container.querySelector('text')?.textContent).toBe('II');
  });
});
