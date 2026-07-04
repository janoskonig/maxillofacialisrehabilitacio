import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const errorMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getDbPool: () => ({ query: queryMock }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: (...args: unknown[]) => errorMock(...args) },
}));

import {
  extractPatientAccess,
  logPatientDataAccessFireAndForget,
} from '@/lib/legal/patient-data-access-log';

const UUID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractPatientAccess', () => {
  it('matches GET on a patient record path', () => {
    expect(extractPatientAccess(`/api/patients/${UUID}`, 'GET')).toEqual({
      patientId: UUID,
      route: '/api/patients/:id',
    });
  });

  it('matches GET on a patient sub-resource path and normalizes the UUID', () => {
    expect(extractPatientAccess(`/api/patients/${UUID}/episodes`, 'GET')).toEqual({
      patientId: UUID,
      route: '/api/patients/:id/episodes',
    });
    expect(extractPatientAccess(`/api/patients/${UUID}/ohip14/timeline`, 'GET')?.route).toBe(
      '/api/patients/:id/ohip14/timeline',
    );
  });

  it('lowercases the extracted patient id', () => {
    expect(extractPatientAccess(`/api/patients/${UUID.toUpperCase()}`, 'GET')?.patientId).toBe(UUID);
  });

  it('rejects non-GET methods (writes are covered elsewhere)', () => {
    expect(extractPatientAccess(`/api/patients/${UUID}`, 'POST')).toBeNull();
    expect(extractPatientAccess(`/api/patients/${UUID}`, 'PUT')).toBeNull();
    expect(extractPatientAccess(`/api/patients/${UUID}`, 'DELETE')).toBeNull();
  });

  it('rejects list and helper endpoints without a UUID', () => {
    expect(extractPatientAccess('/api/patients', 'GET')).toBeNull();
    expect(extractPatientAccess('/api/patients/duplicate-check', 'GET')).toBeNull();
    expect(extractPatientAccess('/api/patients/recognize', 'GET')).toBeNull();
    expect(extractPatientAccess('/api/patients/demographics', 'GET')).toBeNull();
    expect(extractPatientAccess('/api/patients/12345', 'GET')).toBeNull();
  });

  it('rejects patient-portal reads (patient reading own data is not betekintés)', () => {
    expect(extractPatientAccess(`/api/patient-portal/${UUID}`, 'GET')).toBeNull();
    expect(extractPatientAccess('/api/patient-portal/research-consent', 'GET')).toBeNull();
  });
});

describe('logPatientDataAccessFireAndForget', () => {
  const input = {
    patientId: UUID,
    route: '/api/patients/:id/episodes',
    method: 'GET',
    actorUserId: 'u1',
    actorEmail: 'doc@clinic.hu',
    actorRole: 'admin',
    correlationId: 'corr-1',
    ipAddress: '10.0.0.1',
  };

  it('inserts with the expected params', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    logPatientDataAccessFireAndForget(input);
    // let the microtask flush
    await Promise.resolve();
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([
      UUID,
      'u1',
      'doc@clinic.hu',
      'admin',
      '/api/patients/:id/episodes',
      'GET',
      'corr-1',
      '10.0.0.1',
    ]);
  });

  it('never throws and logs on DB failure', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    expect(() => logPatientDataAccessFireAndForget(input)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0][0]).toContain('patient_data_access_log');
  });
});
