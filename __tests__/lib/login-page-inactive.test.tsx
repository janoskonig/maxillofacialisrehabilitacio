import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/**
 * Login oldal: inaktivált fióknál külön, egyértelmű doboz („nem a jelszó
 * hibás"), és az „Elfelejtett jelszó?" link ilyenkor nem jelenik meg.
 */
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/components/Logo', () => ({ Logo: () => <div data-testid="logo" /> }));

import Login from '@/app/login/page';

function mockFetchResponse(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () =>
    ({ ok: status < 400, status, json: async () => body }) as unknown as Response
  ) as unknown as typeof fetch;
}

async function submit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(/Felhasználónév|E-?mail/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Jelszó/i, { selector: 'input' }), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /^Bejelentkezés$/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('Login — inaktivált fiók', () => {
  it('ACCOUNT_DEACTIVATED: külön doboz, a jelszó-félreértést kizáró mondattal, forgot-link nélkül', async () => {
    mockFetchResponse(403, {
      error: 'Ezt a fiókot az adminisztrátor inaktiválta. A jelszó nem hibás, és a jelszó-visszaállítás nem segít.',
      code: 'ACCOUNT_DEACTIVATED',
    });
    render(<Login />);
    expect(screen.getByText('Elfelejtett jelszó?')).toBeTruthy();
    await submit('doki@dev.local', 'x');
    const notice = await screen.findByTestId('inactive-account-notice');
    expect(notice.textContent).toMatch(/A fiókot inaktiválták/);
    expect(notice.textContent).toMatch(/inaktiválta/);
    expect(notice.textContent).toMatch(/Nem a jelszó hibás, jelszó-visszaállítást nem kell kérnie/);
    expect(screen.queryByText('Elfelejtett jelszó?')).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('rossz jelszó: a szokásos hibadoboz, a forgot-link marad', async () => {
    mockFetchResponse(401, { error: 'Hibás email cím vagy jelszó' });
    render(<Login />);
    await submit('doki@dev.local', 'x');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Hibás email cím vagy jelszó/));
    expect(screen.queryByTestId('inactive-account-notice')).toBeNull();
    expect(screen.getByText('Elfelejtett jelszó?')).toBeTruthy();
  });
});
