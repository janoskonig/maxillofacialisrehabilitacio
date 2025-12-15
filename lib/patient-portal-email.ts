import { sendEmail } from './email';
import { getDbPool } from './db';

const PORTAL_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://rehabilitacios-protetika.hu';

/**
 * Send magic link email to existing patient
 */
export async function sendPatientMagicLink(
  patientEmail: string,
  patientName: string | null,
  token: string
): Promise<void> {
  const magicLink = `${PORTAL_BASE_URL}/api/patient-portal/auth/verify?token=${token}`;

  const subject = 'Bejelentkezés a páciens portálra';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Bejelentkezés a páciens portálra</h2>
      <p>Kedves ${patientName || 'Páciens'}!</p>
      <p>Kattintson az alábbi linkre a páciens portálhoz való bejelentkezéshez:</p>
      <p style="margin: 20px 0;">
        <a href="${magicLink}" 
           style="background-color: #2563eb; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 5px; display: inline-block;">
          Bejelentkezés
        </a>
      </p>
      <p>Vagy másolja be ezt a linket a böngészőbe:</p>
      <p style="word-break: break-all; color: #666;">${magicLink}</p>
      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        Ez a link 48 órán belül érvényes. Ha nem Ön kérte ezt a linket, kérjük hagyja figyelmen kívül ezt az emailt.
      </p>
      <p style="color: #666; font-size: 12px;">
        Maxillofaciális Rehabilitáció<br>
        1088 Budapest, Szentkirályi utca 47. VI. emelet 611.
      </p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject,
    html,
  });
}

/**
 * Send email verification link for new patient registration
 */
export async function sendPatientVerificationEmail(
  patientEmail: string,
  patientName: string | null,
  token: string
): Promise<void> {
  const verificationLink = `${PORTAL_BASE_URL}/api/patient-portal/auth/verify-email?token=${token}`;

  const subject = 'Email cím megerősítése - Páciens portál';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Email cím megerősítése</h2>
      <p>Kedves ${patientName || 'Páciens'}!</p>
      <p>Köszönjük, hogy regisztrált a páciens portálra!</p>
      <p>Az aktiváláshoz kérjük, erősítse meg az email címét az alábbi linkre kattintva:</p>
      <p style="margin: 20px 0;">
        <a href="${verificationLink}" 
           style="background-color: #2563eb; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 5px; display: inline-block;">
          Email cím megerősítése
        </a>
      </p>
      <p>Vagy másolja be ezt a linket a böngészőbe:</p>
      <p style="word-break: break-all; color: #666;">${verificationLink}</p>
      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        Ez a link 7 napon belül érvényes. Az email cím megerősítése után bejelentkezhet a portálra.
      </p>
      <p style="color: #666; font-size: 12px;">
        Maxillofaciális Rehabilitáció<br>
        1088 Budapest, Szentkirályi utca 47. VI. emelet 611.
      </p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject,
    html,
  });
}

/**
 * Get patient email and name for email sending
 */
export async function getPatientEmailInfo(patientId: string): Promise<{
  email: string;
  name: string | null;
} | null> {
  const pool = getDbPool();
  const result = await pool.query(
    'SELECT email, nev FROM patients WHERE id = $1',
    [patientId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    email: result.rows[0].email,
    name: result.rows[0].nev,
  };
}


