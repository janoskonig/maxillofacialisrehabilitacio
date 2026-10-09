export const LAB_QUOTE_TARGETS = [
  { id: 'fogtechnika', label: 'Fogtechnika', recipientName: 'Interdental KFT', email: 'idssote@gmail.com' },
  { id: 'implantacio', label: 'Implantációs eszközök (Neoss és Straumann kivételével)', recipientName: 'Balázs Zsuzsi főnővér', email: 'toth-balazs.zsuzsanna@semmelweis.hu' },
  { id: 'neoss', label: 'Neoss eszközök', recipientName: 'Neoss ügyfélszolgálat', email: null },
  { id: 'straumann', label: 'Straumann eszközök', recipientName: 'Interdental ügyfélszolgálat', email: null },
] as const;

export type LabQuoteTargetId = typeof LAB_QUOTE_TARGETS[number]['id'];
export interface LabQuoteTarget {
  id: LabQuoteTargetId;
  label: string;
  recipientName: string;
  email: string | null;
}

export function isLabQuoteTargetId(id: unknown): id is LabQuoteTargetId {
  return LAB_QUOTE_TARGETS.some(target => target.id === id);
}
