/**
 * Popover viewport-őr: a gombhoz igazított panel keskeny (mobil) képernyőn
 * kilóghat a bal/jobb szélen — nyitáskor megmérjük, és a képernyőn belülre
 * toljuk (8px margó). Layout nélkül (0 szélesség, pl. teszt-DOM) nem nyúl hozzá.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Popover, viewportShiftX } from '@/components/visit-plan/Popover';

function mockPanelRect(rect: { left: number; right: number; width: number }) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const r = this.getAttribute('role') === 'menu' ? rect : { left: 0, right: 0, width: 0 };
    return {
      x: r.left,
      y: 0,
      top: 0,
      bottom: 0,
      height: 0,
      left: r.left,
      right: r.right,
      width: r.width,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

function setViewportWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

function openPopover(align: 'left' | 'right') {
  render(
    <Popover trigger="Nyit" align={align} widthClass="w-80">
      {() => <div>Panel</div>}
    </Popover>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Nyit' }));
  return screen.getByRole('menu');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('viewportShiftX', () => {
  it('bal szélen kilógó panel: jobbra tol, 8px margóval', () => {
    expect(viewportShiftX({ left: -40, right: 280 }, 390)).toBe(48);
  });
  it('jobb szélen kilógó panel: balra tol', () => {
    expect(viewportShiftX({ left: 300, right: 620 }, 390)).toBe(-238);
  });
  it('ha elfér, 0', () => {
    expect(viewportShiftX({ left: 20, right: 340 }, 390)).toBe(0);
  });
});

describe('Popover viewport-őr', () => {
  it('jobbra igazított panel bal oldali gombon (mobil): a panelt jobbra tolja', () => {
    setViewportWidth(390);
    mockPanelRect({ left: -40, right: 280, width: 320 });
    const menu = openPopover('right');
    expect(menu.style.transform).toBe('translateX(48px)');
    expect(menu.className).toContain('max-w-[calc(100vw-1rem)]');
  });

  it('balra igazított panel jobb oldali gombon: a panelt balra tolja', () => {
    setViewportWidth(390);
    mockPanelRect({ left: 300, right: 620, width: 320 });
    const menu = openPopover('left');
    expect(menu.style.transform).toBe('translateX(-238px)');
  });

  it('ha elfér, nincs eltolás', () => {
    setViewportWidth(390);
    mockPanelRect({ left: 20, right: 340, width: 320 });
    const menu = openPopover('right');
    expect(menu.style.transform).toBe('');
  });

  it('layout nélkül (0 szélesség) nem tol', () => {
    setViewportWidth(390);
    mockPanelRect({ left: 0, right: 0, width: 0 });
    const menu = openPopover('right');
    expect(menu.style.transform).toBe('');
  });

  it('zárás után újranyitva tiszta lappal mér', () => {
    setViewportWidth(390);
    mockPanelRect({ left: -40, right: 280, width: 320 });
    const menu = openPopover('right');
    expect(menu.style.transform).toBe('translateX(48px)');
    fireEvent.click(screen.getByRole('button', { name: 'Nyit' }));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nyit' }));
    expect(screen.getByRole('menu').style.transform).toBe('translateX(48px)');
  });
});
