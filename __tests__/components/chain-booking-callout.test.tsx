import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ChainBookingCallout } from '@/components/ChainBookingCallout';

// A next/link app-router kontextust várna; a tesztben sima <a>-ként rendereljük.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * WP-1.3 — a lánc-foglalási felület ajánlat, nem kötelezettség.
 * A banner informál („Több lépés is foglalható egyszerre”), és nem
 * tartalmazhat nyomásgyakorló „kötelező” nyelvezetet.
 */
describe('ChainBookingCallout', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('ajánlatként jelenik meg, „kötelező” nyelvezet nélkül', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ needsFullChainBooking: true }),
    });

    const { container } = render(<ChainBookingCallout episodeId="ep-1" />);

    expect(await screen.findByText('Több lépés is foglalható egyszerre')).toBeTruthy();
    expect(container.textContent).toContain('egy menetben');
    expect(container.textContent).toContain('a láncolást a rendszer számolja');
    // A klinikai kapunál kidobott nyomásgyakorló minta nem térhet vissza:
    expect(container.textContent?.toLowerCase()).not.toContain('kötelező');
    expect(container.textContent).not.toContain('ne csak az első lépést');
    // A munkalistára mutató link megmarad.
    expect(screen.getByText('Munkalista megnyitása').getAttribute('href')).toBe('/?tab=worklist');
  });

  it('nem renderel semmit, ha a backend szerint nincs több láncolható lépés', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ needsFullChainBooking: false }),
    });

    const { container } = render(<ChainBookingCallout episodeId="ep-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
  });

  it('episodeId nélkül nem hív API-t és nem renderel', () => {
    const { container } = render(<ChainBookingCallout episodeId={null} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });
});
