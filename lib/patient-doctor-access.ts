/**
 * Patient ↔ doctor jogosultsági kontrakt.
 *
 * A 027-es migráció óta a `patients.kezeleoorvos_user_id` az SSoT az aktuális
 * kezelőorvosra. Mivel egy beteget több éven át több orvos is kezelhet, az
 * üzenet- és érintkezési napló jogosultság-ellenőrzés NEM állhat csak a
 * jelenlegi kezelőorvoson:
 *
 *   • Az új beteg-üzenet recipient_doctor_id-je az AKTUÁLIS kezelőorvos.
 *   • A korábbi (ex-) kezelőorvosok továbbra is láthatják a saját korszakuk
 *     üzeneteit / érintkezési naplóját, hogy ne vesszen el a kontextus.
 *
 * Ez a helper egyetlen kérdést válaszol meg: „valaha kezelte-e ezt a beteget
 * az adott felhasználó?" — ami akkor igaz, ha bármelyik teljesül:
 *   1. Ő a jelenlegi `patients.kezeleoorvos_user_id`.
 *   2. Volt olyan `patient_episodes.assigned_provider_id`-je, ami az ő user_id-je.
 *   3. Volt olyan `appointments` sora a betegnek, ahol a `dentist_email` az
 *      ő (users.email) címe (lemondott / elutasított is számít — történet).
 *
 * Backward-compat: a régi `patients.kezeleoorvos` VARCHAR mezőt is figyelembe
 * vesszük, hogy a backfill előtti betegeknél ne vesszen el a hozzáférés.
 *
 * Ezt a függvényt a következő helyek használják:
 *   - app/api/messages/route.ts            (POST + GET jogosultság check)
 *   - app/api/communication-logs/route.ts  (GET + POST jogosultság check)
 *
 * Az adminoknak mindig joguk van — ezt itt NEM kezeljük; a hívó döntse el,
 * hogy admin-ot előbb átengedi-e.
 */

import { getDbPool } from './db';
import { validateUUID } from './validation';

/**
 * Igaz, ha a felhasználó valaha kezelte / kapcsolatban volt a beteggel az
 * üzenet/napló jogosultság szempontjából.
 *
 * Egyetlen összevont SQL-ben futtatjuk, hogy egy round-tripben kapjunk
 * választ — a hot path (üzenet GET) ne lassuljon.
 */
export async function hasEverTreatedPatient(
  userId: string,
  patientId: string
): Promise<boolean> {
  const validatedUserId = validateUUID(userId, 'Felhasználó ID');
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT (
       -- 1) Jelenlegi kezelőorvos (canonical, 027 óta)
       EXISTS (
         SELECT 1 FROM patients p
          WHERE p.id = $2 AND p.kezeleoorvos_user_id = $1
       )
       OR
       -- 2) Volt-e valaha epizód provider
       EXISTS (
         SELECT 1 FROM patient_episodes pe
          WHERE pe.patient_id = $2 AND pe.assigned_provider_id = $1
       )
       OR
       -- 3) Volt-e valaha időpontja (lemondott/elutasított is számít — történet)
       EXISTS (
         SELECT 1 FROM appointments a
           JOIN users u ON u.email = a.dentist_email
          WHERE a.patient_id = $2 AND u.id = $1
       )
       OR
       -- 4) Backward-compat: régi VARCHAR kezeleoorvos mező a backfill
       --    előtti betegeknél (név vagy email egyezés).
       EXISTS (
         SELECT 1 FROM patients p
           JOIN users u ON u.id = $1
          WHERE p.id = $2
            AND p.kezeleoorvos IS NOT NULL
            AND p.kezeleoorvos <> ''
            AND (p.kezeleoorvos = u.email OR p.kezeleoorvos = u.doktor_neve)
       )
     ) AS allowed`,
    [validatedUserId, validatedPatientId]
  );

  return result.rows[0]?.allowed === true;
}
