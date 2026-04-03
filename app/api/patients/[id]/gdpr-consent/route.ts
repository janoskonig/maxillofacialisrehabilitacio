import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET - Check if a patient has given consent for a specific purpose
 */
export const GET = authedHandler(async (req, { params }) => {
  const { id: patientId } = params;
  const url = new URL(req.url);
  const purpose = url.searchParams.get('purpose');

  if (!purpose) {
    return NextResponse.json({ error: 'purpose query parameter required' }, { status: 400 });
  }

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT id, given_at, policy_version FROM gdpr_consents 
     WHERE patient_id = $1 AND purpose = $2 AND withdrawn_at IS NULL
     ORDER BY given_at DESC LIMIT 1`,
    [patientId, purpose]
  );

  return NextResponse.json({
    hasConsent: result.rows.length > 0,
    consent: result.rows[0] || null,
  });
});

/**
 * POST - Record consent for a patient (by authorized staff on behalf of patient)
 */
export const POST = authedHandler(async (req, { params, auth }) => {
  const { id: patientId } = params;
  const body = await req.json();
  const { purpose } = body;

  const validPurposes = ['google_calendar', 'error_tracking'];
  if (!purpose || !validPurposes.includes(purpose)) {
    return NextResponse.json(
      { error: `Invalid purpose. Must be one of: ${validPurposes.join(', ')}` },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  // Verify patient exists
  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  }

  // Check for existing active consent
  const existing = await pool.query(
    `SELECT id FROM gdpr_consents 
     WHERE patient_id = $1 AND purpose = $2 AND withdrawn_at IS NULL`,
    [patientId, purpose]
  );

  if (existing.rows.length > 0) {
    return NextResponse.json({ alreadyConsented: true, message: 'Consent already recorded' });
  }

  const ipHeader = req.headers.get('x-forwarded-for') || '';
  const ipAddress = ipHeader.split(',')[0]?.trim() || null;

  await pool.query(
    `INSERT INTO gdpr_consents (patient_id, purpose, policy_version, ip_address, user_agent)
     VALUES ($1, $2, '1.0', $3::inet, $4)`,
    [patientId, purpose, ipAddress, req.headers.get('user-agent')]
  );

  logger.info(`GDPR consent recorded: patient=${patientId}, purpose=${purpose}, by=${auth.email}`);

  return NextResponse.json({ success: true, message: 'Consent recorded' });
});
