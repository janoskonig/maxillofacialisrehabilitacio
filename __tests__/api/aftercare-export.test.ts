import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), enabled: vi.fn(), gate: vi.fn(), eligible: vi.fn(), freeze: vi.fn(), workspace: vi.fn() }));
vi.mock('@/lib/api/route-handler', () => ({ roleHandler: (_roles: unknown, handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ connect: mocks.connect }) }));
vi.mock('@/lib/aftercare/service', () => ({ loadAftercareWorkspace: mocks.workspace }));
vi.mock('@/lib/research-registry/feature-flags', () => ({ getComplianceFeatureFlag: mocks.enabled }));
vi.mock('@/lib/research-registry/research-export-gate', () => ({ assertResearchExportModeAllowsCohortExport: mocks.gate,
  filterPatientsEligibleForResearchExport: mocks.eligible, ResearchExportBlockedError: class extends Error {} }));
vi.mock('@/lib/research-registry/export-service', () => ({ createAnalysisExport: mocks.freeze, CURRENT_EXPORT_SCHEMA_VERSION: '1.1' }));
import { POST } from '@/app/api/aftercare/research-export/route';
const context = { auth: { userId: 'staff', email: 'staff@example.test', role: 'admin' }, params: {}, correlationId: 'test' } as const;
const request = () => new NextRequest('http://localhost/api/aftercare/research-export', { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true); mocks.gate.mockResolvedValue(undefined);
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT DISTINCT') ? [{ patient_id: 'included' }, { patient_id: 'excluded' }] : [] }));
  mocks.eligible.mockResolvedValue({ eligible: ['included'], excluded: ['excluded'] });
  mocks.workspace.mockResolvedValue({ patientName: 'Sensitive Name', deceased: false, episodes: [], prostheses: [], encounters: [], appointments: [], requests: [] });
  mocks.freeze.mockResolvedValue({ id: 'export', contentHash: 'hash' });
});

it('checks the existing export switch before accessing clinical records', async () => {
  mocks.enabled.mockResolvedValue(false);
  await expect(POST(request(), context)).rejects.toMatchObject({ status: 403 });
  expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
});
it('projects only eligible patients, freezes the result, and returns no direct patient identifiers', async () => {
  const response = await POST(request(), context);
  expect(response.status).toBe(201);
  const output = await response.json();
  expect(mocks.workspace).toHaveBeenCalledTimes(1);
  expect(mocks.workspace).toHaveBeenCalledWith('included', expect.objectContaining({ query: mocks.query }));
  expect(mocks.freeze.mock.calls[0][0]).toMatchObject({ patientIds: ['included'], keyColumns: ['recordKey'], filterPolicy: { consentAndEthicsGated: true, excludedCount: 1 } });
  expect(JSON.stringify(output)).not.toContain('Sensitive Name');
  expect(output).toMatchObject({ contentHash: 'hash', excludedCount: 1 });
  expect(mocks.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ');
  expect(mocks.query).toHaveBeenCalledWith('COMMIT');
  expect(mocks.release).toHaveBeenCalled();
});
it('rolls back and returns no dataset if there are no eligible subjects', async () => {
  mocks.eligible.mockResolvedValue({ eligible: [], excluded: ['included', 'excluded'] });
  await expect(POST(request(), context)).rejects.toMatchObject({ status: 403 });
  expect(mocks.freeze).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledWith('ROLLBACK'); expect(mocks.release).toHaveBeenCalled();
});
