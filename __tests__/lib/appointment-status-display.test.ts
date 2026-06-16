import { describe, it, expect } from 'vitest';
import { getAppointmentStatusDisplay } from '@/lib/appointment-status-display';

describe('getAppointmentStatusDisplay', () => {
  it('returns the pending descriptor when no status and not late', () => {
    const d = getAppointmentStatusDisplay(null, false);
    expect(d.key).toBe('pending');
    expect(d.label).toBe('Várható');
    expect(d.tone).toBe('primary');
  });

  it('returns "late" only when pending and isLate', () => {
    const d = getAppointmentStatusDisplay(null, true);
    expect(d.key).toBe('late');
    expect(d.label).toBe('Késett');
    expect(d.tone).toBe('warning');
  });

  it('lets a recorded status win over isLate', () => {
    const d = getAppointmentStatusDisplay('completed', true);
    expect(d.key).toBe('completed');
    expect(d.tone).toBe('success');
  });

  it('maps each known status to a distinct descriptor', () => {
    expect(getAppointmentStatusDisplay('no_show').tone).toBe('error');
    expect(getAppointmentStatusDisplay('cancelled_by_doctor').tone).toBe('error');
    expect(getAppointmentStatusDisplay('cancelled_by_patient').tone).toBe('warning');
    expect(getAppointmentStatusDisplay('unsuccessful').tone).toBe('warning');
    expect(getAppointmentStatusDisplay('unsuccessful').label).toBe('Sikertelen – újra kell');
  });

  it('falls back to pending for an unknown status string', () => {
    expect(getAppointmentStatusDisplay('whatever', false).key).toBe('pending');
  });
});
