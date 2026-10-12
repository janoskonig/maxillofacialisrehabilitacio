import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PortalSignInForm } from '@/components/patient-portal/PortalSignInForm';

const TOKEN = 'a'.repeat(64);

afterEach(cleanup);

describe('Patient portal confirmation form', () => {
  it.each([
    [false, '/api/patient-portal/auth/verify', 'Belépés'],
    [true, '/api/patient-portal/auth/verify-email', 'Email cím megerősítése és belépés'],
  ] as const)('uses the native POST endpoint and token for email verification=%s', (verifyEmail, action, label) => {
    render(<PortalSignInForm token={TOKEN} verifyEmail={verifyEmail} />);
    const button = screen.getByRole('button', { name: label });
    const form = button.closest('form')!;

    expect(form.getAttribute('action')).toBe(action);
    expect(form.getAttribute('method')).toBe('post');
    expect(new FormData(form).get('token')).toBe(TOKEN);
    // The first event is not cancelled, allowing the browser to submit normally.
    expect(fireEvent.submit(form)).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe('Belépés...');
    expect(form.getAttribute('aria-busy')).toBe('true');
    // Keyboard/programmatic submits are guarded as well as the disabled button.
    expect(fireEvent.submit(form)).toBe(false);
    expect(new FormData(form).get('token')).toBe(TOKEN);
  });

  it('allows submitting again when browser Back restores the form', () => {
    render(<PortalSignInForm token={TOKEN} />);
    const button = screen.getByRole('button', { name: 'Belépés' }) as HTMLButtonElement;
    const form = button.closest('form')!;
    fireEvent.submit(form);
    expect(button.disabled).toBe(true);

    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    fireEvent(window, restored);

    expect(button.disabled).toBe(false);
    expect(fireEvent.submit(form)).toBe(true);
  });
});
