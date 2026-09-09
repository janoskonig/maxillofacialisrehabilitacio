import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { push, searchParams } = vi.hoisted(() => ({ push: vi.fn(), searchParams: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }), useSearchParams: () => searchParams, usePathname: () => '/messages',
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'doctor' })) }));
vi.mock('@/components/DoctorMessages', () => ({ DoctorMessages: () => null }));
vi.mock('@/components/PatientMessagesList', () => ({ PatientMessagesList: () => null }));
vi.mock('@/components/layout/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/contexts/MessageSearchContext', () => ({ MessageSearchProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/messaging/MessageSearchButton', () => ({ MessageSearchButton: () => null }));

import MessagesPageClient from '@/app/messages/MessagesPageClient';

let patientUnread = 0;
const fetchMock = vi.fn(async (url: string) => ({
  ok: true,
  json: async () => url === '/api/messages/staff-inbox-summary'
    ? { patientUnread, doctorUnread: 3 }
    : { count: 3, messages: [{ senderType: 'patient', readAt: null }] },
}));

beforeEach(() => {
  patientUnread = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('message tab unread badges', () => {
  it('does not show a patient badge for messages outside the viewer’s inbox', async () => {
    render(<MessagesPageClient />);
    await screen.findByRole('button', { name: 'Orvos-orvos 3' });
    expect(screen.getByRole('button', { name: 'Orvos-beteg' }).textContent).toBe('Orvos-beteg');
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/messages/all?unreadOnly=true');
  });

  it('shows an exact count above the recent-list page size', async () => {
    patientUnread = 25;
    render(<MessagesPageClient />);
    await screen.findByRole('button', { name: 'Orvos-beteg 25' });
  });

  it('clears the badge after a completed message-read refresh without waiting for polling', async () => {
    patientUnread = 1;
    render(<MessagesPageClient />);
    await screen.findByRole('button', { name: 'Orvos-beteg 1' });
    patientUnread = 0;
    await act(async () => { window.dispatchEvent(new Event('staff-inbox-changed')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Orvos-beteg' }).textContent).toBe('Orvos-beteg'));
  });
});
