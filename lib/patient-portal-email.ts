import { sendEmail } from './email';
import { getDbPool } from './db';

// Always use production URL, never localhost
const PORTAL_BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL && 
  !process.env.NEXT_PUBLIC_BASE_URL.includes('localhost') && 
  !process.env.NEXT_PUBLIC_BASE_URL.includes('127.0.0.1'))
  ? process.env.NEXT_PUBLIC_BASE_URL 
  : 'https://rehabilitacios-protetika.hu';

/**
 * Get base URL - always use production URL, never localhost
 */
function getBaseUrl(baseUrl?: string): string {
  // Always use production URL, ignore any localhost URLs
  if (baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) {
    return baseUrl;
  }
  return PORTAL_BASE_URL;
}

/**
 * Send magic link email to existing patient
 */
export async function sendPatientMagicLink(
  patientEmail: string,
  patientName: string | null,
  token: string,
  baseUrl?: string
): Promise<void> {
  const portalBaseUrl = getBaseUrl(baseUrl);
  // Ensure we always use production URL, never localhost
  const magicLink = `${portalBaseUrl}/api/patient-portal/auth/verify?token=${token}`;
  
  // Log for debugging
  console.log('[Email] Sending magic link:', magicLink, 'baseUrl param:', baseUrl, 'final baseUrl:', portalBaseUrl);

  const subject = 'Bejelentkezés a páciens portálra';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Bejelentkezés a páciens portálra</h2>
      <p>Kedves ${patientName || 'Páciens'}!</p>
      <p>Kattintson az alábbi linkre a páciens portálhoz való bejelentkezéshez:</p>
      <p style="margin: 20px 0;">
        <a href="${magicLink}" 
           clicktracking="off"
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
  token: string,
  baseUrl?: string,
  waitingTimeStats?: { atlagNapokban: number; szorasNapokban: number } | null
): Promise<void> {
  const portalBaseUrl = getBaseUrl(baseUrl);
  const verificationLink = `${portalBaseUrl}/api/patient-portal/auth/verify-email?token=${token}`;

  // Format waiting time info if available
  let waitingTimeInfo = '';
  if (waitingTimeStats && waitingTimeStats.atlagNapokban) {
    const atlag = waitingTimeStats.atlagNapokban.toFixed(1);
    const szoras = waitingTimeStats.szorasNapokban ? ` ± ${waitingTimeStats.szorasNapokban.toFixed(1)}` : '';
    waitingTimeInfo = `
      <div style="background-color: #f0f9ff; border-left: 4px solid #2563eb; padding: 12px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; color: #1e40af; font-weight: 500;">
          Az első konzultáció várók átlagos várakozási ideje: <strong>${atlag}${szoras} nap</strong>
        </p>
      </div>
    `;
  }

  const subject = 'Email cím megerősítése - Páciens portál';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Email cím megerősítése</h2>
      <p>Kedves ${patientName || 'Páciens'}!</p>
      <p>Köszönjük, hogy regisztrált a páciens portálra!</p>
      ${waitingTimeInfo}
      <p>Az aktiváláshoz kérjük, erősítse meg az email címét az alábbi linkre kattintva:</p>
      <p style="margin: 20px 0;">
        <a href="${verificationLink}" 
           clicktracking="off"
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

/**
 * Send login notification email to patient after successful magic link login
 */
export async function sendPatientLoginNotification(
  patientEmail: string,
  patientName: string | null,
  loginTime: Date,
  ipAddress: string | null
): Promise<void> {
  // Import formatDateForEmail from email.ts
  // We'll format the date manually to avoid circular dependency
  const formatter = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(loginTime);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const hours = parts.find(p => p.type === 'hour')?.value || '';
  const minutes = parts.find(p => p.type === 'minute')?.value || '';
  const seconds = parts.find(p => p.type === 'second')?.value || '';
  
  const formattedDate = `${year}. ${month}. ${day}. ${hours}:${minutes}:${seconds}`;

  const subject = 'Sikeres bejelentkezés - Páciens portál';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Sikeres bejelentkezés</h2>
      <p>Kedves ${patientName || 'Páciens'}!</p>
      <p>Sikeresen bejelentkezett a páciens portálra.</p>
      <ul>
        <li><strong>Bejelentkezés ideje:</strong> ${formattedDate}</li>
        ${ipAddress ? `<li><strong>IP cím:</strong> ${ipAddress}</li>` : ''}
      </ul>
      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        Ha nem Ön jelentkezett be, kérjük, azonnal lépjen kapcsolatba velünk.
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


