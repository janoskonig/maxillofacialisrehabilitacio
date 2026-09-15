import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmailMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/email/config', () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...(a as [])),
}));
vi.mock('@/lib/email/admin-notification-queue', () => ({
  queueAdminNotification: vi.fn(async () => undefined),
}));

import { sendCancellationWithNewOfferToPatient } from '@/lib/email/senders';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendCancellationWithNewOfferToPatient', () => {
  it('egy levél: lemondott + új időpont, Elfogadom/Elvetem token-linkek, beteg-kapu (patientId)', async () => {
    await sendCancellationWithNewOfferToPatient({
      patientEmail: 'elek@example.com',
      patientName: 'Teszt Elek',
      patientNem: 'ferfi',
      cancelledTime: new Date('2026-09-20T08:00:00Z'),
      newTime: new Date('2026-09-25T09:30:00Z'),
      dentistFullName: 'Dr. Doki',
      approvalToken: 'tok123',
      baseUrl: 'https://example.test',
      patientId: 'pat-1',
      cim: '1088 Budapest, Szentkirályi utca 47',
      teremszam: '12',
      hasAlternatives: true,
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const opts = sendEmailMock.mock.calls[0][0] as { to: string; subject: string; html: string; patientId: string; emailType: string };
    expect(opts.to).toBe('elek@example.com');
    expect(opts.patientId).toBe('pat-1');
    expect(opts.emailType).toBe('cancellation_with_new_offer');
    expect(opts.subject).toMatch(/lemondásra került/);
    expect(opts.html).toContain('Kedves Teszt Elek');
    expect(opts.html).toContain('2026. 09. 20. 10:00:00'); // Europe/Budapest (CEST)
    expect(opts.html).toContain('2026. 09. 25. 11:30:00');
    expect(opts.html).toContain('https://example.test/api/appointments/approve?token=tok123');
    expect(opts.html).toContain('https://example.test/api/appointments/reject?token=tok123');
    expect(opts.html).toContain('12. terem');
    expect(opts.html).toContain('Dr. Doki');
    expect(opts.html).toMatch(/másik időpontot ajánlunk/);
  });

  it('alternatíva nélkül nincs „következő ajánlat" megjegyzés', async () => {
    await sendCancellationWithNewOfferToPatient({
      patientEmail: 'x@example.com',
      patientName: null,
      patientNem: 'no',
      cancelledTime: new Date(),
      newTime: new Date(),
      dentistFullName: 'Dr. Doki',
      approvalToken: 't',
      baseUrl: 'https://example.test',
      patientId: 'p',
    });
    const opts = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(opts.html).toContain('Tisztelt Asszonyom');
    expect(opts.html).not.toMatch(/másik időpontot ajánlunk/);
  });
});
