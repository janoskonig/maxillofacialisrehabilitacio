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

    const mailOptions = {
      from: fromAddress,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      replyTo: options.replyTo || SMTP_REPLY_TO,
      subject: options.subject,
      text: textVersion,
      html: options.html,
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      })),
      // Additional headers for better deliverability
      headers: {
        'X-Mailer': 'Maxillofaciális Rehabilitáció Rendszer',
        'X-Priority': '3', // Normal priority
        'Importance': 'normal',
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
  icsFile: Buffer
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új időpont foglalás</h2>
      <p>Kedves fogpótlástanász,</p>
      <p>Egy új időpont lett lefoglalva:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
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
  appointmentTime: Date,
  dentistName: string,
  icsFile: Buffer
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Időpontfoglalás megerősítése</h2>
      <p>Kedves ${patientName || 'Beteg'}!</p>
      <p>Időpontfoglalását sikeresen rögzítettük:</p>
      <ul>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
        <li><strong>Fogpótlástanász:</strong> ${dentistName}</li>
      </ul>
      <p>Kérjük, hogy az időpontot tartsa be. Ha bármilyen kérdése van, vagy módosítani szeretné az időpontot, kérjük, lépjen kapcsolatba velünk.</p>
      <p>Az időpont részleteit a mellékelt naptár fájlban találja, amelyet importálhat naptárkezelő alkalmazásába.</p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject: 'Időpontfoglalás megerősítése - Maxillofaciális Rehabilitáció',
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
  icsFile: Buffer
): Promise<void> {
  if (adminEmails.length === 0) {
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új időpont foglalás</h2>
      <p>Kedves adminisztrátor,</p>
      <p>Egy új időpont lett lefoglalva:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${appointmentTime.toLocaleString('hu-HU')}</li>
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
