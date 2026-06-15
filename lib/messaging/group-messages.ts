/**
 * group-messages — tiszta (pure) segédfüggvények az üzenetlista
 * vizualizációs csoportosításához. Korábban ez a logika inline duplikálódott a
 * `DoctorMessages.tsx`, `PatientMessagesList.tsx` és a portál
 * `PatientMessages.tsx` komponensekben; itt egyszer, tesztelhetően él.
 *
 * Két dolgot ad:
 *  - **Nap-elválasztó** (`showDaySeparator` + `dayLabel`): "Ma" / "Tegnap" /
 *    "yyyy. MMMM d." a magyar locale szerint.
 *  - **Egymást követő üzenet-csoportosítás** (`isFirstInGroup` /
 *    `isLastInGroup`): ugyanattól a feladótól rövid időablakon belül érkező
 *    üzenetek egy vizuális blokkba kerülnek (avatar + név csak egyszer, "farok"
 *    csak az utolsó buborékon).
 */

import { isToday, isYesterday, isSameDay, format } from 'date-fns';
import { hu } from 'date-fns/locale';

/** Egy üzenet két mezője kell a csoportosításhoz — csatorna-független. */
export interface GroupableMessage {
  senderId: string;
  createdAt: Date | string;
}

export interface DecoratedMessage<M> {
  message: M;
  /** Igaz, ha az üzenet előtt nap-elválasztót kell renderelni. */
  showDaySeparator: boolean;
  /** A nap-elválasztó címkéje, ha `showDaySeparator` igaz — különben `null`. */
  dayLabel: string | null;
  /** Igaz, ha ez a feladó egymást követő blokkjának első üzenete. */
  isFirstInGroup: boolean;
  /** Igaz, ha ez a feladó egymást követő blokkjának utolsó üzenete. */
  isLastInGroup: boolean;
}

/** Egymást követő üzenetek max. időtávolsága, hogy egy blokkba kerüljenek (5 perc). */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Ma" / "Tegnap" / "yyyy. MMMM d." — a meglévő inline logikával megegyezően. */
export function dayLabel(date: Date): string {
  if (isToday(date)) return 'Ma';
  if (isYesterday(date)) return 'Tegnap';
  return format(date, 'yyyy. MMMM d.', { locale: hu });
}

/**
 * Az üzenetlistát (időrendben, növekvő `createdAt`) dekorálja a renderhez
 * szükséges nap-elválasztó és blokk-pozíció flagekkel. Nem mutálja a bemenetet.
 */
export function decorateMessages<M extends GroupableMessage>(
  messages: M[],
): DecoratedMessage<M>[] {
  return messages.map((message, index) => {
    const date = toDate(message.createdAt);
    const prev = index > 0 ? messages[index - 1] : null;
    const next = index < messages.length - 1 ? messages[index + 1] : null;
    const prevDate = prev ? toDate(prev.createdAt) : null;
    const nextDate = next ? toDate(next.createdAt) : null;

    const showDaySeparator = !prevDate || !isSameDay(date, prevDate);

    const sameSenderAsPrev =
      !!prev &&
      !showDaySeparator &&
      prev.senderId === message.senderId &&
      !!prevDate &&
      date.getTime() - prevDate.getTime() <= GROUP_WINDOW_MS;

    const nextStartsNewDay = nextDate ? !isSameDay(nextDate, date) : true;
    const sameSenderAsNext =
      !!next &&
      !nextStartsNewDay &&
      next.senderId === message.senderId &&
      !!nextDate &&
      nextDate.getTime() - date.getTime() <= GROUP_WINDOW_MS;

    return {
      message,
      showDaySeparator,
      dayLabel: showDaySeparator ? dayLabel(date) : null,
      isFirstInGroup: !sameSenderAsPrev,
      isLastInGroup: !sameSenderAsNext,
    };
  });
}
