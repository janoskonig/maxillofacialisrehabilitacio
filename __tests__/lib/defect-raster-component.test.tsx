import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DefectRaster } from '@/components/patient-form/DefectRaster';

/**
 * A raszter-jelölő interakciója a DOM-ból: a jelölhető mezők checkbox-szerepű
 * SVG téglalapok (aria-label = szint · oszlop · zóna), a csonton kívüli mezők
 * nem interaktívak. A happy-dom nem számol layoutot — a geometriát nem tesztelj.
 */

function Harness({ initial = [] as string[], readOnly = false }: { initial?: string[]; readOnly?: boolean }) {
  const [cells, setCells] = useState<string[]>(initial);
  return (
    <>
      <DefectRaster jaw="maxilla" value={cells} onChange={setCells} readOnly={readOnly} />
      <pre data-testid="state">{JSON.stringify(cells)}</pre>
    </>
  );
}

const state = (): string[] => JSON.parse(screen.getByTestId('state').textContent || '[]');
const cell = (name: string) => screen.getByRole('checkbox', { name });

const J3_MOLAR = 'nagyőrlők szintje · J3 · processus alveolaris';
const J2_MOLAR = 'nagyőrlők szintje · J2 · palatum durum';
const J1_MOLAR = 'nagyőrlők szintje · J1 · palatum durum';
const B1_MOLAR = 'nagyőrlők szintje · B1 · palatum durum';

describe('DefectRaster — jelölés', () => {
  it('kattintásra bejelöl, újra kattintva töröl', () => {
    render(<Harness />);
    const c = cell(J3_MOLAR);
    expect(c.getAttribute('aria-checked')).toBe('false');

    fireEvent.pointerDown(c);
    expect(state()).toEqual(['r3c1']);
    expect(cell(J3_MOLAR).getAttribute('aria-checked')).toBe('true');

    fireEvent.pointerUp(window);
    fireEvent.pointerDown(cell(J3_MOLAR));
    expect(state()).toEqual([]);
  });

  it('húzással több mezőt jelöl; felengedés után az áthaladás már nem jelöl', () => {
    render(<Harness />);
    fireEvent.pointerDown(cell(J3_MOLAR));
    fireEvent.pointerOver(cell(J2_MOLAR));
    fireEvent.pointerOver(cell(J1_MOLAR));
    expect(state()).toEqual(['r3c1', 'r3c2', 'r3c3']);

    fireEvent.pointerUp(window);
    fireEvent.pointerOver(cell(B1_MOLAR));
    expect(state()).toEqual(['r3c1', 'r3c2', 'r3c3']);
  });

  it('húzással törölni is lehet (a kiinduló mező állapota dönt)', () => {
    render(<Harness initial={['r3c1', 'r3c2']} />);
    fireEvent.pointerDown(cell(J3_MOLAR));
    fireEvent.pointerOver(cell(J2_MOLAR));
    expect(state()).toEqual([]);
  });

  it('billentyűzettel (szóköz / Enter) is kapcsolható', () => {
    render(<Harness />);
    fireEvent.keyDown(cell(J2_MOLAR), { key: ' ' });
    expect(state()).toEqual(['r3c2']);
    fireEvent.keyDown(cell(J2_MOLAR), { key: 'Enter' });
    expect(state()).toEqual([]);
  });

  it('a csonton kívüli mezőnek nincs checkbox szerepe', () => {
    render(<Harness />);
    expect(screen.queryByRole('checkbox', { name: /metszők szintje · J4/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /lágyszájpad · J4/ })).toBeNull();
  });

  it('csak olvasható módban nem változik és nincs törlés gomb', () => {
    render(<Harness initial={['r3c1']} readOnly />);
    fireEvent.pointerDown(cell(J3_MOLAR));
    fireEvent.keyDown(cell(J3_MOLAR), { key: ' ' });
    expect(state()).toEqual(['r3c1']);
    expect(screen.queryByText('Jelölés törlése')).toBeNull();
    expect(screen.getByTestId('defect-raster-summary-maxilla').textContent).toContain('Jobb oldali defektus');
  });

  it('összegzés frissül és a törlés gomb mindent töröl', () => {
    render(<Harness initial={['r3c1', 'r3c2']} />);
    expect(screen.getByTestId('defect-raster-summary-maxilla').textContent).toContain('2/');
    fireEvent.click(screen.getByText('Jelölés törlése'));
    expect(state()).toEqual([]);
    expect(screen.getByTestId('defect-raster-summary-maxilla').textContent).toBe('Nincs bejelölt mező.');
  });

  it('a tárolt érték érvénytelen kulcsait figyelmen kívül hagyja', () => {
    render(<Harness initial={['r0c0', 'r3c1', 'zzz']} />);
    expect(screen.getByTestId('defect-raster-summary-maxilla').textContent).toContain('1/');
  });
});
