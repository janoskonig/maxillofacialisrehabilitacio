import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { requireRole, HttpError } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ['admin']);

    const pool = getDbPool();
    const result = await pool.query(
      `SELECT 
        u.id,
        u.email,
        u.doktor_neve,
        u.role,
        u.active,
        u.restricted_view,
        u.intezmeny,
        u.hozzaferes_indokolas,
        u.created_at,
        u.updated_at,
        u.last_login,
        a_last.created_at AS last_activity,
        a_last.action AS last_activity_action,
        a_last.detail AS last_activity_detail
       FROM users u
       LEFT JOIN LATERAL (
         SELECT created_at, action, detail
         FROM activity_logs
         WHERE user_email = u.email
         ORDER BY created_at DESC
         LIMIT 1
       ) a_last ON true
       ORDER BY u.email ASC`
    );

    return NextResponse.json({ users: result.rows });
  } catch (error) {
    return handleApiError(error, 'Hiba történt a felhasználók lekérdezésekor');
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ['admin']);

    const body = await request.json();
    const { email, password, role = 'editor', doktor_neve } = body;

    if (!email || !password) {
      throw new HttpError(400, 'Email cím és jelszó megadása kötelező');
    }

    if (!['admin', 'editor', 'viewer', 'fogpótlástanász', 'technikus', 'sebészorvos'].includes(role)) {
      throw new HttpError(400, 'Érvénytelen szerepkör');
    }

    const pool = getDbPool();

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      throw new HttpError(409, 'Ez az email cím már használatban van');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userName = doktor_neve || normalizedEmail.substring(0, 3).toUpperCase();

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, doktor_neve)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, doktor_neve, role, active, created_at`,
      [normalizedEmail, passwordHash, role, userName]
    );

    return NextResponse.json({ user: result.rows[0] }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Hiba történt a felhasználó létrehozásakor');
  }
}

