import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const clientQuery = vi.fn();
const clientRelease = vi.fn();
const poolQuery = vi.fn();

vi.mock('@/lib/db', () => ({
  getDbPool: () => ({
    connect: vi.fn(async () => ({ query: clientQuery, release: clientRelease })),
    query: poolQuery,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { PATCH, POST } from '@/app/api/feedback/triage/worker/route';

const API_KEY = 'feedback-worker-secret';

function request(method: 'POST' | 'PATCH', body?: unknown, key = API_KEY) {
  return new NextRequest('http://localhost/api/feedback/triage/worker', {
    method,
    headers: {
      'x-api-key': key,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEEDBACK_TRIAGE_API_KEY = API_KEY;
});

afterEach(() => {
  delete process.env.FEEDBACK_TRIAGE_API_KEY;
});

describe('POST /api/feedback/triage/worker', () => {
  it('fails closed without the dedicated worker key', async () => {
    const response = await POST(request('POST', undefined, 'wrong'));
    expect(response.status).toBe(401);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('atomically claims one ticket without returning reporter email', async () => {
    const ticket = {
      id: 'ticket-1',
      type: 'bug',
      title: 'Mentési hiba',
      description: 'Nem ment',
      priority: 'critical',
      priority_score: 90,
      triage_worker_attempts: 1,
    };
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ticket] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await POST(request('POST'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.claimed).toBe(true);
    expect(body.claimToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.ticket).toEqual(ticket);
    expect(body.ticket.user_email).toBeUndefined();
    expect(clientQuery.mock.calls[1][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(clientQuery.mock.calls[1][0]).toContain("status = 'in_progress'");
    expect(clientRelease).toHaveBeenCalledOnce();
  });

  it('returns an empty queue without exposing a claim token', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await POST(request('POST'));
    const body = await response.json();
    expect(body).toEqual({ success: true, claimed: false, reason: 'empty_queue' });
    expect(body.claimToken).toBeUndefined();
  });
});

describe('PATCH /api/feedback/triage/worker', () => {
  it('stores a review result but neither closes nor emails', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ id: 'ticket-1', status: 'in_progress', priority: 'high' }],
    });

    const response = await PATCH(
      request('PATCH', {
        ticketId: 'ticket-1',
        claimToken: 'claim-token',
        action: 'complete',
        result: {
          summary: 'Javítás elkészült.',
          verification: 'A célzott teszt sikeres.',
          commit: 'abc1234',
          needsHumanReview: true,
        },
        aiDraftResponse: 'Ellenőrzés után küldhető válasz.',
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.emailSent).toBe(false);
    expect(body.closed).toBe(false);
    expect(body.feedback.status).toBe('in_progress');
    const [sql, values] = poolQuery.mock.calls[0];
    expect(sql).not.toContain('admin_response');
    expect(values[0]).toBe('in_progress');
    expect(values[1]).toContain('Javítás elkészült.');
  });

  it('releases a blocked ticket back to the open queue', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 'ticket-1', status: 'open' }] });

    const response = await PATCH(
      request('PATCH', {
        ticketId: 'ticket-1',
        claimToken: 'claim-token',
        action: 'release',
        result: { blocker: 'Nem reprodukálható.' },
      }),
    );

    expect(response.status).toBe(200);
    expect(poolQuery.mock.calls[0][1][0]).toBe('open');
  });

  it('rejects a stale or invalid claim token', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });

    const response = await PATCH(
      request('PATCH', {
        ticketId: 'ticket-1',
        claimToken: 'stale-token',
        action: 'complete',
        result: { summary: 'Kész.' },
      }),
    );

    expect(response.status).toBe(409);
  });

  it('validates result field types before touching the database', async () => {
    const response = await PATCH(
      request('PATCH', {
        ticketId: 'ticket-1',
        claimToken: 'claim-token',
        action: 'complete',
        result: { summary: 42 },
      }),
    );

    expect(response.status).toBe(400);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});
