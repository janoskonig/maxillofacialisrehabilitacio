import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/patient-contact-policy', () => ({
  canContactPatient: vi.fn(),
}));

import { canContactPatient } from '@/lib/patient-contact-policy';
import { sendEmail } from '@/lib/email/config';
import { sendPushNotification } from '@/lib/push-notifications';

const mockedCanContactPatient = vi.mocked(canContactPatient);

describe('központi betegértesítési kapu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('betegnek szánt email előtt ellenőrzi a halálozási státuszt', async () => {
    mockedCanContactPatient.mockResolvedValue(false);

    await sendEmail({
      to: 'patient@example.test',
      subject: 'Teszt',
      html: '<p>Teszt</p>',
      patientId: 'deceased-patient',
    });

    expect(mockedCanContactPatient).toHaveBeenCalledOnce();
    expect(mockedCanContactPatient).toHaveBeenCalledWith('deceased-patient');
  });

  it('betegnek szánt push előtt ellenőrzi a halálozási státuszt', async () => {
    mockedCanContactPatient.mockResolvedValue(false);

    await sendPushNotification(
      'portal-user-id',
      { title: 'Teszt', body: 'Teszt', data: { type: 'reminder' } },
      { patientId: 'deceased-patient' },
    );

    expect(mockedCanContactPatient).toHaveBeenCalledOnce();
    expect(mockedCanContactPatient).toHaveBeenCalledWith('deceased-patient');
  });

  it('munkatársi értesítésnél nem alkalmaz beteg-kaput', async () => {
    await sendEmail({
      to: 'doctor@example.test',
      subject: 'Teszt',
      html: '<p>Teszt</p>',
    });

    expect(mockedCanContactPatient).not.toHaveBeenCalled();
  });
});
