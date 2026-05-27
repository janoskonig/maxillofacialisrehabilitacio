/** Fázis 4.2 — Szál toggle gomb felirata. */
export function replyThreadToggleLabel(replyCount: number, collapsed: boolean): string {
  if (replyCount <= 0) return '';
  if (collapsed) {
    return `${replyCount} rejtett válasz — megjelenítés`;
  }
  return `${replyCount} válasz — összecsukás`;
}
