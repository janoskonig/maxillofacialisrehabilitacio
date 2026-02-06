import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { sendApprovalEmail } from '@/lib/email';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

async function verifyAuth(request: NextRequest): Promise<{ userId: string; email: string; role: string } | null> {
  const token = request.cookies.get('auth-token')?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// Felhasználó frissítése (csak admin, vagy saját profil)
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { email, password, role, active, restricted_view, doktor_neve } = body;

    const pool = getDbPool();

    // Ellenőrizzük, hogy a felhasználó létezik-e
    const userResult = await pool.query('SELECT id, email, active FROM users WHERE id = $1', [params.id]);
    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }

    const user = userResult.rows[0];
    const wasInactive = !user.active;

    // Csak admin módosíthat más felhasználókat, vagy saját email/jelszót
    const isOwnProfile = auth.userId === params.id;
    const canModifyRole = auth.role === 'admin';
    const canModifyActive = auth.role === 'admin';
    const canModifyRestrictedView = auth.role === 'admin';

    if (!isOwnProfile && !canModifyRole) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a felhasználó módosításához' },
        { status: 403 }
      );
    }

    // Frissítendő mezők összeállítása
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (email !== undefined && email !== user.email) {
      // Ellenőrizzük, hogy az új email még nem foglalt
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase().trim(), params.id]);
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
      // Admin módosíthatja bárki nevét, vagy saját nevét
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

    values.push(params.id);
    const query = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING id, email, doktor_neve, role, active, restricted_view, updated_at`;

    const result = await pool.query(query, values);
    const updatedUser = result.rows[0];

    // Send approval email if user was just activated
    if (active === true && wasInactive && updatedUser.email) {
      try {
        await sendApprovalEmail(updatedUser.email);
      } catch (emailError) {
        console.error('Failed to send approval email:', emailError);
        // Don't fail the request if email fails
      }
    }

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Hiba történt a felhasználó frissítésekor' },
      { status: 500 }
    );
  }
}

// Felhasználó törlése (csak admin)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága a felhasználó törléséhez' },
        { status: 403 }
      );
    }

    // Ne töröljük, csak deaktiváljuk
    const pool = getDbPool();
    await pool.query('UPDATE users SET active = false WHERE id = $1', [params.id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Hiba történt a felhasználó törlésekor' },
      { status: 500 }
    );
  }
}

