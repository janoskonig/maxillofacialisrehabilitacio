import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ query: vi.fn(), requests: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock('@/lib/api/route-handler', () => ({ roleHandler: (_roles: unknown, handler: unknown) => handler }));
vi.mock('@/lib/aftercare/service', () => ({ loadSchedulingRequests: mocks.requests }));
import { GET } from '@/app/api/capacity-forecast/route';

const context = { params: {}, auth: { userId: 'admin', email: 'admin@example.test', role: 'admin' }, correlationId: 'test' };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
  mocks.query.mockReset(); mocks.requests.mockReset(); mocks.query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.useRealTimers());

it('deduplicates shared returns, excludes secured/completed requests and carries overdue aftercare into the current week', async () => {
  const request = { patientId: 'one', dueOn: '2026-11-02', completed: false, slotSecured: false };
  mocks.requests.mockResolvedValue([request, request, { ...request, patientId: 'two', dueOn: '2026-11-03' },
    { ...request, patientId: 'three', slotSecured: true }, { ...request, patientId: 'four', completed: true },
    { ...request, dueOn: '2026-10-01' }, { ...request, dueOn: '2027-01-01' }]);
  const response = await GET(new NextRequest('http://localhost/api/capacity-forecast?pool=control&weeks=2'), context);
  const data = await response.json();
  expect(data.weeks.map((w: { aftercareDemand: number }) => w.aftercareDemand)).toEqual([1, 2]);
  expect(data.weeks[1]).toMatchObject({ hardDemand: 0, softDemand: 0, aftercareDemand: 2 });
});
it('keeps construction forecasts separate from control-return demand', async () => {
  const response = await GET(new NextRequest('http://localhost/api/capacity-forecast?pool=work&weeks=2'), context);
  expect((await response.json()).weeks.map((w: { aftercareDemand: number }) => w.aftercareDemand)).toEqual([0, 0]);
  expect(mocks.requests).not.toHaveBeenCalled();
});
