import { sendEmail } from './config';
import { formatDateForEmail, formatDateForEmailShort, getBaseUrlForEmail } from './templates';
import { queueAdminNotification } from './admin-notification-queue';

function patientGreeting(name: string | null, nem?: string | null, fallback = 'Betegünk'): string {
  if (name) return `Kedves ${name.trim()}`;
  if (nem === 'no') return 'Tisztelt Asszonyom';
  if (nem === 'ferfi') return 'Tisztelt Uram';
  return `Kedves ${fallback}`;
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
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  userEmail: string,
  resetToken: string,
  request?: { headers?: { get: (name: string) => string | null }; nextUrl?: { origin: string } }
): Promise<void> {
  const baseUrl = getBaseUrlForEmail(request);
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Jelszó-visszaállítás</h2>
      <p>Kedves felhasználó,</p>
      <p>Kérvényt kaptunk a jelszó-visszaállításához. Ha Ön kérte ezt, kattintson az alábbi linkre:</p>
      <p style="margin: 20px 0;">
        <a href="${resetUrl}" 
           clicktracking="off"
           style="background-color: #2563eb; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 5px; display: inline-block;">
          Jelszó visszaállítása
        </a>
      </p>
      <p>Vagy másolja be ezt a linket a böngészőbe:</p>
      <p style="word-break: break-all; color: #666;">${resetUrl}</p>
      <p style="color: #dc2626; font-size: 12px; margin-top: 20px;">
        <strong>Fontos:</strong> Ez a link 1 órán belül lejár. Ha nem Ön kérte a jelszó-visszaállítást, kérjük hagyja figyelmen kívül ezt az emailt. A jelszava nem változik meg.
      </p>
      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer
      </p>
    </div>
  `;

  await sendEmail({
    to: userEmail,
    subject: 'Jelszó-visszaállítás - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * No-op: admin notification is handled by logActivity → daily summary pipeline.
 */
export async function sendPatientCreationNotification(
  _adminEmails: string[],
  _patientName: string | null,
  _taj: string | null,
  _surgeonName: string,
  _creationDate: string
): Promise<void> {}

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
        <li><strong>Időpont:</strong> ${formatDateForEmail(appointmentTime)}</li>
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
  
  const formattedDate = formatDateForEmail(appointmentTime);
  
  let formattedAddress = displayCim.replace(/,/g, '');
  if (teremszam) {
    formattedAddress = `${formattedAddress.replace(/\.$/, '')}. ${teremszam}. terem`;
  } else {
    formattedAddress = formattedAddress.replace(/\.$/, '');
  }
  
  const greeting = patientGreeting(patientName, patientNem);
  
  let contactText = 'rendszerünkön keresztül';
  if (adminEmail && dentistEmail) {
    const adminEmailLower = adminEmail.toLowerCase();
    const dentistEmailLower = dentistEmail.toLowerCase();
    
    if (adminEmailLower === dentistEmailLower) {
      contactText = `az adminisztrátorral (${adminEmail}) vagy a kezelőorvossal (${dentistEmail})`;
    } else {
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
 * No-op: admin notification is handled by the approve route → daily summary pipeline.
 */
export async function sendAppointmentBookingNotificationToAdmins(
  _adminEmails: string[],
  _patientName: string | null,
  _patientTaj: string | null,
  _appointmentTime: Date,
  _surgeonName: string,
  _dentistName: string,
  _icsFile: Buffer,
  _cim?: string | null,
  _teremszam?: string | null
): Promise<void> {}

/**
 * Send appointment cancellation notification to dentist
 */
export async function sendAppointmentCancellationNotification(
  dentistEmail: string,
  patientName: string | null,
  patientTaj: string | null,
  appointmentTime: Date,
  cancelledBy: string,
  cancellationReason?: string | null
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Időpont lemondva</h2>
      <p>Kedves fogpótlástanász,</p>
      <p>Egy időpont lemondásra került:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${formatDateForEmail(appointmentTime)}</li>
        <li><strong>Lemondta:</strong> ${cancelledBy}</li>
        ${cancellationReason ? `<li><strong>Lemondás indoka:</strong> ${cancellationReason}</li>` : ''}
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
        <li><strong>Időpont:</strong> ${formatDateForEmail(appointmentTime)}</li>
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
        <li><strong>Régi időpont:</strong> ${formatDateForEmail(oldAppointmentTime)}</li>
        <li><strong>Új időpont:</strong> ${formatDateForEmail(newAppointmentTime)}</li>
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
        <li><strong>Régi időpont:</strong> ${formatDateForEmail(oldAppointmentTime)}</li>
        <li><strong>Új időpont:</strong> ${formatDateForEmail(newAppointmentTime)}</li>
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
 * Send appointment time slot freed notification (when patient is deleted).
 * For admin recipients (string[]) the notification is queued for daily summary.
 * For individual dentists (string) the email is sent immediately.
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

  if (isAdmin) {
    const name = patientName || 'Név nélküli';
    const time = formatDateForEmailShort(appointmentTime);
    await queueAdminNotification(
      'time_slot_freed',
      `${name} – ${time}, törölte: ${deletedBy}`,
      { patientName: name, patientTaj, appointmentTime: appointmentTime.toISOString(), deletedBy, dentistEmail }
    );
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #059669;">Időpont felszabadult</h2>
      <p>Kedves fogpótlástanász,</p>
      <p>Egy időpont felszabadult, mert a beteg törölve lett a rendszerből:</p>
      <ul>
        <li><strong>Beteg neve:</strong> ${patientName || 'Név nélküli'}</li>
        <li><strong>TAJ szám:</strong> ${patientTaj || 'Nincs megadva'}</li>
        <li><strong>Időpont:</strong> ${formatDateForEmail(appointmentTime)}</li>
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
 * No-op: admin notification is handled by logActivity → daily summary pipeline.
 */
export async function sendRegistrationNotificationToAdmins(
  _adminEmails: string[],
  _userEmail: string,
  _userName: string,
  _role: string,
  _institution: string,
  _accessReason: string,
  _registrationDate: Date
): Promise<void> {}

/**
 * Queue patient portal registration notification for admin daily summary
 */
export async function sendPatientRegistrationNotificationToAdmins(
  adminEmails: string[],
  patientEmail: string,
  patientName: string | null,
  patientTaj: string | null,
  registrationDate: Date
): Promise<void> {
  if (adminEmails.length === 0) return;

  const name = patientName || 'Név nélküli';
  await queueAdminNotification(
    'patient_portal_registered',
    `${name} (${patientEmail}, TAJ: ${patientTaj || '–'})`,
    { patientEmail, patientName: name, patientTaj, registrationDate: registrationDate.toISOString() }
  );
}

/**
 * Queue patient login notification for admin daily summary
 */
export async function sendPatientLoginNotificationToAdmins(
  adminEmails: string[],
  patientEmail: string,
  patientName: string | null,
  patientTaj: string | null,
  loginTime: Date,
  ipAddress: string | null
): Promise<void> {
  if (adminEmails.length === 0) return;

  const name = patientName || 'Név nélküli';
  await queueAdminNotification(
    'patient_login',
    `${name} (${patientEmail})`,
    { patientEmail, patientName: name, patientTaj, loginTime: loginTime.toISOString(), ipAddress }
  );
}

/**
 * Send conditional appointment request to patient
 * Patient can approve or reject the appointment
 */
export async function sendConditionalAppointmentRequestToPatient(
  patientEmail: string,
  patientName: string | null,
  patientNem: string | null,
  appointmentTime: Date,
  dentistFullName: string,
  approvalToken: string,
  baseUrl: string,
  alternativeSlots?: Array<{ id: string; startTime: Date; cim: string | null; teremszam: string | null }>,
  cim?: string | null,
  teremszam?: string | null,
  showAlternatives?: boolean
): Promise<void> {
  const formattedDate = formatDateForEmail(appointmentTime);
  const greeting = patientGreeting(patientName, patientNem);
  
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = cim || DEFAULT_CIM;
  const displayTeremszam = teremszam || null;
  
  let formattedAddress = displayCim.replace(/,/g, '');
  if (displayTeremszam) {
    formattedAddress = `${formattedAddress.replace(/\.$/, '')}. ${displayTeremszam}. terem`;
  } else {
    formattedAddress = formattedAddress.replace(/\.$/, '');
  }

  const approveUrl = `${baseUrl}/api/appointments/approve?token=${approvalToken}`;
  const rejectUrl = `${baseUrl}/api/appointments/reject?token=${approvalToken}`;
  
  let alternativeSlotsHtml = '';
  if (showAlternatives && alternativeSlots && alternativeSlots.length > 0) {
    const altSlotsList = alternativeSlots.map((slot, index) => {
      const altDate = formatDateForEmailShort(slot.startTime);
      const altCim = slot.cim || DEFAULT_CIM;
      const altTerem = slot.teremszam ? ` (${slot.teremszam}. terem)` : '';
      return `<li><strong>Alternatíva ${index + 1}:</strong> ${altDate} - ${altCim.replace(/,/g, '')}${altTerem}</li>`;
    }).join('');
    alternativeSlotsHtml = `
      <p style="margin-top: 20px;"><strong>Alternatív időpontok:</strong></p>
      <ul style="margin-top: 10px;">
        ${altSlotsList}
      </ul>
      <p style="color: #6b7280; font-size: 14px; margin-top: 10px;">
        Ha ez az időpont sem megfelelő, az elvetés után automatikusan a következő alternatívát fogjuk felajánlani.
      </p>
    `;
  }
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Időpontválasztás jóváhagyása</h2>
      <p>${greeting}!</p>
      <p>Időpontfoglalást javasoltunk Önnek:</p>
      <ul>
        <li><strong>Időpont:</strong> ${formattedDate}</li>
        <li><strong>Cím:</strong> ${formattedAddress}</li>
        <li><strong>Kezelőorvos:</strong> ${dentistFullName}</li>
      </ul>
      ${alternativeSlotsHtml}
      <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
        <strong>Fontos:</strong> Kérjük, válaszát az időpontig küldje el.
      </p>
      <p style="margin-top: 20px;">Kérjük, válassza ki az alábbi lehetőségek közül:</p>
      <div style="margin: 30px 0; text-align: center;">
        <a href="${approveUrl}" style="display: inline-block; background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 5px; font-weight: bold;">✓ Elfogadom</a>
        <a href="${rejectUrl}" style="display: inline-block; background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 5px; font-weight: bold;">✗ Elvetem</a>
      </div>
      <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
        Ha a gombok nem működnek, másolja be az alábbi linkeket a böngészőjébe:<br>
        Elfogadás: <a href="${approveUrl}" style="color: #3b82f6;">${approveUrl}</a><br>
        Elvetés: <a href="${rejectUrl}" style="color: #3b82f6;">${rejectUrl}</a>
      </p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject: 'Időpontválasztás jóváhagyása - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Queue conditional appointment notification for admin daily summary
 */
export async function sendConditionalAppointmentNotificationToAdmin(
  adminEmails: string[],
  patientName: string | null,
  patientTaj: string | null,
  patientEmail: string | null,
  appointmentTime: Date,
  dentistFullName: string,
  cim: string | null,
  teremszam: string | null,
  alternativeSlots: Array<{ id: string; startTime: Date; cim: string | null; teremszam: string | null }>,
  createdBy: string
): Promise<void> {
  if (adminEmails.length === 0) return;

  const name = patientName || 'Név nélküli';
  const time = formatDateForEmailShort(appointmentTime);
  await queueAdminNotification(
    'conditional_appointment',
    `${name} – ${time}, kezelőorvos: ${dentistFullName}, létrehozta: ${createdBy}`,
    { patientName: name, patientTaj, patientEmail, appointmentTime: appointmentTime.toISOString(), dentistFullName, cim, teremszam, alternativeSlots: alternativeSlots.length, createdBy }
  );
}

/**
 * Queue new appointment request notification for admin daily summary
 */
export async function sendNewAppointmentRequestToAdmin(
  adminEmails: string[],
  patientName: string | null,
  patientTaj: string | null,
  patientEmail: string | null,
  oldAppointmentTime: Date,
  appointmentId: string
): Promise<void> {
  if (adminEmails.length === 0) return;

  const name = patientName || 'Név nélküli';
  const time = formatDateForEmailShort(oldAppointmentTime);
  await queueAdminNotification(
    'new_appointment_request',
    `${name} (${patientEmail || '–'}) – eredeti időpont: ${time}`,
    { patientName: name, patientTaj, patientEmail, oldAppointmentTime: oldAppointmentTime.toISOString(), appointmentId }
  );
}

/**
 * Send new message notification to recipient
 * Called when a new message is sent (doctor to patient or patient to doctor)
 */
export async function sendNewMessageNotification(
  recipientEmail: string,
  recipientName: string | null,
  recipientNem: string | null,
  senderName: string | null,
  senderType: 'doctor' | 'patient',
  messageSubject: string | null,
  messagePreview: string,
  baseUrl: string
): Promise<void> {
  const fallback = senderType === 'doctor' ? 'Betegünk' : 'Doktor Úr/Hölgy';
  const greeting = patientGreeting(recipientName, recipientNem, fallback);

  const senderLabel = senderType === 'doctor' ? 'orvosától' : 'betegétől';
  const portalLink = senderType === 'doctor' 
    ? `${baseUrl}/patient-portal/messages`
    : `${baseUrl}/messages`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új üzenet érkezett</h2>
      <p>${greeting}!</p>
      <p><strong>Új üzenete érkezett ${senderName ? `a ${senderName} ${senderLabel}` : senderLabel}!</strong></p>
      ${messageSubject ? `<p><strong>Tárgy:</strong> ${messageSubject}</p>` : ''}
      <p style="margin-top: 20px; color: #374151;">
        Az üzenet tartalmának megtekintéséhez kérjük, jelentkezzen be az oldalra.
      </p>
      <p style="margin-top: 20px;">
        <a href="${portalLink}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Bejelentkezés és üzenet megtekintése
        </a>
      </p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
        Ha a gomb nem működik, másolja be az alábbi linket a böngészőjébe:<br>
        <a href="${portalLink}" style="color: #3b82f6;">${portalLink}</a>
      </p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: recipientEmail,
    subject: messageSubject 
      ? `Új üzenet: ${messageSubject} - Maxillofaciális Rehabilitáció`
      : 'Új üzenet - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Send doctor-to-doctor message notification
 */
export async function sendDoctorMessageNotification(
  recipientEmail: string,
  recipientName: string | null,
  senderName: string | null,
  messageSubject: string | null,
  messagePreview: string,
  baseUrl: string
): Promise<void> {
  let greeting = 'Tisztelt';
  if (recipientName) {
    const nameParts = recipientName.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      const vezeteknev = nameParts[0];
      const keresztnev = nameParts.slice(1).join(' ');
      greeting = `Tisztelt ${vezeteknev} ${keresztnev}`;
    } else {
      greeting = `Tisztelt ${recipientName}`;
    }
  } else {
    greeting = 'Tisztelt Kolléga';
  }

  const portalLink = `${baseUrl}/messages`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Új üzenet érkezett kollégától</h2>
      <p>${greeting}!</p>
      <p><strong>Új üzenete érkezett ${senderName ? `a ${senderName} kollégától` : 'egy orvoskollégától'}!</strong></p>
      ${messageSubject ? `<p><strong>Tárgy:</strong> ${messageSubject}</p>` : ''}
      <p style="margin-top: 20px; color: #374151;">
        Az üzenet tartalmának megtekintéséhez kérjük, jelentkezzen be az oldalra.
      </p>
      <p style="margin-top: 20px;">
        <a href="${portalLink}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Bejelentkezés és üzenet megtekintése
        </a>
      </p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
        Ha a gomb nem működik, másolja be az alábbi linket a böngészőjébe:<br>
        <a href="${portalLink}" style="color: #3b82f6;">${portalLink}</a>
      </p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: recipientEmail,
    subject: messageSubject 
      ? `Új üzenet kollégától: ${messageSubject} - Maxillofaciális Rehabilitáció`
      : 'Új üzenet kollégától - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Send appointment reminder email to patient (24 hours before)
 */
export async function sendAppointmentReminderEmail(
  patientEmail: string,
  patientName: string | null,
  patientNem: string | null,
  appointmentTime: Date,
  dentistName: string,
  cim?: string | null,
  teremszam?: string | null
): Promise<void> {
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = cim || DEFAULT_CIM;
  const formattedDate = formatDateForEmail(appointmentTime);
  
  const greeting = patientGreeting(patientName, patientNem);
  
  let formattedAddress = displayCim.replace(/,/g, '');
  if (teremszam) {
    formattedAddress = `${formattedAddress.replace(/\.$/, '')}. ${teremszam}. terem`;
  } else {
    formattedAddress = formattedAddress.replace(/\.$/, '');
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Időpont emlékeztető</h2>
      <p>${greeting}!</p>
      <p>Emlékeztetjük, hogy <strong>holnap</strong> van időpontja:</p>
      <ul>
        <li><strong>Időpont:</strong> ${formattedDate}</li>
        <li><strong>Cím:</strong> ${formattedAddress}</li>
        <li><strong>Fogpótlástanász:</strong> ${dentistName}</li>
      </ul>
      <p style="margin-top: 20px; color: #374151;">
        Kérjük, hogy időben érkezzen az időpontra. Ha bármilyen kérdése van vagy módosítani szeretné az időpontot, kérjük, lépjen kapcsolatba velünk.
      </p>
      <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject: 'Időpont emlékeztető - Maxillofaciális Rehabilitáció',
    html,
  });
}

/**
 * Send OHIP-14 questionnaire reminder to patient
 */
export async function sendOhipReminderEmail(
  patientEmail: string,
  patientName: string | null,
  patientNem: string | null,
  timepoint: string,
  windowClosesAt: Date | null,
  portalUrl: string,
  adminEmails?: string[],
): Promise<void> {
  const timepointLabels: Record<string, string> = {
    T0: 'Protetikai fázis előtt',
    T1: 'Átadás után ~1 hónap',
    T2: 'Átadás után ~6 hónap',
    T3: 'Átadás után ~3 év',
  };
  const label = timepointLabels[timepoint] || timepoint;

  const greeting = patientGreeting(patientName, patientNem);

  const deadlineHtml = windowClosesAt
    ? `<p style="color: #b45309; font-size: 14px; margin-top: 15px;">
        <strong>Határidő:</strong> ${windowClosesAt.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Budapest' })}
      </p>`
    : '';

  const baseUrl = portalUrl.replace(/\/patient-portal.*$/, '');
  const privacyUrl = `${baseUrl}/privacy-hu`;
  const termsUrl = `${baseUrl}/terms-hu`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">OHIP-14 kérdőív kitöltése</h2>
      <p>${greeting}!</p>
      <p>Kérjük, töltse ki a szájegészségével kapcsolatos <strong>OHIP-14</strong> kérdőívet.</p>
      <p>Kitöltendő mérési pont: <strong>${timepoint} – ${label}</strong></p>
      ${deadlineHtml}
      <p style="margin-top: 20px;">A kitöltés néhány percet vesz igénybe, és segít orvosának az Ön kezelésének nyomon követésében.</p>
      <p style="margin-top: 20px;">
        <a href="${portalUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Kérdőív kitöltése
        </a>
      </p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
        Ha a gomb nem működik, másolja be az alábbi linket a böngészőjébe:<br>
        <a href="${portalUrl}" style="color: #3b82f6;">${portalUrl}</a>
      </p>
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0;">
          <strong>Adatkezelési tájékoztató:</strong> Az OHIP-14 kérdőív válaszait a Semmelweis Egyetem Maxillofaciális Rehabilitáció 
          Rendszere az Ön kezelésének tudományos értékelése és a protetikai ellátás minőségének javítása céljából kezeli. 
          Az adatkezelés jogalapja az Ön önkéntes hozzájárulása (GDPR 6. cikk (1) a) és 9. cikk (2) a) pont). 
          A kérdőív kitöltése nem kötelező, és bármikor kérheti adatai törlését a páciens portálon keresztül.
        </p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 8px;">
          <a href="${privacyUrl}" style="color: #3b82f6;">Adatvédelmi Irányelvek</a> &middot; 
          <a href="${termsUrl}" style="color: #3b82f6;">Felhasználási Feltételek</a>
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    to: patientEmail,
    subject: `OHIP-14 kérdőív kitöltése (${timepoint}) - Maxillofaciális Rehabilitáció`,
    html,
    bcc: adminEmails && adminEmails.length > 0 ? adminEmails : undefined,
  });
}
