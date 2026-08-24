import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendMissingDataReminders } from '@/lib/missing-data-reminders';
import type { MissingItem } from '@/lib/patient-data-completeness';

/**
 * Regressziós teszt az e-mail-dömping ellen: a hiányzó betegadat-értesítő
 * címzettenként EGY összesített levelet küldhet, nem betegenként külön levelet.
 */

type DigestEmailParams = {
  to: string;
  recipientName: string | null;
  kind: 'kezeloorvos' | 'beutalo' | 'escalation';
  entries: {
    patientId: string;
    patientName: string | null;
    missingItems: MissingItem[];
    isFollowUp: boolean;
  }[];
};

const mocks = vi.hoisted(() => ({
  sendMissingDataDigestEmail: vi.fn<(params: DigestEmailParams) => Promise<void>>(async () => {}),
  getPatientDataCompleteness: vi.fn(),
  insertUserTask: vi.fn(async () => ({}) as never),
  queueAdminNotification: vi.fn(async () => {}),
  query: vi.fn(),
}));
const { sendMissingDataDigestEmail, getPatientDataCompleteness, query } = mocks;

vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock('@/lib/email', () => ({ sendMissingDataDigestEmail: mocks.sendMissingDataDigestEmail }));
vi.mock('@/lib/patient-data-completeness', () => ({
  getPatientDataCompleteness: mocks.getPatientDataCompleteness,
}));
vi.mock('@/lib/user-tasks', () => ({ insertUserTask: mocks.insertUserTask }));
vi.mock('@/lib/email/admin-notification-queue', () => ({
  queueAdminNotification: mocks.queueAdminNotification,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const KEZELO = { id: 'doc1', email: 'kezelo@example.com', doktor_neve: 'Dr. Kezelő' };
const REFERRER = { id: 'ref1', email: 'ref@example.com', doktor_neve: 'Dr. Beutaló' };

const clinical = (key: string): MissingItem => ({ key, label: key.toUpperCase(), group: 'clinical' });
const referrerItem = (key: string): MissingItem => ({ key, label: key, group: 'research' });

/** Egy hiányos beteg sora a teljességi riportból. */
function patientRow(id: string, name: string, missing: MissingItem[]) {
  return {
    patientId: id,
    patientName: name,
    kezeleoorvos: null,
    etiologia: null,
    clinicalMissing: missing.filter((m) => m.group === 'clinical'),
    researchMissing: missing.filter((m) => m.group === 'research'),
    clinicalComplete: false,
    researchComplete: false,
    naMarked: [],
    warnings: [],
    applicableCount: 9,
    completenessScore: 50,
    researchReady: false,
    publicationReady: false,
  };
}

/**
 * Minimál DB-imitátor: az SQL szövege alapján válaszol. `opts.recentLog`
 * tartalmazza azokat a (beteg|címzett) párokat, amelyek még cooldown alatt
 * állnak; `opts.kezeloFor` a kezelőorvossal rendelkező betegeket sorolja fel.
 */
function installDb(opts: {
  kezeloFor?: string[];
  referrerFor?: string[];
  recentLog?: Set<string>;
  reminderCounts?: Record<string, number>;
}) {
  const recentLog = opts.recentLog ?? new Set<string>();
  query.mockReset();
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const patientId = params[0] as string;
    if (sql.includes('FROM patient_referral pr')) {
      return { rows: opts.referrerFor?.includes(patientId) ? [REFERRER] : [], rowCount: 0 };
    }
    if (sql.includes('FROM patients p')) {
      return { rows: opts.kezeloFor?.includes(patientId) ? [KEZELO] : [], rowCount: 0 };
    }
    if (sql.includes('FROM appointments a')) return { rows: [], rowCount: 0 };
    if (sql.includes("WHERE role = 'admin'")) return { rows: [], rowCount: 0 };
    if (sql.includes('count(*)::int AS c')) {
      const key = `${patientId}|${params[1]}`;
      return { rows: [{ c: opts.reminderCounts?.[key] ?? 0 }], rowCount: 1 };
    }
    if (sql.includes('SELECT 1 FROM missing_data_reminder_log')) {
      const key = `${patientId}|${params[1]}`;
      return { rows: recentLog.has(key) ? [{ '?column?': 1 }] : [], rowCount: 0 };
    }
    if (sql.includes('SELECT 1 FROM user_tasks')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
}

/** A ténylegesen kiküldött levelek (címzett + a benne szereplő betegek). */
function sentEmails() {
  return sendMissingDataDigestEmail.mock.calls.map(([p]) => ({
    to: p.to,
    kind: p.kind,
    patientIds: p.entries.map((e) => e.patientId),
  }));
}

beforeEach(() => {
  sendMissingDataDigestEmail.mockClear();
  mocks.insertUserTask.mockClear();
  mocks.queueAdminNotification.mockClear();
});

describe('sendMissingDataReminders — összesített (digest) küldés', () => {
  it('egy kezelőorvos három hiányos betegéről EGY levelet küld', async () => {
    getPatientDataCompleteness.mockResolvedValue({
      patients: ['p1', 'p2', 'p3'].map((id) => patientRow(id, `Beteg ${id}`, [clinical('taj')])),
    });
    installDb({ kezeloFor: ['p1', 'p2', 'p3'] });

    const result = await sendMissingDataReminders();

    expect(sendMissingDataDigestEmail).toHaveBeenCalledTimes(1);
    expect(sentEmails()[0]).toEqual({
      to: KEZELO.email,
      kind: 'kezeloorvos',
      patientIds: ['p1', 'p2', 'p3'],
    });
    expect(result.emailsSent).toBe(1);
    expect(result.patientsWithMissing).toBe(3);
  });

  it('a cooldown alatt álló beteg kimarad a levélből, a többi mehet', async () => {
    getPatientDataCompleteness.mockResolvedValue({
      patients: ['p1', 'p2'].map((id) => patientRow(id, `Beteg ${id}`, [clinical('taj')])),
    });
    installDb({
      kezeloFor: ['p1', 'p2'],
      recentLog: new Set([`p1|${KEZELO.id}`]),
      reminderCounts: { [`p1|${KEZELO.id}`]: 1 },
    });

    const result = await sendMissingDataReminders();

    expect(sendMissingDataDigestEmail).toHaveBeenCalledTimes(1);
    expect(sentEmails()[0].patientIds).toEqual(['p2']);
    expect(result.skipped).toBe(1);
  });

  it('ha minden beteg cooldown alatt van, egyáltalán nem megy levél', async () => {
    getPatientDataCompleteness.mockResolvedValue({
      patients: [patientRow('p1', 'Beteg', [clinical('taj')])],
    });
    installDb({ kezeloFor: ['p1'], recentLog: new Set([`p1|${KEZELO.id}`]) });

    const result = await sendMissingDataReminders();

    expect(sendMissingDataDigestEmail).not.toHaveBeenCalled();
    expect(result.emailsSent).toBe(0);
  });

  it('a beutaló és a kezelőorvos külön-külön EGY-EGY összesítőt kap', async () => {
    getPatientDataCompleteness.mockResolvedValue({
      patients: ['p1', 'p2'].map((id) =>
        patientRow(id, `Beteg ${id}`, [clinical('taj'), referrerItem('szovettan')])
      ),
    });
    installDb({ kezeloFor: ['p1', 'p2'], referrerFor: ['p1', 'p2'] });

    await sendMissingDataReminders();

    const emails = sentEmails();
    expect(emails).toHaveLength(2);
    expect(emails.find((e) => e.kind === 'beutalo')).toEqual({
      to: REFERRER.email,
      kind: 'beutalo',
      patientIds: ['p1', 'p2'],
    });
    expect(emails.find((e) => e.kind === 'kezeloorvos')).toEqual({
      to: KEZELO.email,
      kind: 'kezeloorvos',
      patientIds: ['p1', 'p2'],
    });
  });

  it('a második futásból ismételtként jelöli a korábban már jelzett beteget', async () => {
    getPatientDataCompleteness.mockResolvedValue({
      patients: [patientRow('p1', 'Beteg', [clinical('taj')])],
    });
    installDb({ kezeloFor: ['p1'], reminderCounts: { [`p1|${KEZELO.id}`]: 2 } });

    await sendMissingDataReminders();

    const entries = sendMissingDataDigestEmail.mock.calls[0]?.[0].entries ?? [];
    expect(entries[0]?.isFollowUp).toBe(true);
  });
});
