import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Odontogram } from '@/components/patient-form/odontogram/Odontogram';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';

/**
 * Az íven a kiválasztott fog felnagyítva jelenik meg, és a felszín-mezői
 * közvetlenül jelölhetők. Ezek a tesztek a DOM-ból ellenőrzik a geometriát
 * (transform / viewBox) és az interakciót — a happy-dom nem számol layoutot.
 */

function Harness({ initial = {} as Record<string, ToothStatus> }) {
  const [fogak, setFogak] = useState<Record<string, ToothStatus>>(initial);
  return (
    <>
      <Odontogram fogak={fogak} setFogak={setFogak} editing isViewOnly={false} />
      <pre data-testid="state">{JSON.stringify(fogak)}</pre>
    </>
  );
}

function state(): Record<string, any> {
  return JSON.parse(screen.getByTestId('state').textContent || '{}');
}

/** Az adott fog kattintás-felülete (a `<title>` szülője) az íven. */
function toothHit(fdi: string): Element {
  const title = Array.from(document.querySelectorAll('title')).find(
    (t) => t.textContent === `${fdi} fog`
  );
  if (!title?.parentElement) throw new Error(`nincs kattintás-felület: ${fdi}`);
  return title.parentElement;
}

/** Egy felszín-mező a megadott fogon (az első találat az íven). */
function surfaceHit(fdi: string, label: string): Element {
  const title = Array.from(document.querySelectorAll('title')).find((t) =>
    t.textContent?.startsWith(`${fdi} · ${label}`)
  );
  if (!title?.parentElement) throw new Error(`nincs felszín-mező: ${fdi} ${label}`);
  return title.parentElement;
}

function toothGroup(fdi: string): Element {
  return toothHit(fdi).parentElement!;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Odontogram ív — kiválasztás és nagyítás', () => {
  it('fogra kattintva kiválaszt, és a kiválasztott fog nagyítva rajzolódik', () => {
    render(<Harness />);
    // kiválasztás előtt nincs nagyítás
    expect(toothGroup('17').querySelector('g[transform]')!.getAttribute('transform')).toContain(
      'scale(1)'
    );

    fireEvent.click(toothHit('17'));

    const transform = toothGroup('17').querySelector('g[transform]')!.getAttribute('transform')!;
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)![1]);
    expect(scale).toBeGreaterThan(1.4);
    expect(screen.getByText('17. fog')).toBeTruthy();
  });

  it('a kiválasztott fog utoljára rajzolódik (a szomszédok fölé kerül)', () => {
    render(<Harness />);
    fireEvent.click(toothHit('14'));

    const arch = toothGroup('14').parentElement!;
    const groups = Array.from(arch.children);
    expect(groups[groups.length - 1]).toBe(toothGroup('14'));
  });

  it('az ív szélső foga nagyítva sem lóg ki a viewBox-ból', () => {
    render(<Harness />);
    fireEvent.click(toothHit('18')); // az ív bal széle

    const transform = toothGroup('18').querySelector('g[transform]')!.getAttribute('transform')!;
    const [, tx] = transform.match(/^translate\(([-\d.]+), ([-\d.]+)\)/)!;
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)![1]);
    // a nagyított doboz bal széle: tx + 14 - 14 * scale
    expect(Number(tx) + 14 - 14 * scale).toBeGreaterThanOrEqual(-0.01);
  });

  it('a viewBox helyet hagy a nagyításnak, hogy a fog ne vágódjon le', () => {
    render(<Harness />);
    const svgs = Array.from(document.querySelectorAll('svg[viewBox]')).filter((s) =>
      (s.getAttribute('viewBox') || '').startsWith('0 ')
    );
    const upper = svgs[0].getAttribute('viewBox')!.split(' ').map(Number);
    // a felső ívnél felfelé nő a fog: negatív y-origó és nagyobb magasság
    expect(upper[1]).toBeLessThan(0);
    expect(upper[3]).toBeGreaterThan(52);
  });
});

describe('Odontogram ív — felszín-jelölés', () => {
  it('a kiválasztott fog felszínére kattintva jelöl, majd léptet', () => {
    render(<Harness />);
    fireEvent.click(toothHit('16'));

    fireEvent.click(surfaceHit('16', 'Okkluzális'));
    expect(state()['16'].surfaces).toEqual({ occlusal: 'caries' });

    fireEvent.click(surfaceHit('16', 'Okkluzális'));
    expect(state()['16'].surfaces).toEqual({ occlusal: 'filling' });

    fireEvent.click(surfaceHit('16', 'Okkluzális'));
    expect(state()['16']).toBeUndefined();
  });

  it('a meziális felszín a kvadráns szerinti oldalon van (16 jobb, 26 bal)', () => {
    render(<Harness />);
    fireEvent.click(toothHit('16'));
    fireEvent.click(surfaceHit('16', 'Meziális'));
    fireEvent.click(toothHit('26'));
    fireEvent.click(surfaceHit('26', 'Meziális'));

    expect(state()['16'].surfaces).toEqual({ mesial: 'caries' });
    expect(state()['26'].surfaces).toEqual({ mesial: 'caries' });

    // ugyanaz az anatómiai felszín, tükrözött rajzi oldalon
    const x16 = Number(surfaceHit('16', 'Meziális').getAttribute('d')!.match(/M([\d.]+)/)![1]);
    const x26 = Number(surfaceHit('26', 'Meziális').getAttribute('d')!.match(/M([\d.]+)/)![1]);
    expect(x16).toBeGreaterThan(14); // jobb oldali mező
    expect(x26).toBeLessThan(14); // bal oldali mező
  });

  it('nem kiválasztott fog felszínére kattintva csak kiválasztás történik', () => {
    // a jelölt felszínen van tooltip kiválasztás nélkül is — arra kattintunk
    render(<Harness initial={{ '16': { base: 'sound', surfaces: { occlusal: 'caries' } } }} />);
    fireEvent.click(surfaceHit('16', 'Okkluzális'));
    expect(state()['16'].surfaces).toEqual({ occlusal: 'caries' }); // nem léptetett
    expect(screen.getByText('16. fog')).toBeTruthy(); // de kiválasztott
  });

  it('jelöletlen felszínen nincs néma tooltip a kiválasztatlan fogakon', () => {
    render(<Harness initial={{ '16': { base: 'sound', surfaces: { occlusal: 'caries' } } }} />);
    const titles = Array.from(document.querySelectorAll('title')).map((t) => t.textContent);
    expect(titles).toContain('16 · Okkluzális — szuvas');
    expect(titles).not.toContain('16 · Meziális');
    // kiválasztás után viszont minden mező célozható és felcímkézett
    fireEvent.click(toothHit('16'));
    const afterTitles = Array.from(document.querySelectorAll('title')).map((t) => t.textContent);
    expect(afterTitles).toContain('16 · Meziális');
  });

  it('a kiválasztott fogra kattintva nem szűnik meg a kiválasztás (elütés-védelem)', () => {
    render(<Harness />);
    fireEvent.click(toothHit('16'));
    fireEvent.click(toothHit('16'));
    expect(screen.getByText('16. fog')).toBeTruthy();
  });

  it('hiányzó fognál nincs felszín-jelölés, és a kiválasztás váltható', () => {
    render(<Harness initial={{ '16': { base: 'missing' } }} />);
    fireEvent.click(toothHit('16'));
    expect(() => surfaceHit('16', 'Okkluzális')).toThrow();
    // felszín nélküli fognál a régi viselkedés marad: újra kattintva megszűnik
    fireEvent.click(toothHit('16'));
    expect(screen.queryByText('16. fog')).toBeNull();
  });

  it('nem szerkeszthető nézetben nincs kattintás-felület', () => {
    render(<Odontogram fogak={{}} setFogak={() => {}} editing={false} isViewOnly />);
    expect(
      Array.from(document.querySelectorAll('title')).some((t) => t.textContent === '17 fog')
    ).toBe(false);
  });
});
