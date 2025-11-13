import nodemailer from 'nodemailer';

// Email configuration from environment variables
// Trim whitespace to avoid authentication issues from copy/paste
const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT?.trim() || '587', 10);
const SMTP_USER = process.env.SMTP_USER?.trim();
const SMTP_PASS = process.env.SMTP_PASS?.trim();
const SMTP_FROM = process.env.SMTP_FROM?.trim();
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME?.trim() || 'Maxillofaciális Rehabilitáció Rendszer';
const SMTP_REPLY_TO = process.env.SMTP_REPLY_TO?.trim() || SMTP_FROM;

// Create transporter with spam prevention best practices
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for other ports
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  // Connection pool settings for better reliability
  pool: true,
  maxConnections: 1,
  maxMessages: 3,
  // Timeout settings
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 10000,
  socketTimeout: 10000,
  // TLS options for better security
  tls: {
    // Do not fail on invalid certificates (useful for self-signed certs)
    rejectUnauthorized: false,
    // Use modern TLS versions
    minVersion: 'TLSv1.2',
  },
});

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  bcc?: string | string[]; // Optional BCC recipients (separate from to)
}

/**
 * Convert HTML to plain text (simple version)
 * Removes HTML tags and converts common entities
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '') // Remove style tags
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]+>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove multiple newlines
    .trim();
}

/**
 * Send an email using the configured SMTP settings
 * Includes spam prevention best practices:
 * - Reply-To header
 * - Plain text version
 * - Proper From format with name
 * - BCC for multiple recipients (privacy)
 * - Proper MIME headers
 * - Message-ID and Date headers (handled by nodemailer)
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    console.error('Email configuration is missing. Please check SMTP_* environment variables.');
    throw new Error('Email configuration is missing');
  }

  // Log SMTP configuration (without sensitive data) for debugging
  console.log(`[Email] Attempting to send email via ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}`);

  try {
    // Format From address with name
    const fromAddress = SMTP_FROM_NAME && SMTP_FROM
      ? `${SMTP_FROM_NAME} <${SMTP_FROM}>`
      : SMTP_FROM;

    // Generate plain text version if not provided
    const textVersion = options.text || htmlToText(options.html);

    // Handle recipients: if explicit BCC is provided, use it; otherwise use smart BCC logic
    const toRecipients = Array.isArray(options.to) ? options.to : [options.to];
    const bccRecipients = options.bcc 
      ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc])
      : undefined;
    
    // If explicit BCC is provided, use it; otherwise use smart BCC for multiple recipients
    const toAddress = toRecipients[0];
    const bccAddresses = bccRecipients || (toRecipients.length > 1 ? toRecipients.slice(1) : undefined);
    
    // All recipients for envelope (both to and bcc)
    const allRecipients = bccRecipients 
      ? [...toRecipients, ...bccRecipients]
      : toRecipients;

    // Build proper HTML with meta tags for better email client compatibility
    // Wrapped in a professional email template with header and footer
    const htmlWithMeta = `
<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 30px 40px; background-color: #2563eb; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Maxillofaciális Rehabilitáció Rendszer</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              ${options.html}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Üdvözlettel,<br>
                <strong style="color: #111827;">König János</strong>
              </p>
              <p style="margin: 10px 0 0 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">
                Maxillofaciális Rehabilitáció Rendszer<br>
                Semmelweis Egyetem
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const mailOptions: any = {
      from: fromAddress,
      to: toAddress,
      replyTo: options.replyTo || SMTP_REPLY_TO,
      subject: options.subject,
      text: textVersion,
      html: htmlWithMeta,
      // Use BCC for multiple recipients to protect privacy
      ...(bccAddresses && bccAddresses.length > 0 && { bcc: bccAddresses }),
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      })),
      // Additional headers for better deliverability and spam prevention
      headers: {
        'MIME-Version': '1.0',
        // Content-Type is automatically set by nodemailer based on html/text
        'X-Mailer': 'Maxillofaciális Rehabilitáció Rendszer',
        // Remove X-Priority and Importance - these can trigger spam filters
        // Instead, let email clients determine priority naturally
        'Precedence': allRecipients.length > 1 ? 'bulk' : 'normal',
        'Auto-Submitted': 'no', // Indicates this is not an auto-generated email
        'List-Id': '<maxillofacialis-rehabilitacio.system>', // Helps identify legitimate emails
        'List-Unsubscribe': '<mailto:' + (options.replyTo || SMTP_REPLY_TO) + '>', // Unsubscribe header for better deliverability
        'X-Auto-Response-Suppress': 'All', // Suppress auto-responses
      },
      // Set return path for bounce handling
      envelope: {
        from: SMTP_FROM,
        to: allRecipients,
      },
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

/**
 * Send user approval email
 */
export async function sendApprovalEmail(userEmail: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Fiók jóváhagyva</h2>
      <p>Kedves felhasználó,</p>
      <p>Örömmel értesítjük, hogy fiókja jóváhagyásra került. Most már be tud jelentkezni a rendszerbe.</p>
      <p>Bejelentkezéshez kérjük, használja a regisztrációkor megadott email címét és jelszavát.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: userEmail,
    subject: 'Fiók jóváhagyva - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Send patient creation notification to admins
 */
export async function sendPatientCreationNotification(
  adminEmails: string[],
  patientName: string | null,
  taj: string | null,
  surgeonName: string,
  creationDate: string
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új beteg regisztrálva</h2>
      <p>Kedves adminisztrátor,</p>
      <p>Egy új beteg lett regisztrálva a rendszerben:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${taj || 'Nincs megadva'}</li>
        <li><strong>Beutaló orvos:</strong> ${surgeonName}</li>
        <li><strong>Létrehozás dátuma:</strong> ${new Date(creationDate).toLocaleString('hu-HU')}</li>
      </ul>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  if (adminEmails.length > 0) {
    await sendEmail({
      to: adminEmails,
      subject: 'Új beteg regisztrálva - Maxillofaciális Rehabilitáció',
      html,
    });
  }
}

/**
 * Send appointment booking notification
 */
export async function sendAppointmentBookingNotification(
  dentistEmail: string,
  patientName: string | null,
  patientTaj: string | null,
  appointmentTime: Date,
  surgeonName: string,
  icsFile: Buffer,
  cim?: string | null,
  teremszam?: string | null
): Promise<void> {
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = cim || DEFAULT_CIM;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új időpont foglalás</h2>
      <p>Kedves fogpótlástanász,</p>
      <p>Egy új időpont lett lefoglalva:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Cím:</strong> ${displayCim}</li>
        ${teremszam ? `<li><strong>Teremszám:</strong> ${teremszam}</li>` : ''}
        <li><strong>Beutaló orvos:</strong> ${surgeonName}</li>
      </ul>
      <p>Az időpont részleteit a mellékelt naptár fájlban találja, amelyet importálhat naptárkezelő alkalmazásába.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: dentistEmail,
    subject: 'Új időpont foglalás - Maxillofaciális Rehabilitáció',
    html,
    attachments: [
      {
        filename: 'appointment.ics',
        content: icsFile,
        contentType: 'text/calendar',
      },
    ],
  });
}

/**
 * Send appointment booking notification to patient
 */
export async function sendAppointmentBookingNotificationToPatient(
  patientEmail: string,
  patientName: string | null,
  patientNem: string | null,
  appointmentTime: Date,
  dentistFullName: string,
  dentistEmail: string,
  icsFile: Buffer,
  cim?: string | null,
  teremszam?: string | null,
  adminEmail?: string | null
): Promise<void> {
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = cim || DEFAULT_CIM;
  
  // Dátum formátum: 2025. 11. 11. 15:15:00
  // Az appointmentTime Date objektum, ami az adatbázisból jön
  // Explicit módon használjuk a Europe/Budapest időzónát, hogy független legyen a szerver időzónájától
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
  
  const parts = formatter.formatToParts(appointmentTime);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const hours = parts.find(p => p.type === 'hour')?.value || '';
  const minutes = parts.find(p => p.type === 'minute')?.value || '';
  const seconds = parts.find(p => p.type === 'second')?.value || '';
  const formattedDate = `${year}. ${month}. ${day}. ${hours}:${minutes}:${seconds}`;
  
  // Cím formátum: 1088 Budapest Szentkirályi utca 47. 611. terem
  // Eltávolítjuk a vesszőt a címből, ha van
  let formattedAddress = displayCim.replace(/,/g, '');
  if (teremszam) {
    // Ha van teremszám, hozzáadjuk a címhez
    formattedAddress = `${formattedAddress.replace(/\.$/, '')}. ${teremszam}. terem`;
  } else {
    // Ha nincs teremszám, csak a cím
    formattedAddress = formattedAddress.replace(/\.$/, '');
  }
  
  // Üdvözlés: Tisztelt Vezetknév Keresztnév Úr/Hölgy
  let greeting = 'Tisztelt';
  if (patientName) {
    const nameParts = patientName.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      const vezeteknev = nameParts[0];
      const keresztnev = nameParts.slice(1).join(' ');
      const title = patientNem === 'no' ? 'Hölgy' : patientNem === 'ferfi' ? 'Úr' : '';
      greeting = `Tisztelt ${vezeteknev} ${keresztnev} ${title}`.trim();
    } else {
      greeting = `Tisztelt ${patientName}`;
    }
  } else {
    greeting = 'Tisztelt Beteg';
  }
  
  // Kapcsolattartási információk - duplikáció elkerülése és címkézés
  let contactText = 'rendszerünkön keresztül';
  if (adminEmail && dentistEmail) {
    const adminEmailLower = adminEmail.toLowerCase();
    const dentistEmailLower = dentistEmail.toLowerCase();
    
    if (adminEmailLower === dentistEmailLower) {
      // Ha ugyanaz az email, csak egyszer jelenítjük meg, de jelezzük mindkét szerepkört
      contactText = `az adminisztrátorral (${adminEmail}) vagy a kezelőorvossal (${dentistEmail})`;
    } else {
      // Ha különböző email-ek, külön jelenítjük meg címkével
      const parts: string[] = [];
      parts.push(`az adminisztrátorral (${adminEmail})`);
      parts.push(`a kezelőorvossal (${dentistEmail})`);
      contactText = parts.join(' vagy ');
    }
  } else if (adminEmail) {
    contactText = `az adminisztrátorral (${adminEmail})`;
  } else if (dentistEmail) {
    contactText = `a kezelőorvossal (${dentistEmail})`;
  }
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új időpont foglalás</h2>
      <p>${greeting}!</p>
      <p>Időpontfoglalását sikeresen rögzítettük:</p>
      <ul>
        <li><strong>Időpont:</strong> ${formattedDate}</li>
        <li><strong>Cím:</strong> ${formattedAddress}</li>
        <li><strong>Kezelőorvos:</strong> ${dentistFullName}</li>
      </ul>
      <p>Kérjük pontosan érkezzen! Ha bármilyen kérdése van, vagy módosítani szeretné az időpontot, kérjük, lépjen kapcsolatba velünk a ${contactText} elérhetőségeken.</p>
      <p>Az időpont részleteit a mellékelt naptár fájlban találja, amelyet importálhat naptárkezelő alkalmazásába.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject: 'Új időpont foglalás - Maxillofaciális Rehabilitáció',
    html,
    attachments: [
      {
        filename: 'appointment.ics',
        content: icsFile,
        contentType: 'text/calendar',
      },
    ],
  });
}

/**
 * Send appointment booking notification to admins
 */
export async function sendAppointmentBookingNotificationToAdmins(
  adminEmails: string[],
  patientName: string | null,
  patientTaj: string | null,
  appointmentTime: Date,
  surgeonName: string,
  dentistName: string,
  icsFile: Buffer,
  cim?: string | null,
  teremszam?: string | null
): Promise<void> {
  if (adminEmails.length === 0) {
    return;
  }

  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = cim || DEFAULT_CIM;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új időpont foglalás</h2>
      <p>Kedves adminisztrátor,</p>
      <p>Egy új időpont lett lefoglalva:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Cím:</strong> ${displayCim}</li>
        ${teremszam ? `<li><strong>Teremszám:</strong> ${teremszam}</li>` : ''}
        <li><strong>Fogpótlástanász:</strong> ${dentistName}</li>
        <li><strong>Beutaló orvos:</strong> ${surgeonName}</li>
      </ul>
      <p>Az időpont részleteit a mellékelt naptár fájlban találja, amelyet importálhat naptárkezelő alkalmazásába.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: adminEmails,
    subject: 'Új időpont foglalás - Maxillofaciális Rehabilitáció',
    html,
    attachments: [
      {
        filename: 'appointment.ics',
        content: icsFile,
        contentType: 'text/calendar',
      },
    ],
  });
}

/**
 * Send appointment cancellation notification to dentist
 */
export async function sendAppointmentCancellationNotification(
  dentistEmail: string,
  patientName: string | null,
  patientTaj: string | null,
  appointmentTime: Date,
  cancelledBy: string
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Időpont lemondva</h2>
      <p>Kedves fogpótlástanász,</p>
      <p>Egy időpont lemondásra került:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Lemondta:</strong> ${cancelledBy}</li>
      </ul>
      <p>Az időpont újra elérhetővé vált a rendszerben.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: dentistEmail,
    subject: 'Időpont lemondva - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Send appointment cancellation notification to patient
 */
export async function sendAppointmentCancellationNotificationToPatient(
  patientEmail: string,
  patientName: string | null,
  appointmentTime: Date,
  dentistName: string
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Időpont lemondva</h2>
      <p>Kedves ${patientName || 'Beteg'}!</p>
      <p>Időpontfoglalását lemondtuk:</p>
      <ul>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Fogpótlástanász:</strong> ${dentistName}</li>
      </ul>
      <p>Ha új időpontot szeretne foglalni, kérjük, lépjen kapcsolatba velünk.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject: 'Időpont lemondva - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Send appointment modification notification to dentist
 */
export async function sendAppointmentModificationNotification(
  dentistEmail: string,
  patientName: string | null,
  patientTaj: string | null,
  oldAppointmentTime: Date,
  newAppointmentTime: Date,
  modifiedBy: string,
  icsFile: Buffer
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #f59e0b;">Időpont módosítva</h2>
      <p>Kedves fogpótlástanász,</p>
      <p>Egy időpont módosításra került:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Régi időpont:</strong> ${oldAppointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Új időpont:</strong> ${newAppointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Módosította:</strong> ${modifiedBy}</li>
      </ul>
      <p>Az új időpont részleteit a mellékelt naptár fájlban találja, amelyet importálhat naptárkezelő alkalmazásába.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: dentistEmail,
    subject: 'Időpont módosítva - Maxillofaciális Rehabilitáció',
    html,
    attachments: [
      {
        filename: 'appointment.ics',
        content: icsFile,
        contentType: 'text/calendar',
      },
    ],
  });
}

/**
 * Send appointment modification notification to patient
 */
export async function sendAppointmentModificationNotificationToPatient(
  patientEmail: string,
  patientName: string | null,
  oldAppointmentTime: Date,
  newAppointmentTime: Date,
  dentistName: string,
  icsFile: Buffer
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #f59e0b;">Időpont módosítva</h2>
      <p>Kedves ${patientName || 'Beteg'}!</p>
      <p>Időpontfoglalását módosítottuk:</p>
      <ul>
        <li><strong>Régi időpont:</strong> ${oldAppointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Új időpont:</strong> ${newAppointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Fogpótlástanász:</strong> ${dentistName}</li>
      </ul>
      <p>Kérjük, hogy az új időpontot tartsa be. Ha bármilyen kérdése van, kérjük, lépjen kapcsolatba velünk.</p>
      <p>Az új időpont részleteit a mellékelt naptár fájlban találja, amelyet importálhat naptárkezelő alkalmazásába.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject: 'Időpont módosítva - Maxillofaciális Rehabilitáció',
    html,
    attachments: [
      {
        filename: 'appointment.ics',
        content: icsFile,
        contentType: 'text/calendar',
      },
    ],
  });
}

/**
 * Send appointment time slot freed notification (when patient is deleted)
 */
export async function sendAppointmentTimeSlotFreedNotification(
  recipientEmail: string | string[],
  patientName: string | null,
  patientTaj: string | null,
  appointmentTime: Date,
  deletedBy: string,
  dentistEmail?: string | null
): Promise<void> {
  const isAdmin = Array.isArray(recipientEmail);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #059669;">Időpont felszabadult</h2>
      <p>Kedves ${isAdmin ? 'adminisztrátor' : 'fogpótlástanász'},</p>
      <p>Egy időpont felszabadult, mert a beteg törölve lett a rendszerből:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
        ${dentistEmail ? `<li><strong>Fogpótlástanász:</strong> ${dentistEmail}</li>` : ''}
        <li><strong>Törölte:</strong> ${deletedBy}</li>
      </ul>
      <p>Az időpont újra elérhetővé vált a rendszerben és újra lefoglalható.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: recipientEmail,
    subject: 'Időpont felszabadult - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Send registration notification to admins
 */
export async function sendRegistrationNotificationToAdmins(
  adminEmails: string[],
  userEmail: string,
  userName: string,
  role: string,
  institution: string,
  accessReason: string,
  registrationDate: Date
): Promise<void> {
  if (adminEmails.length === 0) {
    return;
  }

  // Szerepkör leképezés felhasználóbarát névre
  const roleMap: Record<string, string> = {
    'sebészorvos': 'Sebész',
    'fogpótlástanász': 'Fogpótlástanász',
    'technikus': 'Technikus',
    'admin': 'Adminisztrátor',
    'editor': 'Szerkesztő',
    'viewer': 'Megtekintő',
  };
  const roleDisplayName = roleMap[role] || role;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új regisztráció</h2>
      <p>Kedves adminisztrátor,</p>
      <p>Egy új felhasználó regisztrált a rendszerben és jóváhagyásra vár:</p>
      <ul>
        <li><strong>Email cím:</strong> ${userEmail}</li>
        <li><strong>Név:</strong> ${userName}</li>
        <li><strong>Szerepkör:</strong> ${roleDisplayName}</li>
        <li><strong>Intézmény:</strong> ${institution}</li>
        <li><strong>Hozzáférés indoklása:</strong> ${accessReason}</li>
        <li><strong>Regisztráció dátuma:</strong> ${registrationDate.toLocaleString('hu-HU')}</li>
      </ul>
      <p>Kérjük, jelentkezzen be az adminisztrációs felületre, hogy jóváhagyja vagy elutasítsa a regisztrációt.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: adminEmails,
    subject: 'Új regisztráció - Maxillofaciális Rehabilitáció',
    html,
  });
}
