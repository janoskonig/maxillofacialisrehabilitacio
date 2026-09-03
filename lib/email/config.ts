import nodemailer from 'nodemailer';
import { logOutboundEmail, type EmailLogMetadata } from './outbound-log';
import { canContactPatient } from '@/lib/patient-contact-policy';

// Trim whitespace to avoid authentication issues from copy/paste
const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT?.trim() || '587', 10);
const SMTP_USER = process.env.SMTP_USER?.trim();
const SMTP_PASS = process.env.SMTP_PASS?.trim();
const SMTP_FROM = process.env.SMTP_FROM?.trim();
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME?.trim() || 'Maxillofaciális Rehabilitáció Rendszer';
const SMTP_REPLY_TO = process.env.SMTP_REPLY_TO?.trim() || SMTP_FROM;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  pool: true,
  maxConnections: 1,
  maxMessages: 3,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  tls: {
    rejectUnauthorized: false,
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
  /** Látható másolat (pl. a küldő saját példánya). */
  cc?: string | string[];
  bcc?: string | string[];
  /** Naplózáshoz: pl. consilium_invitation, ohip_reminder, lab_quote */
  emailType?: string;
  metadata?: EmailLogMetadata;
  sentBy?: string;
  /** Ha a címzett beteg, a központi elhunyt-beteg kapuhoz kötelező megadni. */
  patientId?: string;
}

/**
 * Convert HTML to plain text (simple version)
 * Removes HTML tags and converts common entities
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * E-mail dry-run kapcsoló — biztonságos alapértelmezés.
 *
 * Nem-éles környezetben (NODE_ENV !== 'production') a küldés alapból SZÁRAZ:
 * csak naplózunk, SMTP-re semmi nem megy ki — kivéve, ha EMAIL_DRY_RUN=false
 * expliciten engedélyezi. Élesben az EMAIL_DRY_RUN=true kényszerítheti a
 * száraz módot (pl. karbantartáskor). Háttér: 2026-07-03-án egy dev-futtatás
 * valódi betegeknek küldött levelet — ez a kapcsoló ezt zárja ki.
 */
export function isEmailDryRun(env: {
  NODE_ENV?: string;
  EMAIL_DRY_RUN?: string;
} = process.env): boolean {
  if (env.EMAIL_DRY_RUN === 'true') return true;
  if (env.EMAIL_DRY_RUN === 'false') return false;
  return env.NODE_ENV !== 'production';
}

/**
 * Közös levél-váz (fejléc, tartalom, lábléc) — minden kimenő e-mail ezt kapja.
 * Exportált, hogy előnézet/teszt is pontosan azt renderelje, ami kimegy.
 */
export function wrapEmailHtml(contentHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <style>
    /* Mobil: a 40px-es oldalpárna 360px-en elvenné a tartalom felét. */
    @media only screen and (max-width: 600px) {
      .mx-shell { padding: 8px 0 !important; }
      .mx-header { padding: 20px 18px !important; }
      .mx-header h1 { font-size: 18px !important; }
      .mx-content { padding: 22px 18px !important; }
      .mx-footer { padding: 20px 18px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center" class="mx-shell" style="padding: 20px 0;">
        <!--[if mso]><table role="presentation" width="600" align="center" style="border-collapse:collapse;"><tr><td><![endif]-->
        <!-- width:100% + max-width:600px: mobilon a levél a képernyő szélességére húzódik, nem 600px-t zsugorít le a levelezo (apró betű) -->
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td class="mx-header" style="padding: 30px 40px; background-color: #2563eb; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Maxillofaciális Rehabilitáció Rendszer</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td class="mx-content" style="padding: 40px;">
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="mx-footer" style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
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
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
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
  if (options.patientId) {
    const contactAllowed = await canContactPatient(options.patientId);
    if (!contactAllowed) {
      console.warn(`[Email] Betegnek szánt levél kihagyva (nem kontaktálható): patientId=${options.patientId}`);
      return;
    }
  }

  if (isEmailDryRun()) {
    const to = Array.isArray(options.to) ? options.to.join(', ') : options.to;
    console.log(`[Email DRY-RUN] NEM küldött levél — to=${to} subject="${options.subject}"`);
    return;
  }

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    console.error('Email configuration is missing. Please check SMTP_* environment variables.');
    throw new Error('Email configuration is missing');
  }

  console.log(`[Email] Attempting to send email via ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}`);

  try {
    const fromAddress = SMTP_FROM_NAME && SMTP_FROM
      ? `${SMTP_FROM_NAME} <${SMTP_FROM}>`
      : SMTP_FROM;

    const textVersion = options.text || htmlToText(options.html);

    const toRecipients = Array.isArray(options.to) ? options.to : [options.to];
    const bccRecipients = options.bcc 
      ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc])
      : undefined;
    
    const toAddress = toRecipients[0];
    const bccAddresses = bccRecipients || (toRecipients.length > 1 ? toRecipients.slice(1) : undefined);
    const ccAddresses = options.cc
      ? (Array.isArray(options.cc) ? options.cc : [options.cc]).filter(Boolean)
      : [];

    const allRecipients = [
      ...(bccRecipients ? [...toRecipients, ...bccRecipients] : toRecipients),
      ...ccAddresses,
    ];

    const htmlWithMeta = wrapEmailHtml(options.html);

    const mailOptions: any = {
      from: fromAddress,
      to: toAddress,
      replyTo: options.replyTo || SMTP_REPLY_TO,
      subject: options.subject,
      text: textVersion,
      html: htmlWithMeta,
      ...(ccAddresses.length > 0 && { cc: ccAddresses }),
      ...(bccAddresses && bccAddresses.length > 0 && { bcc: bccAddresses }),
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      })),
      headers: {
        'MIME-Version': '1.0',
        'Content-Language': 'hu-HU',
        'X-Mailer': 'Maxillofaciális Rehabilitáció Rendszer',
        'Auto-Submitted': 'no',
        'List-Id': '<maxillofacialis-rehabilitacio.system>',
        'List-Unsubscribe': '<mailto:' + (options.replyTo || SMTP_REPLY_TO) + '>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Auto-Response-Suppress': 'All',
      },
      envelope: {
        from: SMTP_FROM,
        to: allRecipients,
      },
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);

    await logOutboundEmail({
      emailType: options.emailType ?? 'generic',
      recipient: toAddress,
      subject: options.subject,
      messageId: info.messageId ?? null,
      status: 'sent',
      sentBy: options.sentBy ?? null,
      metadata: {
        ...(options.metadata ?? {}),
        ...(ccAddresses.length > 0 ? { cc: ccAddresses.join(', ') } : {}),
        ...(bccAddresses && bccAddresses.length > 0 ? { bcc: bccAddresses.join(', ') } : {}),
      },
    });
  } catch (error) {
    console.error('Error sending email:', error);

    const toRecipients = Array.isArray(options.to) ? options.to : [options.to];
    await logOutboundEmail({
      emailType: options.emailType ?? 'generic',
      recipient: toRecipients[0] ?? 'unknown',
      subject: options.subject,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      sentBy: options.sentBy ?? null,
      metadata: options.metadata,
    });

    throw error;
  }
}
