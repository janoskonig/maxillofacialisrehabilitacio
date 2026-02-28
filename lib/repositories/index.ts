import type { Pool } from 'pg';
import { PatientRepository } from './patient.repo';
import { UserRepository } from './user.repo';
import { EpisodeRepository } from './episode.repo';
import { AppointmentRepository } from './appointment.repo';

export { PatientRepository } from './patient.repo';
export { UserRepository } from './user.repo';
export { EpisodeRepository } from './episode.repo';
export { AppointmentRepository } from './appointment.repo';

/**
 * Creates all repository instances for a given pool.
 * Usage in route handlers:
 *   const repos = createRepositories(getDbPool());
 *   const patient = await repos.patients.findById(id);
 */
export function createRepositories(pool: Pool) {
  return {
    patients: new PatientRepository(pool),
    users: new UserRepository(pool),
    episodes: new EpisodeRepository(pool),
    appointments: new AppointmentRepository(pool),
  };
}
