/**
 * Egy stage_events sor és egy patient_stages-ből származó migrált sor
 * ugyanannak számít, ha epizód + kód + idő másodperc egyezik (migrációs duplikátum).
 */
export function stageTimelineDedupeKey(episodeId: string, stageCode: string, at: Date | string): string {
  const t = typeof at === 'string' ? new Date(at).getTime() : at.getTime();
  if (Number.isNaN(t)) return `${episodeId}|${stageCode}|invalid`;
  const sec = Math.floor(t / 1000);
  return `${episodeId}|${stageCode}|${sec}`;
}
