import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { sendApprovalEmail } from '@/lib/email';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const PUT = authedHandler(async (req, { auth, params }) => {
  const { id } = params;
  const body = await req.json();
  const { email, password, role, active, restricted_view, doktor_neve } = body;

  const pool = getDbPool();

  const userResult = await pool.query('SELECT id, email, active FROM users WHERE id = $1', [id]);
  if (userResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Felhasználó nem található' },
      { status: 404 }
    );
  }

  const user = userResult.rows[0];
  const wasInactive = !user.active;

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
    if (!['admin', 'editor', 'viewer', 'fogpótlástanász', 'technikus', 'sebészorvos'].includes(role)) {
      return NextResponse.json(
        { error: 'Érvénytelen szerepkör' },
        { status: 400 }
      );
    }
    updates.push(`role = $${paramIndex}`);
    values.push(role);
    paramIndex++;
  }

  if (active !== undefined) {
    if (!canModifyActive) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a felhasználó aktiválásához/deaktiválásához' },
        { status: 403 }
      );
    }
    updates.push(`active = $${paramIndex}`);
    values.push(active);
    paramIndex++;
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
  const query = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING id, email, doktor_neve, role, active, restricted_view, updated_at`;

  const result = await pool.query(query, values);
  const updatedUser = result.rows[0];

  if (active === true && wasInactive && updatedUser.email) {
    try {
      await sendApprovalEmail(updatedUser.email);
    } catch (emailError) {
      logger.error('Failed to send approval email:', emailError);
    }
  }

  return NextResponse.json({ user: updatedUser });
});

export const DELETE = roleHandler(['admin'], async (req, { auth, params }) => {
  const { id } = params;
  const pool = getDbPool();
  await pool.query('UPDATE users SET active = false WHERE id = $1', [id]);

  return NextResponse.json({ success: true });
});
