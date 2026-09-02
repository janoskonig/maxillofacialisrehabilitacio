/**
 * recordProviderAssignment — a felelős orvos váltás-napló sora SAVEPOINT-on belül:
 *  - siker: SAVEPOINT → INSERT → RELEASE, az id-t adja vissza, az indokot trimmeli;
 *  - hiányzó tábla/partíció (42P01 / 42703 / 23514): ROLLBACK TO SAVEPOINT, null,
 *    hangos hibalog — a hívó tranzakciója (a felelős orvos UPDATE-je) él tovább;
 *  - minden más hiba (pl. 23503 FK) a ROLLBACK TO után tovább dobódik.
 *
 * listProviderAssignmentEvents — hiányzó táblánál (42P01) üres lista, más hiba dob.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProviderAssignmentEvents, recordProviderAssignment } from '@/lib/episode-provider';

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount: number | null };

function fakeClient(onQuery: (text: string, params?: unknown[]) => Promise<QueryResult>) {
  const statements: string[] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const head = text.trim().replace(/\s+/g, ' ');
    statements.push(head.startsWith('INSERT') ? 'INSERT' : head.startsWith('SELECT') ? 'SELECT' : head);
    if (head.startsWith('INSERT') || head.startsWith('SELECT')) return onQuery(head, params);
    return { rows: [], rowCount: 0 };
  });
  return { query, statements };
}

function pgError(code: string, message = 'db error'): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

const args = {
  episodeId: 'ep1',
  oldUserId: null,
  newUserId: 'u1',
  reason: '  Szabadság miatt átadva  ',
  createdBy: 'admin@dev.local',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordProviderAssignment', () => {
  it('siker: SAVEPOINT → INSERT → RELEASE, visszaadja az id-t, az indokot trimmeli', async () => {
    const client = fakeClient(async () => ({ rows: [{ id: 'ev1' }], rowCount: 1 }));
    await expect(recordProviderAssignment(client, args)).resolves.toBe('ev1');
    expect(client.statements).toEqual([
      'SAVEPOINT sp_provider_assignment',
      'INSERT',
      'RELEASE SAVEPOINT sp_provider_assignment',
    ]);
    const insertCall = client.query.mock.calls.find(([text]) => String(text).trim().startsWith('INSERT'));
    expect(insertCall?.[1]).toEqual(['ep1', null, 'u1', 'Szabadság miatt átadva', 'admin@dev.local']);
  });

  it.each(['42P01', '42703', '23514'])(
    'hiányzó séma (%s): ROLLBACK TO SAVEPOINT, null, hibalog — a hívó tranzakciója élhet tovább',
    async (code) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = fakeClient(async () => {
        throw pgError(code, 'relation "provider_assignment_events" does not exist');
      });
      await expect(recordProviderAssignment(client, args)).resolves.toBeNull();
      expect(client.statements).toEqual([
        'SAVEPOINT sp_provider_assignment',
        'INSERT',
        'ROLLBACK TO SAVEPOINT sp_provider_assignment',
      ]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('[provider_assignment_events]');
      expect(errorSpy.mock.calls[0][1]).toMatchObject({ code, episodeId: 'ep1' });
    }
  );

  it('más hiba (FK 23503): ROLLBACK TO SAVEPOINT után tovább dobódik', async () => {
    const client = fakeClient(async () => {
      throw pgError('23503', 'fk violation');
    });
    await expect(recordProviderAssignment(client, args)).rejects.toMatchObject({ code: '23503' });
    expect(client.statements).toEqual([
      'SAVEPOINT sp_provider_assignment',
      'INSERT',
      'ROLLBACK TO SAVEPOINT sp_provider_assignment',
    ]);
  });

  it('kód nélküli hiba is tovább dobódik', async () => {
    const client = fakeClient(async () => {
      throw new Error('connection reset');
    });
    await expect(recordProviderAssignment(client, args)).rejects.toThrow('connection reset');
  });
});

describe('listProviderAssignmentEvents', () => {
  it('hiányzó táblánál (42P01) üres lista, hibalog', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient(async () => {
      throw pgError('42P01', 'relation "provider_assignment_events" does not exist');
    });
    await expect(listProviderAssignmentEvents(client, 'ep1')).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('más hiba tovább dobódik', async () => {
    const client = fakeClient(async () => {
      throw pgError('42501', 'permission denied');
    });
    await expect(listProviderAssignmentEvents(client, 'ep1')).rejects.toMatchObject({ code: '42501' });
  });

  it('sorok leképezése (Date → ISO, null-ok)', async () => {
    const client = fakeClient(async () => ({
      rows: [
        {
          id: 'ev1',
          oldUserId: null,
          oldName: null,
          newUserId: 'u1',
          newName: 'Dr. Első Anna',
          reason: null,
          createdAt: new Date('2026-09-02T12:00:00Z'),
          createdBy: 'admin@dev.local',
        },
      ],
      rowCount: 1,
    }));
    await expect(listProviderAssignmentEvents(client, 'ep1')).resolves.toEqual([
      {
        id: 'ev1',
        oldUserId: null,
        oldName: null,
        newUserId: 'u1',
        newName: 'Dr. Első Anna',
        reason: null,
        createdAt: '2026-09-02T12:00:00.000Z',
        createdBy: 'admin@dev.local',
      },
    ]);
  });
});
