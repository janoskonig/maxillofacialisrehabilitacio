/**
 * Felelős orvos chip (EpisodeProviderControl) — az epizód elsőrendű, sablontól
 * független tulajdonsága, bármikor váltható.
 *
 * - a chip a jelenlegi orvost mutatja; hiányzó orvosnál borostyán nudge;
 * - a popover a fogpótlástanász listát adja, a választás PATCH /api/episodes/:id
 *   {assignedProviderId, providerChangeReason}-t küld, majd onChanged-et hív;
 * - a lekapcsolás assignedProviderId: null-lal megy;
 * - a váltások története a provider-history végpontból jön;
 * - canEdit nélkül csak megjelenítés (nincs gomb).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ToastProvider } from '@/contexts/ToastContext';
import { EpisodeProviderControl } from '@/components/EpisodeProviderControl';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function installFetchMock(opts: { failPatch?: boolean; history?: unknown[]; patientHasKezeleoorvos?: boolean } = {}) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | null = null;
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    calls.push({ url, method, body });
    if (url === '/api/users/fogpotlastanasz') {
      return jsonResponse({
        users: [
          { id: 'u1', displayName: 'Dr. Első Anna', intezmeny: 'SE Fogpótlástani Klinika' },
          { id: 'u2', displayName: 'Dr. Második Béla', intezmeny: null },
        ],
      });
    }
    if (url === '/api/episodes/ep1/provider-history') {
      return jsonResponse({ events: opts.history ?? [] });
    }
    if (url === '/api/episodes/ep1' && method === 'PATCH') {
      if (opts.failPatch) return jsonResponse({ error: 'Szimulált hiba' }, 500);
      return jsonResponse({ episode: { id: 'ep1', assignedProviderId: body?.assignedProviderId ?? null } });
    }
    if (url === '/api/patients/p1/kezeleoorvos' && method === 'GET') {
      return jsonResponse({ kezeleoorvos: { userId: opts.patientHasKezeleoorvos ? 'u9' : null } });
    }
    if (url === '/api/patients/p1/kezeleoorvos' && method === 'PATCH') {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

function renderControl(props: Partial<React.ComponentProps<typeof EpisodeProviderControl>> = {}) {
  const onChanged = vi.fn();
  render(
    <ToastProvider>
      <EpisodeProviderControl
        episodeId="ep1"
        patientId="p1"
        assignedProviderId="u1"
        assignedProviderName="Dr. Első Anna"
        canEdit
        onChanged={onChanged}
        {...props}
      />
    </ToastProvider>
  );
  return { onChanged };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('EpisodeProviderControl', () => {
  it('a chip a jelenlegi felelős orvost mutatja, és megnyitható', async () => {
    installFetchMock();
    renderControl();
    const chip = screen.getByRole('button', { name: /Felelős orvos: Dr. Első Anna/ });
    expect(chip.textContent).toContain('Dr. Első Anna');
    fireEvent.click(chip);
    const menu = await screen.findByRole('menu');
    expect(await within(menu).findByRole('menuitem', { name: /Dr. Második Béla/ })).toBeTruthy();
  });

  it('hiányzó felelős orvosnál nudge-szöveg (nem blokkoló)', () => {
    installFetchMock();
    renderControl({ assignedProviderId: null, assignedProviderName: null });
    expect(screen.getByRole('button', { name: /Felelős orvos: nincs kijelölve/ })).toBeTruthy();
  });

  it('másik orvos választása PATCH-et küld indokkal, majd onChanged-et hív', async () => {
    const { calls } = installFetchMock({ patientHasKezeleoorvos: true });
    const { onChanged } = renderControl();
    fireEvent.click(screen.getByRole('button', { name: /Felelős orvos:/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.change(within(menu).getByLabelText('Váltás indoka'), { target: { value: 'Szabadság miatt átadva' } });
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Dr. Második Béla/ }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url === '/api/episodes/ep1' && c.method === 'PATCH');
      expect(patch?.body).toEqual({ assignedProviderId: 'u2', providerChangeReason: 'Szabadság miatt átadva' });
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // A betegnek van kezelőorvosa → nincs ajánlat
    expect(screen.queryByText(/legyen .* az is/)).toBeNull();
  });

  it('kezelőorvos-ajánlat jelenik meg, ha a betegnek még nincs kezelőorvosa; elfogadása PATCH-el', async () => {
    const { calls } = installFetchMock({ patientHasKezeleoorvos: false });
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: /Felelős orvos:/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Dr. Második Béla/ }));
    expect(await screen.findByText(/nincs kezelőorvosa/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Igen' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.url === '/api/patients/p1/kezeleoorvos' && c.method === 'PATCH');
      expect(patch?.body).toEqual({ userId: 'u2' });
    });
  });

  it('a lekapcsolás assignedProviderId: null-t küld', async () => {
    const { calls } = installFetchMock();
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: /Felelős orvos:/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Felelős orvos lekapcsolása/ }));
    await waitFor(() => {
      const patch = calls.find((c) => c.url === '/api/episodes/ep1' && c.method === 'PATCH');
      expect(patch?.body).toEqual({ assignedProviderId: null, providerChangeReason: null });
    });
  });

  it('a váltások története a provider-history végpontból jön', async () => {
    installFetchMock({
      history: [
        { id: 'e1', oldUserId: 'u1', oldName: 'Dr. Első Anna', newUserId: 'u2', newName: 'Dr. Második Béla', reason: 'Átadás', createdAt: '2026-09-01T10:00:00Z', createdBy: 'admin@dev.local' },
      ],
    });
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: /Felelős orvos:/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(await within(menu).findByRole('button', { name: /Váltások története/ }));
    const list = await screen.findByTestId('provider-history');
    expect(list.textContent).toContain('Dr. Első Anna → Dr. Második Béla');
    expect(list.textContent).toContain('Átadás');
  });

  it('hibás mentésnél a popover nyitva marad, onChanged nem hívódik', async () => {
    const { calls } = installFetchMock({ failPatch: true });
    const { onChanged } = renderControl();
    fireEvent.click(screen.getByRole('button', { name: /Felelős orvos:/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Dr. Második Béla/ }));
    await waitFor(() => {
      const patch = calls.find((c) => c.url === '/api/episodes/ep1' && c.method === 'PATCH');
      expect(patch).toBeTruthy();
    });
    // A popover nyitva marad (a hibát toast jelzi), a szülő nem frissül
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('canEdit nélkül csak megjelenítés', () => {
    installFetchMock();
    renderControl({ canEdit: false });
    expect(screen.queryByRole('button', { name: /Felelős orvos:/ })).toBeNull();
    expect(screen.getByText('Dr. Első Anna')).toBeTruthy();
  });
});
