/**
 * Allowed obstacle keys and the historical TTL defaults (days).
 * New obstacles remain active until explicitly resolved; their expected
 * response date is independent of the legacy expiry mechanism.
 */

export const BLOCK_TAXONOMY: Record<string, number> = {
  WAIT_HISTOLOGY: 14,
  WAIT_QUOTE: 14,
  WAIT_COLLEAGUE: 14,
  WAIT_INSURER: 30,
  WAIT_DOCUMENTS: 14,
  WAIT_LAB: 14,
  WAIT_HEALING: 30,
  WAIT_SURGERY: 60,
  PATIENT_DELAY: 14,
  WAIT_OR: 60,
  WAIT_IMPLANT: 90,
  OTHER: 14,
};

export const RENEWAL_ESCALATION_THRESHOLD = 2;

export function getDefaultTtlDays(key: string): number {
  return BLOCK_TAXONOMY[key] ?? BLOCK_TAXONOMY.OTHER;
}

export function isValidBlockKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(BLOCK_TAXONOMY, key);
}

export const BLOCK_LABELS: Record<string, string> = {
  WAIT_HISTOLOGY: 'Szövettani eredményre várunk',
  WAIT_QUOTE: 'Árajánlatra várunk',
  WAIT_COLLEAGUE: 'Orvoskollégára várunk',
  PATIENT_DELAY: 'Páciensre várunk',
  WAIT_INSURER: 'Biztosítóra / finanszírozóra várunk',
  WAIT_DOCUMENTS: 'Dokumentumra / leletre várunk',
  WAIT_LAB: 'Laborra / fogtechnikára várunk',
  WAIT_HEALING: 'Gyógyulásra várunk',
  WAIT_SURGERY: 'Műtétre várunk',
  WAIT_OR: 'Műtőre várunk',
  WAIT_IMPLANT: 'Implantációra várunk',
  OTHER: 'Egyéb akadály',
};

export function blockLabel(key: string): string {
  return BLOCK_LABELS[key] ?? key;
}

export function describeEpisodeBlocks(blocks: Array<{ key: string; waiting_on?: string | null }>): string {
  return `Akadály: ${blocks.map((block) =>
    `${blockLabel(block.key)}${block.waiting_on ? ` — ${block.waiting_on}` : ''}`
  ).join('; ')}`;
}
