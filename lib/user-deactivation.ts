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

import type { Pool, PoolClient } from 'pg';
import { HttpError } from './auth-server';
import { invalidateUserActiveCache } from './user-active-check';
import { disconnectUserSockets } from './socket-server';
import { closeStaffRegistrationReviewTasks } from './user-tasks';
import { probeColumnExists } from './schema-probe';
import { logger } from './logger';

/**
 * Oszlop-toleráns SELECT-darab a `users.deactivated_at` / `deactivated_by`
 * olvasásához: a 100-as migráció ELŐTTI sémán is lefut (NULL-t ad), így a
 * bejelentkezés és a felhasználó-lista nem 500-azik, ha a deploy megelőzi a
 * migrációt (séma-probe konvenció, RENDER_DEPLOYMENT.md). `alias` a users
 * tábla aliasa a FROM-ban (pl. `u`), RETURNING-ban maga a `users` név.
 */
export function deactivationSelectSql(alias: string): string {
  return `(to_jsonb(${alias}) ->> 'deactivated_at')::timestamptz AS deactivated_at, (to_jsonb(${alias}) ->> 'deactivated_by') AS deactivated_by`;
}

/** Létezik-e már a 100-as migráció oszlopa (cache-elt probe; negatív találat rövid TTL-lel). */
export async function usersDeactivatedAtColumnExists(db: Pool | PoolClient): Promise<boolean> {
  return probeColumnExists(db, 'users', 'deactivated_at');
}

/** Inaktív fiók fajtája a belépési / jelszó-visszaállítási üzenetekhez. */
export type InactiveAccountKind = 'deactivated' | 'pending_approval' | 'unknown';

export const INACTIVE_ACCOUNT_CODES: Record<InactiveAccountKind, string> = {
  deactivated: 'ACCOUNT_DEACTIVATED',
  pending_approval: 'ACCOUNT_PENDING_APPROVAL',
  unknown: 'ACCOUNT_INACTIVE',
};

/**
 * A felhasználónak szánt, egyértelmű üzenetek. A lényeg minden ágon: NEM a
 * jelszó hibás, a jelszó-visszaállítás nem segít — különben az inaktivált
 * felhasználók reflexből jelszó-visszaállítást kezdeményeznek.
 */
export const INACTIVE_ACCOUNT_MESSAGES: Record<InactiveAccountKind, string> = {
  deactivated:
    'Ezt a fiókot az adminisztrátor inaktiválta. A jelszó nem hibás, és a jelszó-visszaállítás nem segít. A hozzáférés visszaállításához forduljon az adminisztrátorhoz.',
  pending_approval:
    'Ez a fiók még jóváhagyásra vár. A jelszó nem hibás; a jóváhagyásról e-mailben értesítjük.',
  unknown:
    'Ez a fiók inaktív. A jelszó nem hibás, és a jelszó-visszaállítás nem segít. Forduljon az adminisztrátorhoz.',
};

/**
 * Inaktív (active=false) fiók besorolása. Ha a `deactivated_at` oszlop még
 * nem létezik, nem tudunk különbséget tenni → 'unknown' (semleges, de a
 * jelszó-félreértést így is kizáró üzenet).
 */
export async function classifyInactiveAccount(
  db: Pool | PoolClient,
  user: Pick<DeactivationTarget, 'active' | 'deactivated_at'>
): Promise<InactiveAccountKind> {
  if (user.active) return 'unknown';
  if (!(await usersDeactivatedAtColumnExists(db))) return 'unknown';
  return userAccountState(user) === 'deactivated' ? 'deactivated' : 'pending_approval';
}

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
  pool: Pool | PoolClient,
  targetId: string,
  actorEmail: string
): Promise<void> {
  if (await usersDeactivatedAtColumnExists(pool)) {
    await pool.query(
      `UPDATE users
          SET active = false,
              deactivated_at = CURRENT_TIMESTAMP,
              deactivated_by = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [targetId, actorEmail]
    );
  } else {
    // 100-as migráció előtt: a régi soft-delete (a fiók „jóváhagyásra váró"-ként
    // fog látszani, amíg a migráció le nem fut) — de a kizárás azonnal érvényes.
    logger.warn('[user-deactivation] users.deactivated_at hiányzik (100-as migráció) — csak active=false íródik');
    await pool.query(
      `UPDATE users SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [targetId]
    );
  }
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
