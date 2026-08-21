import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  applyAppointmentStageTransition,
  isDeliveryStepCode,
  parseAppointmentClinicalEvent,
} from '@/lib/appointment-stage-transition';

function fakeClient(rowsByCall: unknown[][]) {
  const query = vi.fn();
  for (const rows of rowsByCall) query.mockResolvedValueOnce({ rows });
  return { client: { query } as unknown as PoolClient, query };
}

describe('appointment stage transition', () => {
  it('recognises only structured delivery step codes, not free text', () => {
    expect(isDeliveryStepCode('delivery')).toBe(true);
    expect(isDeliveryStepCode('felso_atadas')).toBe(true);
    expect(isDeliveryStepCode('Atadas')).toBe(true);
    expect(isDeliveryStepCode('atadas_egyeztetes')).toBe(false);
    expect(isDeliveryStepCode(null)).toBe(false);
    expect(parseAppointmentClinicalEvent('delivery')).toBe('delivery');
    expect(parseAppointmentClinicalEvent('other')).toBeNull();
  });

  it('moves a delivery appointment to STAGE_6 at the appointment date', async () => {
    const appointmentAt = new Date('2026-06-12T08:30:00+02:00');
    const { client, query } = fakeClient([
      [{ id: 'episode-1', patient_id: 'patient-1', reason: 'traumás sérülés', status: 'open' }],
      [{ code: 'STAGE_6', label_hu: 'Átadás', order_index: 6 }],
      [{ stage_code: 'STAGE_5', at: new Date('2026-05-01'), label_hu: 'Protetikai fázis', order_index: 5 }],
      [],
      [{ at: appointmentAt }],
    ]);

    const result = await applyAppointmentStageTransition({
      client,
      appointmentId: 'appointment-1',
      episodeId: 'episode-1',
      appointmentAt,
      appointmentStepCode: 'delivery',
      clinicalEvent: null,
      requestedStageCode: null,
      changedBy: 'doctor@example.com',
    });

    expect(result).toMatchObject({
      requested: true,
      changed: true,
      stageCode: 'STAGE_6',
      stageLabel: 'Átadás',
      source: 'delivery',
      at: appointmentAt.toISOString(),
    });
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[4][1]).toEqual([
      'patient-1',
      'episode-1',
      'STAGE_6',
      appointmentAt,
      expect.stringContaining('appointment-1'),
      'doctor@example.com',
    ]);
  });

  it('does not move a patient backwards from care to delivery', async () => {
    const stageAt = new Date('2026-07-01T10:00:00+02:00');
    const { client, query } = fakeClient([
      [{ id: 'episode-1', patient_id: 'patient-1', reason: 'traumás sérülés', status: 'open' }],
      [{ code: 'STAGE_6', label_hu: 'Átadás', order_index: 6 }],
      [{ stage_code: 'STAGE_7', at: stageAt, label_hu: 'Gondozás', order_index: 7 }],
    ]);

    const result = await applyAppointmentStageTransition({
      client,
      appointmentId: 'appointment-1',
      episodeId: 'episode-1',
      appointmentAt: new Date('2026-08-20T08:00:00+02:00'),
      appointmentStepCode: null,
      clinicalEvent: 'delivery',
      requestedStageCode: null,
      changedBy: 'doctor@example.com',
    });

    expect(result).toMatchObject({
      requested: true,
      changed: false,
      stageCode: 'STAGE_7',
      source: 'delivery',
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('supports an explicit manual target stage', async () => {
    const appointmentAt = new Date('2026-08-20T09:00:00+02:00');
    const { client } = fakeClient([
      [{ id: 'episode-1', patient_id: 'patient-1', reason: 'traumás sérülés', status: 'open' }],
      [{ code: 'STAGE_4', label_hu: 'Sebészi fázis', order_index: 4 }],
      [{ stage_code: 'STAGE_3', at: new Date('2026-08-01'), label_hu: 'Tervezés', order_index: 3 }],
      [],
      [{ at: appointmentAt }],
    ]);

    const result = await applyAppointmentStageTransition({
      client,
      appointmentId: 'appointment-2',
      episodeId: 'episode-1',
      appointmentAt,
      appointmentStepCode: 'tryin',
      clinicalEvent: null,
      requestedStageCode: 'STAGE_4',
      changedBy: 'doctor@example.com',
    });

    expect(result).toMatchObject({ changed: true, stageCode: 'STAGE_4', source: 'manual' });
  });
});
