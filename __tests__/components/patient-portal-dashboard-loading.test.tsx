import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const showToastMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: showToastMock }) }));

import { PortalDashboard } from '@/components/patient-portal/PortalDashboard';

const patientUrl = '/api/patient-portal/patient';
const appointmentsUrl = '/api/patient-portal/appointments';

function response(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function successfulResponse(url: string) {
  if (url === patientUrl) return response(200, { patient: { id: 'patient-1', nev: 'Teszt Páciens' } });
  if (url === appointmentsUrl) return response(200, { appointments: [] });
  // Ancillary cards must not affect the authentication/loading regression.
  return response(404);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Patient portal dashboard loading', () => {
  it.each([patientUrl, appointmentsUrl])('redirects to login for a 401 from %s', async (failedUrl) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url === failedUrl ? response(401) : successfulResponse(url)
    ));

    render(<PortalDashboard />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/patient-portal'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [patientUrl, 500, 'A páciens adatait'],
    [appointmentsUrl, 500, 'Az időpontokat'],
    [patientUrl, 429, 'A páciens adatait'],
  ])('keeps the session and shows a retry for %s returning %s', async (failedUrl, status, message) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url === failedUrl ? response(Number(status)) : successfulResponse(url)
    ));

    render(<PortalDashboard />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(String(message));
    expect(screen.getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Üdvözöljük, Páciens!')).toBeNull();
  });

  it('loads the dashboard after retrying a temporary server failure without logging in again', async () => {
    let patientAttempts = 0;
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url === patientUrl && patientAttempts++ === 0) return response(500);
      return successfulResponse(url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PortalDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Újrapróbálás' }));

    expect(await screen.findByRole('heading', { name: 'Üdvözöljük, Teszt Páciens!' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(patientAttempts).toBe(2);
    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => url === patientUrl)
      .every(([, options]) => (options as RequestInit).credentials === 'include')).toBe(true);
  });

  it('shows a persistent retry when the network request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    render(<PortalDashboard />);

    expect((await screen.findByRole('alert')).textContent).toContain('internetkapcsolatot');
    expect(screen.getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
