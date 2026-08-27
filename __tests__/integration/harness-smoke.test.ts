import { describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { withRollback } from './helpers/db';
import {
  createTestEpisode,
  createTestPatient,
  createTestWorkPhase,
} from './helpers/factories';

describe('integrációs harness — füstteszt', () => {
  it('EWP sor létrehozható és visszaolvasható, a tranzakció rollbackel', async () => {
    let episodeId = '';
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      episodeId = episode.id;

      const wp = await createTestWorkPhase(client, episode.id, {
        workPhaseCode: 'lenyomat',
        seq: 1,
      });

      const { rows } = await client.query(
        'SELECT work_phase_code, status, pool FROM episode_work_phases WHERE id = $1',
        [wp.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].work_phase_code).toBe('lenyomat');
      expect(rows[0].status).toBe('pending');
      expect(rows[0].pool).toBe('work');
    });

    // A rollback után az epizódnak nyoma sincs.
    const after = await getDbPool().query(
      'SELECT 1 FROM patient_episodes WHERE id = $1',
      [episodeId]
    );
    expect(after.rows).toHaveLength(0);
  });

  it('a DATABASE_URL a teszt-DB-re mutat (_test őr)', () => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, '');
    expect(dbName.endsWith('_test')).toBe(true);
  });
});
