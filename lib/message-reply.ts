/**
 * Reply / quoted-message domain helper (Szelet 0.1).
 *
 * Tisztán függvény-szintű réteg: bemenetet validál, scope-ot ellenőriz,
 * preview szöveget vág. Nincs DB hozzáférés — a `lib/communication.ts`,
 * `lib/doctor-communication.ts` és a route-ok hívják majd (Szelet 0.2 / 0.3).
 *
 * A migráció (041_message_replies.sql) garantálja, hogy a `reply_to_message_id`
 * FK saját tábláján belüli — tehát a csatorna-szeparáció DB szinten is áll;
 * itt csak a beszélgetés-szintű ACL-t (group / 1:1 / patient_id) erősítjük meg
 * mielőtt a kliens által megadott target üzenetet idéznénk.
 */

import { isValidUUID, validateUUID } from './validation';
import type { MessageChannel, QuotedMessagePreview } from './types/messaging';

/**
 * A preview szöveg maximális hossza karakterben. A buborékban általában
 * 2 sor fér ki, ez a határ ahhoz elég és nem növeli érdemben a payloadot.
 */
export const QUOTED_MESSAGE_PREVIEW_MAX = 280;

/**
 * Reply target hiányzik vagy nem ehhez a beszélgetéshez tartozik.
 *
 * A `status = 404` mezőt a `handleApiError` (lib/api-error-handler.ts)
 * automatikusan elkapja és HTTP 404-re fordítja — szándékosan NEM 403,
 * hogy ne leakeljük más szálak üzeneteinek létezését.
 */
export class ReplyTargetNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'REPLY_TARGET_NOT_FOUND';
  constructor(message = 'A válasz cél üzenet nem található ebben a beszélgetésben') {
    super(message);
    this.name = 'ReplyTargetNotFoundError';
  }
}

/**
 * Normalizálja a kliensről érkező `replyToMessageId`-t.
 *
 *  - `null` / `undefined` / üres string → `null` (nem reply)
 *  - érvénytelen formátum (nem UUID) → Error (`Érvénytelen ...`)
 *  - érvényes UUID → trimmelt, kisbetűs string
 *
 * @throws Error UUID validáció hibájával — a hívó réteg fordítsa 400-ra.
 */
export function parseReplyToMessageId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error('replyToMessageId formátuma érvénytelen (string elvárt)');
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return validateUUID(trimmed, 'replyToMessageId');
}

/**
 * Preview-vé csonkolja egy üzenet `message` mezőjét.
 *
 *  - sortöréseket szóközre normalizál (a buborékban egysoros előnézet),
 *  - többszörös whitespace-t összevon,
 *  - `max` karakter fölött `…`-vel csonkol.
 *
 * Üres / `null` / nem-string input → üres string.
 */
export function buildQuotedMessagePreviewText(
  raw: unknown,
  max: number = QUOTED_MESSAGE_PREVIEW_MAX,
): string {
  if (raw === null || raw === undefined) return '';
  const asString = typeof raw === 'string' ? raw : String(raw);
  const normalized = asString.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * Doctor-csatorna scope: vagy egy adott group_id-hoz tartozó üzenetek, vagy
 * egy adott két user közötti 1:1 párbeszéd.
 */
export type DoctorReplyScope =
  | { kind: 'group'; groupId: string }
  | { kind: 'direct'; userAId: string; userBId: string };

export interface DoctorReplyTargetRow {
  groupId: string | null;
  senderId: string;
  recipientId: string | null;
}

/**
 * Ellenőrzi, hogy a `doctor_messages` táblából kihúzott target sor
 * tényleg ehhez a beszélgetéshez tartozik-e.
 *
 *  - group scope: target.groupId egyezzen a scope groupId-jával,
 *  - 1:1 scope: target NEM lehet group, és a (sender, recipient) páros
 *    sorrend-független módon meg kell egyezzen a scope két user-jével.
 *
 * Csak boolean-t ad vissza — a hívó dönti el, hogy 404-et vagy 422-t küld.
 */
export function isDoctorReplyTargetInScope(
  target: DoctorReplyTargetRow,
  scope: DoctorReplyScope,
): boolean {
  if (scope.kind === 'group') {
    return target.groupId === scope.groupId;
  }
  if (target.groupId) return false;
  if (!target.recipientId) return false;
  const a = scope.userAId;
  const b = scope.userBId;
  return (
    (target.senderId === a && target.recipientId === b) ||
    (target.senderId === b && target.recipientId === a)
  );
}

export interface PatientReplyTargetRow {
  patientId: string;
}

/**
 * Beteg–orvos csatorna scope: minden üzenetet egy `patient_id` ÉS az ahhoz
 * tartozó láthatóság (recipient_doctor_id / kezelőorvos) szab meg. A
 * recipient-szintű szűrést a hívó SQL réteg végzi (lib/communication.ts) —
 * itt csak azt erősítjük meg, hogy a target a megfelelő beteghez tartozik.
 */
export function isPatientReplyTargetInScope(
  target: PatientReplyTargetRow,
  scope: { patientId: string },
): boolean {
  return target.patientId === scope.patientId;
}

/**
 * Bővített beteg–üzenet target sor a 0.3-as reply gate-hez.
 * A `messages` táblából érkező sor szükséges mezői.
 */
export interface PatientMessageTargetRow {
  patientId: string;
  senderType: 'patient' | 'doctor';
  senderId: string;
  recipientDoctorId: string | null;
}

/**
 * Egy beteg-üzenet "lane"-jét határozza meg: melyik orvosi user_id-hoz
 * tartozik konceptuálisan ez az üzenet.
 *  - patient → doctor: `recipient_doctor_id` (legacy NULL → null lane)
 *  - doctor  → patient: `sender_id` (a küldő orvos)
 *
 * A lane fogalom nem DB-szintű (nincs erre constraint), de GET-en a
 * `lib/communication.ts` `getPatientMessages` ezzel ekvivalens szűrést végez:
 * egy adott doctor csak a saját lane-jét + (treating esetén) a legacy
 * null-lane-t látja. A 0.3 reply gate ezt használja a sender oldali
 * láthatóság-ellenőrzéshez.
 */
export function derivePatientLaneDoctorId(row: PatientMessageTargetRow): string | null {
  return row.senderType === 'patient' ? row.recipientDoctorId : row.senderId;
}

/**
 * Reply küldő kontextusa a beteg csatornán. A discriminált union pontosan
 * azt a két szerepet írja le, amit a route képes előállítani.
 */
export type PatientReplySender =
  | {
      kind: 'doctor';
      doctorId: string;
      isAdmin: boolean;
      /**
       * `hasEverTreatedPatient(doctorId, patientId)` eredménye. A legacy
       * (recipient_doctor_id IS NULL) parent üzenetek csak treating orvosnak
       * vagy admin-nak idézhetők. Ha nem treating és nem admin, ezek elesnek.
       */
      isTreating: boolean;
    }
  | {
      kind: 'patient';
      patientId: string;
      /**
       * A kliens által választott / kezelőorvosra resolved lane. Lehet `null`,
       * ha sem `recipientDoctorId`, sem kezelőorvos nem volt feloldható.
       */
      laneDoctorId: string | null;
    };

/**
 * Eldönti, hogy a reply küldő (`sender`) láthatja-e a `target` üzenetet a
 * GET visibility szabályok szerint. Ez azonos azzal, amit a
 * `lib/communication.ts` `getPatientMessages` lekérdezése visszaad ennek a
 * felhasználónak — így nem lehet "vakon" idézni olyan üzenetet, amit a
 * sender GET-en sem látna.
 *
 * Visszatérési érték:
 *  - `true`: rendben, a reply létrehozható erre a parent-re.
 *  - `false`: a hívó (`sendMessage`) dobjon `ReplyTargetNotFoundError`-t.
 */
export function canPatientReplySenderSeeTarget(
  target: PatientMessageTargetRow,
  sender: PatientReplySender,
  scopePatientId: string,
): boolean {
  if (target.patientId !== scopePatientId) return false;

  if (sender.kind === 'doctor') {
    if (sender.isAdmin) return true;
    // Saját küldemény
    if (target.senderType === 'doctor' && target.senderId === sender.doctorId) return true;
    // Patient → ez az orvos
    if (target.senderType === 'patient' && target.recipientDoctorId === sender.doctorId) {
      return true;
    }
    // Legacy NULL-lane → csak treating orvos
    if (
      target.senderType === 'patient' &&
      target.recipientDoctorId === null &&
      sender.isTreating
    ) {
      return true;
    }
    return false;
  }

  // Patient sender: a választott lane-en belüli üzenetek (incl. legacy null)
  const targetLane = derivePatientLaneDoctorId(target);
  return targetLane === sender.laneDoctorId;
}

/**
 * Type guard / runtime check: UUID-szerűnek tűnik?
 * (Komponáláshoz, hogy a hívó réteg ne kelljen újra importálja a validation modult.)
 */
export function isReplyToMessageIdShape(value: unknown): value is string {
  return typeof value === 'string' && isValidUUID(value);
}

/**
 * DB sorból `QuotedMessagePreview` DTO. A hívó réteg (Fázis 0.2) gondoskodjon
 * róla, hogy csak akkor töltse fel, ha a megtekintő láthatja az eredetit.
 */
export interface BuildQuotedPreviewInput {
  id: string;
  channel: MessageChannel;
  senderId: string;
  senderName: string | null;
  message: string | null;
  createdAt: Date | string;
  deleted?: boolean;
}

export function buildQuotedMessagePreview(input: BuildQuotedPreviewInput): QuotedMessagePreview {
  const createdAt =
    input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt);
  return {
    id: input.id,
    channel: input.channel,
    senderId: input.senderId,
    senderName: input.senderName ?? null,
    message: buildQuotedMessagePreviewText(input.deleted ? '' : input.message ?? ''),
    createdAt,
    deleted: input.deleted ?? false,
  };
}
