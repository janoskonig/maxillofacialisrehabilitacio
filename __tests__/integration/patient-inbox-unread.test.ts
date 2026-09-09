import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { NextRequest } from 'next/server';
import type { AuthPayload } from '@/lib/auth-server';
import { resolveTestDatabaseUrl } from './helpers/env';

let client: Client;
let viewer: AuthPayload;

vi.mock('@/lib/db', () => ({ getDbPool: () => client }));
vi.mock('@/lib/auth-server', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth-server')>(),
  requireAuth: vi.fn(async () => viewer),
  verifyAuth: vi.fn(async () => viewer),
}));
vi.mock('@/lib/patient-portal-server', () => ({ verifyPatientPortalSession: vi.fn(async () => null) }));
vi.mock('@/lib/doctor-communication', () => ({ getUnreadDoctorMessageCount: vi.fn(async () => 0) }));
vi.mock('@/lib/socket-server', () => ({ emitMessageRead: vi.fn() }));
vi.mock('@/lib/message-delivery', () => ({
  buildPatientChannelReadDeliveryUpdate: vi.fn(() => ({})),
  notifyDeliveryStatusUpdates: vi.fn(),
}));

import { GET as getAll } from '@/app/api/messages/all/route';
import { GET as getConversations } from '@/app/api/messages/conversations/route';
import { GET as getSummary } from '@/app/api/messages/staff-inbox-summary/route';
import { PUT as markRead } from '@/app/api/messages/[id]/read/route';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doctor = id(1);
const colleague = id(2);
const patient = id(3);

beforeEach(async () => {
  viewer = { userId: doctor, email: 'doctor@example.test', role: 'fogpótlástanász' };
  client = new Client({ connectionString: resolveTestDatabaseUrl() });
  await client.connect();
  await client.query('BEGIN');
  // Session-local fixtures: never write into the test application's actual tables.
  await client.query(`
    CREATE TEMP TABLE users (id uuid, email text, doktor_neve text) ON COMMIT DROP;
    CREATE TEMP TABLE patients (
      id uuid, nev text, taj text, kezeleoorvos text, kezeleoorvos_user_id uuid
    ) ON COMMIT DROP;
    CREATE TEMP TABLE patient_episodes (patient_id uuid, assigned_provider_id uuid) ON COMMIT DROP;
    CREATE TEMP TABLE appointments (patient_id uuid, dentist_email text) ON COMMIT DROP;
    CREATE TEMP TABLE messages (
      id uuid, patient_id uuid, sender_type text, sender_id uuid, sender_email text,
      subject text, message text, recipient_doctor_id uuid, read_at timestamptz,
      created_at timestamptz DEFAULT now(), delivery_status text DEFAULT 'sent'
    ) ON COMMIT DROP;
  `);
  await client.query('INSERT INTO users VALUES ($1, $2, $3), ($4, $5, $6)', [
    doctor, viewer.email, 'Doctor', colleague, 'colleague@example.test', 'Colleague',
  ]);
  await client.query('INSERT INTO patients (id, nev, kezeleoorvos_user_id) VALUES ($1, $2, $3)', [
    patient, 'Test patient', doctor,
  ]);
});

afterEach(async () => {
  if (client) {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
});

async function addMessage(n: number, recipient: string | null = doctor, senderType = 'patient') {
  await client.query(
    `INSERT INTO messages (id, patient_id, sender_type, sender_id, message, recipient_doctor_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id(n), patient, senderType, senderType === 'patient' ? patient : doctor, `Message ${n}`, recipient],
  );
  return id(n);
}

async function inbox() {
  const request = (path: string) => new NextRequest(`http://localhost/api/messages/${path}`);
  const summaryResponse = await getSummary(request('staff-inbox-summary'));
  const conversationResponse = await getConversations(request('conversations'));
  const allResponse = await getAll(request('all?unreadOnly=true'));
  expect([summaryResponse.status, conversationResponse.status, allResponse.status]).toEqual([200, 200, 200]);
  const summary = await summaryResponse.json();
  const { conversations } = await conversationResponse.json();
  const { messages } = await allResponse.json();
  expect(summary.patientUnread).toBe(conversations.reduce((sum: number, c: { unreadCount: number }) => sum + c.unreadCount, 0));
  return { summary, conversations, messages };
}

describe('patient inbox unread visibility', () => {
  it('shows no badge or empty conversation for another doctor’s unread message', async () => {
    await addMessage(10, colleague);
    const result = await inbox();
    expect(result.summary.patientUnread).toBe(0);
    expect(result.conversations).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it('counts only incoming unread messages in the doctor’s own conversation', async () => {
    await addMessage(10);
    await addMessage(11, colleague);
    await addMessage(12, null);
    await addMessage(13, null, 'doctor');
    const readMessage = await addMessage(14);
    await client.query('UPDATE messages SET read_at = now() WHERE id = $1', [readMessage]);
    const result = await inbox();
    expect(result.summary.patientUnread).toBe(2);
    expect(result.messages.map((m: { id: string }) => m.id).sort()).toEqual([id(10), id(12)]);
  });

  it('excludes patients the viewer has never treated, even if a message names them as recipient', async () => {
    await client.query('UPDATE patients SET kezeleoorvos_user_id = $1', [colleague]);
    await addMessage(10);
    await addMessage(11, null);
    const result = await inbox();
    expect(result.summary.patientUnread).toBe(0);
    expect(result.messages).toEqual([]);
  });

  it.each(['canonical', 'episode', 'appointment', 'legacy-email', 'legacy-name'])(
    'allows %s treating doctors to see and clear a legacy unread message', async (access) => {
      if (access !== 'canonical') await client.query('UPDATE patients SET kezeleoorvos_user_id = $1', [colleague]);
      if (access === 'episode') {
        await client.query('INSERT INTO patient_episodes VALUES ($1, $2)', [patient, doctor]);
      } else if (access === 'appointment') {
        await client.query('INSERT INTO appointments VALUES ($1, $2)', [patient, viewer.email]);
      } else if (access.startsWith('legacy-')) {
        await client.query('UPDATE patients SET kezeleoorvos = $1', [access === 'legacy-email' ? viewer.email : 'Doctor']);
      }
      const messageId = await addMessage(10, null);
      expect((await inbox()).summary.patientUnread).toBe(1);
      const response = await markRead(
        new NextRequest(`http://localhost/api/messages/${messageId}/read`, { method: 'PUT' }),
        { params: { id: messageId } },
      );
      expect(response.status).toBe(200);
      expect((await inbox()).summary.patientUnread).toBe(0);
    },
  );

  it('does not allow clearing a colleague’s unread message', async () => {
    const messageId = await addMessage(10, colleague);
    const response = await markRead(
      new NextRequest(`http://localhost/api/messages/${messageId}/read`, { method: 'PUT' }),
      { params: { id: messageId } },
    );
    expect(response.status).toBe(403);
    expect((await client.query('SELECT read_at FROM messages WHERE id = $1', [messageId])).rows[0].read_at).toBeNull();
  });

  it('preserves the administrator’s complete inbox', async () => {
    viewer = { ...viewer, role: 'admin' };
    await client.query('UPDATE patients SET kezeleoorvos_user_id = $1', [colleague]);
    await addMessage(10, colleague);
    await addMessage(11);
    const result = await inbox();
    expect(result.summary.patientUnread).toBe(2);
    expect(result.messages).toHaveLength(2);
  });

  it('counts beyond the 20-message recent-list page size', async () => {
    for (let n = 10; n < 35; n++) await addMessage(n);
    const result = await inbox();
    expect(result.summary.patientUnread).toBe(25);
    expect(result.messages).toHaveLength(20);
  });
});
