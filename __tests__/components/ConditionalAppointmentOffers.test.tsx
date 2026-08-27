/**
 * WP-1.4 — Betegnek küldött időpont-ajánlatok (ConditionalAppointmentOffers)
 *
 * Könnyű komponens-teszt (happy-dom) mock fetch-csel:
 * - beteg-scope: EGY kártya, állapot-chipek (Várakozik / Elfogadva / Elutasítva),
 *   csak időpont/kiküldve/állapot oszlopok (Beteg/Email/TAJ nélkül),
 *   e-mail-hiány jelzés a kártya tetején;
 * - globális (admin-lista) nézet: a korábbi szerkezet Beteg/Email oszlopokkal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ConditionalAppointmentOffers } from '@/components/ConditionalAppointmentOffers';

// happy-dom nem mindig ad ResizeObservert (a MobileTable virtualizáló útja kérheti)
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

const OFFERS = [
  {
    id: 'apt-pending',
    patientId: 'p1',
    timeSlotId: 'ts1',
    startTime: '2026-09-01T10:00:00.000Z',
    patientName: 'Teszt Elek',
    patientTaj: '123456789',
    patientEmail: 'teszt.elek@example.com',
    approvalStatus: 'pending',
    createdAt: '2026-08-25T08:00:00.000Z',
  },
  {
    id: 'apt-approved',
    patientId: 'p1',
    timeSlotId: 'ts2',
    startTime: '2026-09-02T11:00:00.000Z',
    patientName: 'Teszt Elek',
    patientTaj: '123456789',
    patientEmail: 'teszt.elek@example.com',
    approvalStatus: 'approved',
    createdAt: '2026-08-20T08:00:00.000Z',
  },
  {
    id: 'apt-rejected',
    patientId: 'p1',
    timeSlotId: 'ts3',
    startTime: '2026-08-10T09:00:00.000Z',
    patientName: 'Teszt Elek',
    patientTaj: '123456789',
    patientEmail: 'teszt.elek@example.com',
    approvalStatus: 'rejected',
    createdAt: '2026-08-01T08:00:00.000Z',
  },
  // Normál (nem feltételes) időpont — approval_status NULL, a listában nincs helye.
  {
    id: 'apt-normal',
    patientId: 'p1',
    timeSlotId: 'ts4',
    startTime: '2026-09-05T12:00:00.000Z',
    patientName: 'Teszt Elek',
    patientTaj: '123456789',
    patientEmail: 'teszt.elek@example.com',
    approvalStatus: null,
    createdAt: '2026-08-26T08:00:00.000Z',
  },
];

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/time-slots')) {
      return jsonResponse({ timeSlots: [], pagination: { totalPages: 1 } });
    }
    if (url.startsWith('/api/appointments')) {
      return jsonResponse({ appointments: OFFERS });
    }
    if (url.startsWith('/api/patients')) {
      return jsonResponse({
        patients: [
          { id: 'p1', nev: 'Teszt Elek', taj: '123456789', email: 'teszt.elek@example.com' },
        ],
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ConditionalAppointmentOffers — beteg-scope', () => {
  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('egy kártyát renderel állapot-chipes listával, Beteg/Email/TAJ oszlopok nélkül', async () => {
    const { container } = render(
      <ConditionalAppointmentOffers patientId="p1" patientEmail="teszt.elek@example.com" />,
    );

    await waitFor(() => {
      expect(screen.getByText('Betegnek küldött időpont-ajánlatok')).toBeDefined();
    });

    // Mindhárom állapot-chip megjelenik
    expect(screen.getByText('Várakozik')).toBeDefined();
    expect(screen.getByText('Elfogadva')).toBeDefined();
    expect(screen.getByText('Elutasítva')).toBeDefined();

    // Beteg-scope oszlopok: időpont, kiküldve, állapot
    expect(screen.getByText('Időpont')).toBeDefined();
    expect(screen.getByText('Kiküldve')).toBeDefined();
    expect(screen.getByText('Állapot')).toBeDefined();

    // A Beteg/Email/TAJ oszlopok csak a globális nézetben léteznek
    expect(screen.queryByText('Beteg')).toBeNull();
    expect(screen.queryByText('Email')).toBeNull();
    expect(screen.queryByText(/TAJ/)).toBeNull();

    // A normál (approvalStatus: null) időpont nem kerül a listába: 3 sor van
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);

    // Fejléc-gomb: az űrlap lecsukható panelben él
    expect(screen.getByText('Új ajánlat küldése')).toBeDefined();
    expect(screen.queryByText('Ajánlat küldése')).toBeNull();
  });

  it('az "Új ajánlat küldése" gomb kinyitja a lecsukott űrlapot', async () => {
    render(<ConditionalAppointmentOffers patientId="p1" patientEmail="teszt.elek@example.com" />);

    await waitFor(() => {
      expect(screen.getByText('Betegnek küldött időpont-ajánlatok')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Új ajánlat küldése'));

    expect(screen.getByText('Szabad időpont')).toBeDefined();
    expect(screen.getByText('Ajánlat küldése')).toBeDefined();
  });

  it('e-mail cím hiányát a kártya tetején jelzi (informatívan)', async () => {
    render(<ConditionalAppointmentOffers patientId="p1" patientEmail={null} />);

    await waitFor(() => {
      expect(screen.getByText('Betegnek küldött időpont-ajánlatok')).toBeDefined();
    });

    expect(screen.getByText(/nincs rögzített e-mail címe/)).toBeDefined();
  });

  it('meglévő e-mail címnél nincs e-mail-hiány jelzés', async () => {
    render(<ConditionalAppointmentOffers patientId="p1" patientEmail="teszt.elek@example.com" />);

    await waitFor(() => {
      expect(screen.getByText('Betegnek küldött időpont-ajánlatok')).toBeDefined();
    });

    expect(screen.queryByText(/nincs rögzített e-mail címe/)).toBeNull();
  });
});

describe('ConditionalAppointmentOffers — globális (admin-lista) nézet', () => {
  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('a korábbi szerkezetet rendereli: űrlap-kártya + várakozó és elutasított lista Beteg/Email oszlopokkal', async () => {
    render(<ConditionalAppointmentOffers />);

    await waitFor(() => {
      expect(screen.getByText('Feltételes időpontválasztás')).toBeDefined();
    });

    expect(screen.getByText('Jóváhagyásra váró időpontok')).toBeDefined();
    expect(screen.getByText('Elutasított időpontok')).toBeDefined();

    // Globális oszlopok megvannak (két táblában is)
    expect(screen.getAllByText('Beteg').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0);

    // Chipek a listákban
    expect(screen.getAllByText('Várakozik').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Elutasítva').length).toBeGreaterThan(0);
  });
});
