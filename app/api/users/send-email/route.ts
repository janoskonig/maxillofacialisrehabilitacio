import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { logger } from '@/lib/logger';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin'], async (req, { auth }) => {
  const body = await req.json();
  const { roles, subject, html, text } = body;

  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    return NextResponse.json(
      { error: 'Legalább egy szerepkör megadása kötelező' },
      { status: 400 }
    );
  }

  if (!subject || !html) {
    return NextResponse.json(
      { error: 'Tárgy és HTML tartalom megadása kötelező' },
      { status: 400 }
    );
  }

  const validRoles = ['sebészorvos', 'fogpótlástanász', 'technikus', 'admin'];
  const invalidRoles = roles.filter((role: string) => !validRoles.includes(role));
  if (invalidRoles.length > 0) {
    return NextResponse.json(
      { error: `Érvénytelen szerepkörök: ${invalidRoles.join(', ')}` },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  
  const placeholders = roles.map((_: string, index: number) => `$${index + 1}`).join(', ');
  const result = await pool.query(
    `SELECT email, doktor_neve, role
     FROM users
     WHERE role IN (${placeholders}) AND active = true
     ORDER BY email ASC`,
    roles
  );

  const adminResult = await pool.query(
    `SELECT email, doktor_neve, role
     FROM users
     WHERE role = 'admin' AND active = true
     ORDER BY email ASC`
  );

  const selectedRecipients = result.rows.map((row) => row.email);
  const adminRecipients = adminResult.rows.map((row) => row.email);
  
  const allRecipients = Array.from(new Set([...selectedRecipients, ...adminRecipients]));
  
  if (allRecipients.length === 0) {
    return NextResponse.json(
      { error: 'Nem található aktív felhasználó' },
      { status: 404 }
    );
  }

  const KONIG_EMAIL = 'konig.janos@semmelweis.hu';
  const toRecipient = allRecipients.includes(KONIG_EMAIL) ? KONIG_EMAIL : allRecipients[0];
  const bccRecipients = allRecipients.filter(email => email !== toRecipient);

  const selectedUserDetails = result.rows.map((row) => ({
    email: row.email,
    name: row.doktor_neve || row.email,
    role: row.role,
  }));
  
  const adminUserDetails = adminResult.rows.map((row) => ({
    email: row.email,
    name: row.doktor_neve || row.email,
    role: row.role,
  }));

  const userDetailsMap = new Map<string, { email: string; name: string; role: string }>();
  selectedUserDetails.forEach(user => userDetailsMap.set(user.email, user));
  adminUserDetails.forEach(user => {
    if (!userDetailsMap.has(user.email)) {
      userDetailsMap.set(user.email, user);
    }
  });
  const userDetails = Array.from(userDetailsMap.values());

  try {
    await sendEmail({
      to: toRecipient,
      bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
      subject,
      html,
      text,
    });

    const selectedCount = selectedRecipients.length;
    const adminCount = adminRecipients.length;
    const message = adminCount > 0 && !roles.includes('admin')
      ? `E-mail sikeresen elküldve ${selectedCount} címzettnek (+ ${adminCount} admin másolatként)`
      : `E-mail sikeresen elküldve ${allRecipients.length} címzettnek`;

    return NextResponse.json({
      success: true,
      message,
      recipients: userDetails,
      selectedCount,
      adminCount: adminCount > 0 && !roles.includes('admin') ? adminCount : 0,
    });
  } catch (emailError) {
    logger.error('Error sending email:', emailError);
    return NextResponse.json(
      { error: 'Hiba történt az e-mail küldésekor' },
      { status: 500 }
    );
  }
});

export const GET = roleHandler(['admin'], async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const rolesParam = searchParams.get('roles');
  
  if (!rolesParam) {
    return NextResponse.json(
      { error: 'Szerepkörök megadása kötelező' },
      { status: 400 }
    );
  }

  const roles = rolesParam.split(',').map((r) => r.trim());
  const validRoles = ['sebészorvos', 'fogpótlástanász', 'technikus', 'admin'];
  const invalidRoles = roles.filter((role) => !validRoles.includes(role));
  
  if (invalidRoles.length > 0) {
    return NextResponse.json(
      { error: `Érvénytelen szerepkörök: ${invalidRoles.join(', ')}` },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  const placeholders = roles.map((_, index) => `$${index + 1}`).join(', ');
  const result = await pool.query(
    `SELECT email, doktor_neve, role
     FROM users
     WHERE role IN (${placeholders}) AND active = true
     ORDER BY role, email ASC`,
    roles
  );

  const adminResult = await pool.query(
    `SELECT email, doktor_neve, role
     FROM users
     WHERE role = 'admin' AND active = true
     ORDER BY email ASC`
  );

  const selectedUsers = result.rows.map((row) => ({
    email: row.email,
    name: row.doktor_neve || row.email,
    role: row.role,
  }));

  const adminUsers = adminResult.rows.map((row) => ({
    email: row.email,
    name: row.doktor_neve || row.email,
    role: row.role,
  }));

  const includeAdmins = roles.includes('admin');
  const users = includeAdmins 
    ? [...selectedUsers] 
    : [...selectedUsers, ...adminUsers];

  return NextResponse.json({ 
    users,
    includeAdmins: !includeAdmins && adminUsers.length > 0,
    adminCount: adminUsers.length,
  });
});
