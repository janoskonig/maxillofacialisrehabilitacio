/**
 * Felhasználói fiók inaktiválása / újraaktiválása — a users PUT és DELETE
 * route közös üzleti logikája (100-as migráció: `deactivated_at`).
 *
 * Állapotok:
 *   active = true                              → aktív
 *   active = false AND deactivated_at IS NULL  → jóváhagyásra váró regisztráció
 *   active = false AND deactivated_at NOT NULL → inaktivált (újraaktiválható)
 *
 * Inaktiváláskor a fiók adatai (időpontok, üzenetek, naplók) érintetlenek
 * maradnak; csak a bejelentkezés és a futó munkamenetek szűnnek meg
 * (JWT-ellenőrzés: lib/user-active-check.ts; élő socketek: disconnect).
 */

import type { Pool } from 'pg';
import { HttpError } from './auth-server';
import { invalidateUserActiveCache } from './user-active-check';
import { disconnectUserSockets } from './socket-server';
import { closeStaffRegistrationReviewTasks } from './user-tasks';
import { logger } from './logger';

export interface DeactivationTarget {
  id: string;
  role: string;
  active: boolean;
  deactivated_at: string | Date | null;
}

export type UserAccountState = 'active' | 'pending_approval' | 'deactivated';

export function userAccountState(user: Pick<DeactivationTarget, 'active' | 'deactivated_at'>): UserAccountState {
  if (user.active) return 'active';
  return user.deactivated_at ? 'deactivated' : 'pending_approval';
}

/**
 * Őrök: saját fiók és az utolsó aktív admin nem inaktiválható (különben
 * kizárnánk magunkat / az egész adminisztrációt a rendszerből).
 */
export async function assertCanDeactivate(
  pool: Pick<Pool, 'query'>,
  target: Pick<DeactivationTarget, 'id' | 'role' | 'active'>,
  actorUserId: string
): Promise<void> {
  if (target.id === actorUserId) {
    throw new HttpError(400, 'A saját fiókját nem inaktiválhatja', 'CANNOT_DEACTIVATE_SELF');
  }
  if (target.active && target.role === 'admin') {
    const others = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND active = true AND id <> $1`,
      [target.id]
    );
    if ((others.rows[0]?.count ?? 0) === 0) {
      throw new HttpError(409, 'Az utolsó aktív admin fiók nem inaktiválható', 'LAST_ACTIVE_ADMIN');
    }
  }
}

/**
 * Inaktiválás: active=false + deactivated_at/by. Az őröket a hívó futtatja
 * (assertCanDeactivate), hogy a hibaüzenet a route-nak megfelelő legyen.
 */
export async function deactivateUserAccount(
  pool: Pick<Pool, 'query'>,
  targetId: string,
  actorEmail: string
): Promise<void> {
  await pool.query(
    `UPDATE users
        SET active = false,
            deactivated_at = CURRENT_TIMESTAMP,
            deactivated_by = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [targetId, actorEmail]
  );
  afterDeactivation(targetId);
}

/** Az inaktiválás mellékhatásai: session-cache érvénytelenítés, élő socketek bontása, nyitott jóváhagyási feladatok lezárása. */
export function afterDeactivation(targetId: string): void {
  invalidateUserActiveCache(targetId);
  disconnectUserSockets(targetId);
  closeStaffRegistrationReviewTasks(targetId, 'cancelled').catch((error) => {
    logger.error('Failed to close staff registration review tasks (deactivate):', error);
  });
}
