/**
 * Admin aktivitás-digest e-mail előnézet — DB és SMTP nélkül.
 *
 *   npx tsx scripts/preview-admin-digest.ts [kimenet.html]
 *
 * A generált fájl a valódi levél-vázzal (wrapEmailHtml) együtt rendereli a
 * digestet, így böngészőben pontosan az látszik, ami kimegy.
 */
import { writeFileSync } from 'fs';
import { wrapEmailHtml } from '../lib/email/config';
import {
  buildAdminDigestText,
  renderAdminDigestHtml,
  type DigestNotification,
} from '../lib/email/admin-digest-render';
import { formatDateForEmail } from '../lib/email/templates';

const base = new Date('2026-08-20T07:12:00+02:00').getTime();
let id = 0;
const at = (minutes: number) => new Date(base + minutes * 60_000);

function n(
  type: string,
  minutes: number,
  summary: string,
  detail: Record<string, unknown>
): DigestNotification {
  return {
    id: ++id,
    notification_type: type,
    summary_text: summary,
    created_at: at(minutes),
    detail_json: detail,
  };
}

const staff = (email: string) => ({ userEmail: email });
const patient = (name: string, email?: string) => ({ patientName: name, patientEmail: email });

const sample: DigestNotification[] = [
  ...Array.from({ length: 6 }, (_, i) =>
    n('login', i * 3, 'kovacs.anna@szajsebeszet.hu: bejelentkezés', staff('kovacs.anna@szajsebeszet.hu'))
  ),
  ...Array.from({ length: 9 }, (_, i) =>
    n('patients_list_viewed', 4 + i * 2, 'kovacs.anna@szajsebeszet.hu: beteglista megtekintés', staff('kovacs.anna@szajsebeszet.hu'))
  ),
  ...Array.from({ length: 5 }, (_, i) =>
    n('patient_search', 6 + i * 3, 'nagy.peter@szajsebeszet.hu: keresés — "Szabó"', staff('nagy.peter@szajsebeszet.hu'))
  ),
  ...Array.from({ length: 4 }, (_, i) =>
    n('patient_updated', 9 + i * 5, 'nagy.peter@szajsebeszet.hu: Szabó Márta adatai módosítva (anamnézis)', staff('nagy.peter@szajsebeszet.hu'))
  ),
  n('patient_created', 21, 'nagy.peter@szajsebeszet.hu: új beteg felvéve — Tóth Gábor (ep. #482)', staff('nagy.peter@szajsebeszet.hu')),
  n('patient_document_deleted', 33, 'kovacs.anna@szajsebeszet.hu: törölte a "CBCT_2026_03.pdf" dokumentumot (Kiss Ilona)', { deletedBy: 'kovacs.anna@szajsebeszet.hu' }),
  n('impersonate', 46, 'admin@szajsebeszet.hu: imperszonálás — technikus1@labor.hu', staff('admin@szajsebeszet.hu')),
  n('password_reset_failed', 52, 'ismeretlen@example.com: sikertelen jelszó-visszaállítási kísérlet (3. próbálkozás)', staff('ismeretlen@example.com')),
  ...Array.from({ length: 3 }, (_, i) =>
    n('doctor_message_sent', 58 + i * 4, 'technikus1@labor.hu: üzenet — Nagy Péter dr. részére', staff('technikus1@labor.hu'))
  ),
  n('patient_stage_created', 64, 'kovacs.anna@szajsebeszet.hu: stádium — Kiss Ilona → próba', staff('kovacs.anna@szajsebeszet.hu')),
  n('communication_log_created', 70, 'nagy.peter@szajsebeszet.hu: telefonos egyeztetés rögzítve (Tóth Gábor)', staff('nagy.peter@szajsebeszet.hu')),
  n('appointment_approved', 74, 'Kiss Ilona elfogadta a 2026-08-27 10:30 időpontot', patient('Kiss Ilona', 'kiss.ilona@example.com')),
  n('appointment_cancelled_by_patient', 81, 'Szabó Márta lemondta a 2026-08-22 09:00 időpontot', patient('Szabó Márta', 'szabo.marta@example.com')),
  n('new_appointment_request', 86, 'Tóth Gábor új időpontot kért (protetikai kontroll)', patient('Tóth Gábor', 'toth.gabor@example.com')),
  n('patient_portal_registered', 92, 'Új páciens portál regisztráció — Tóth Gábor', patient('Tóth Gábor', 'toth.gabor@example.com')),
  ...Array.from({ length: 2 }, (_, i) =>
    n('patient_login', 95 + i * 6, 'Kiss Ilona bejelentkezett a páciens portálra', patient('Kiss Ilona', 'kiss.ilona@example.com'))
  ),
  n('ohip14_reminder_sent', 104, 'OHIP-14 emlékeztető kiküldve — Szabó Márta (6 hónapos kontroll)', { emailTo: 'szabo.marta@example.com', patientName: 'Szabó Márta' }),
  n('ohip14_created', 110, 'Kiss Ilona kitöltötte az OHIP-14 kérdőívet (baseline)', patient('Kiss Ilona', 'kiss.ilona@example.com')),
  n('time_slot_freed', 112, 'Felszabadult időpont: 2026-08-22 09:00 (Nagy Péter dr.)', {}),
  n('missing_data_no_owner', 115, 'Hiányos beteg kezelőorvos nélkül: Horváth Éva (beutaló, TAJ)', {}),
];

const periodText = `${formatDateForEmail(sample[0].created_at)} – ${formatDateForEmail(
  sample[sample.length - 1].created_at
)}`;

const html = wrapEmailHtml(
  renderAdminDigestHtml(sample, { periodText, appUrl: 'https://rehabilitacios-protetika.hu' })
);
const out = process.argv[2] || 'admin-digest-preview.html';
writeFileSync(out, html, 'utf8');

console.log(buildAdminDigestText(sample, { periodText }));
console.log(`\n--- HTML előnézet: ${out} (${sample.length} esemény) ---`);
