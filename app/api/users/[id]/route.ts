import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { sendApprovalEmail } from '@/lib/email';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import {
  closeStaffRegistrationReviewTasks,
  deleteStaffRegistrationReviewTasks,
} from '@/lib/user-tasks';
import {
  afterDeactivation,
  assertCanDeactivate,
  deactivateUserAccount,
  userAccountState,
} from '@/lib/user-deactivation';
import { invalidateUserActiveCache } from '@/lib/user-active-check';

export const dynamic = 'force-dynamic';

const USER_RETURNING =
  'id, email, doktor_neve, role, active, restricted_view, deactivated_at, deactivated_by, updated_at';

export const PUT = authedHandler(async (req, { auth, params }) => {
  const { id } = params;
  const body = await req.json();
  const { email, password, role, active, restricted_view, doktor_neve } = body;

  const pool = getDbPool();

  const userResult = await pool.query(
    'SELECT id, email, role, active, deactivated_at FROM users WHERE id = $1',
    [id]
  );
  if (userResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Felhasználó nem található' },
      { status: 404 }
    );
  }

  const user = userResult.rows[0] as {
    id: string;
    email: string;
    role: string;
    active: boolean;
    deactivated_at: string | null;
  };
  const wasInactive = !user.active;
  // Első jóváhagyás (regisztráció) vs. inaktivált fiók újraaktiválása — a
  // „Fiók jóváhagyva" levél és a regisztrációs feladatok csak az előbbihez
  // tartoznak.
  const wasPendingApproval = userAccountState(user) === 'pending_approval';

  const isOwnProfile = auth.userId === id;
  const canModifyRole = auth.role === 'admin';
  const canModifyActive = auth.role === 'admin';
  const canModifyRestrictedView = auth.role === 'admin';

  if (!isOwnProfile && !canModifyRole) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága a felhasználó módosításához' },
      { status: 403 }
    );
  }

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (email !== undefined && email !== user.email) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase().trim(), id]);
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: 'Ez az email cím már használatban van' },
        { status: 409 }
      );
    }
    updates.push(`email = $${paramIndex}`);
    values.push(email.toLowerCase().trim());
    paramIndex++;
  }

  if (password !== undefined && password !== '') {
    const passwordHash = await bcrypt.hash(password, 10);
    updates.push(`password_hash = $${paramIndex}`);
    values.push(passwordHash);
    paramIndex++;
  }

  if (role !== undefined) {
    if (!canModifyRole) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a szerepkör módosításához' },
        { status: 403 }
      );
    }
    if (!['admin', 'fogpótlástanász', 'technikus', 'beutalo_orvos'].includes(role)) {
      return NextResponse.json(
        { error: 'Érvénytelen szerepkör' },
        { status: 400 }
      );
    }
    updates.push(`role = $${paramIndex}`);
    values.push(role);
    paramIndex++;
  }

  let deactivating = false;
  if (active !== undefined) {
    if (!canModifyActive) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a felhasználó aktiválásához/deaktiválásához' },
        { status: 403 }
      );
    }
    if (typeof active !== 'boolean') {
      return NextResponse.json(
        { error: 'Az active mező csak true/false lehet', code: 'INVALID_ACTIVE' },
        { status: 400 }
      );
    }
    if (active === false) {
      // Saját fiók / utolsó aktív admin: HttpError → 400 / 409 a közös hibakezelőn át.
      await assertCanDeactivate(pool, user, auth.userId);
      deactivating = !wasInactive;
      updates.push(`active = $${paramIndex}`);
      values.push(false);
      paramIndex++;
      if (deactivating) {
        updates.push('deactivated_at = CURRENT_TIMESTAMP');
        updates.push(`deactivated_by = $${paramIndex}`);
        values.push(auth.email);
        paramIndex++;
      }
    } else {
      updates.push(`active = $${paramIndex}`);
      values.push(true);
      paramIndex++;
      // Újraaktiválás / jóváhagyás: az inaktiválás nyoma törlődik.
      updates.push('deactivated_at = NULL');
      updates.push('deactivated_by = NULL');
    }
  }

  if (restricted_view !== undefined) {
    if (!canModifyRestrictedView) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a korlátozott nézet beállításához' },
        { status: 403 }
      );
    }
    updates.push(`restricted_view = $${paramIndex}`);
    values.push(restricted_view);
    paramIndex++;
  }

  if (doktor_neve !== undefined) {
    if (!canModifyRole && !isOwnProfile) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a név módosításához' },
        { status: 403 }
      );
    }
    updates.push(`doktor_neve = $${paramIndex}`);
    values.push(doktor_neve);
    paramIndex++;
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: 'Nincs módosítandó mező' },
      { status: 400 }
    );
  }

  values.push(id);
  const query = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING ${USER_RETURNING}`;

  const result = await pool.query(query, values);
  const updatedUser = result.rows[0];

  if (active === true && wasInactive) {
    // A session-cache-ben „inaktív"-ként ülhet — újraaktiválás után azonnal
    // beléphessen.
    invalidateUserActiveCache(id);
    if (wasPendingApproval) {
      if (updatedUser.email) {
        try {
          await sendApprovalEmail(updatedUser.email);
        } catch (emailError) {
          logger.error('Failed to send approval email:', emailError);
        }
      }
      try {
        await closeStaffRegistrationReviewTasks(id, 'done');
      } catch (taskError) {
        logger.error('Failed to close staff registration review tasks (approve):', taskError);
      }
    }
  }

  if (deactivating) {
    afterDeactivation(id);
  }

  return NextResponse.json({ user: updatedUser });
});

export const DELETE = roleHandler(['admin'], async (req, { auth, params }) => {
  const { id } = params;
  const pool = getDbPool();

  const userResult = await pool.query(
    'SELECT id, role, active, deactivated_at FROM users WHERE id = $1',
    [id]
  );
  if (userResult.rows.length === 0) {
    return NextResponse.json({ error: 'Felhasználó nem található' }, { status: 404 });
  }
  const targetUser = userResult.rows[0] as {
    id: string;
    role: string;
    active: boolean;
    deactivated_at: string | null;
  };
  const state = userAccountState(targetUser);

  // Ha a felhasználó még sosem volt aktív (függő regisztráció elutasítása),
  // ténylegesen töröljük a sort, hogy ne maradjon bent a „Jóváhagyásra váró"
  // listán. Ehhez előbb el kell tüntetni a kapcsolódó user_tasks sorokat,
  // mert a `created_by_user_id` NOT NULL + ON DELETE SET NULL ellentmondás
  // miatt egyébként hibára futna a törlés.
  if (state === 'pending_approval') {
    try {
      await deleteStaffRegistrationReviewTasks(id);
    } catch (taskError) {
      logger.error('Failed to delete staff registration review tasks (reject):', taskError);
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return NextResponse.json({ success: true, deleted: true });
  }

  // Inaktivált fiók: az adatai (időpontok, üzenetek, naplók) hivatkoznak rá —
  // fizikai törlés helyett inaktív marad, szükség esetén újraaktiválható.
  if (state === 'deactivated') {
    return NextResponse.json(
      {
        error: 'Az inaktivált fiók nem törölhető, mert adatok hivatkoznak rá. Szükség esetén újraaktiválható.',
        code: 'USER_ALREADY_DEACTIVATED',
      },
      { status: 409 }
    );
  }

  // Aktív felhasználó esetén soft-delete: csak inaktiváljuk.
  await assertCanDeactivate(pool, targetUser, auth.userId);
  await deactivateUserAccount(pool, id, auth.email);

  return NextResponse.json({ success: true, deleted: false, deactivated: true });
});
