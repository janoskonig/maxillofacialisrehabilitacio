import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmailMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/email/config', () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));
vi.mock('@/lib/email/admin-notification-queue', () => ({ queueAdminNotification: vi.fn(async () => undefined) }));

import { sendAccountInactiveNoticeEmail } from '@/lib/email/senders';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendAccountInactiveNoticeEmail', () => {
  it('inaktivált: kimondja, hogy nem a jelszó hibás, és nincs benne reset link', async () => {
    await sendAccountInactiveNoticeEmail('doki@dev.local', 'deactivated');
    const opts = sendEmailMock.mock.calls[0][0] as { to: string; subject: string; html: string; emailType: string };
    expect(opts.to).toBe('doki@dev.local');
    expect(opts.subject).toMatch(/a jelszó nem hibás/);
    expect(opts.html).toMatch(/inaktiválta/);
    expect(opts.html).toMatch(/jelszava nem hibás/);
    expect(opts.html).not.toMatch(/reset-password\?token/);
    expect(opts.emailType).toBe('account_inactive_notice');
  });

  it('jóváhagyásra váró: a jóváhagyásra utal', async () => {
    await sendAccountInactiveNoticeEmail('x@dev.local', 'pending_approval');
    const opts = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(opts.html).toMatch(/jóváhagyásra vár/);
  });
});
