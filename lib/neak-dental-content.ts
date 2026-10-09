import { normalizeToothData, type ToothStatus } from '@/lib/tooth-data';
import { BASE_LABELS, readConditions, hasCaries, computeDMFT, UPPER_ROW, LOWER_ROW } from '@/components/patient-form/odontogram/tooth-conditions';
import { describeSurfaces } from '@/components/patient-form/odontogram/tooth-surfaces';
import type { Patient } from '@/lib/types';

export const DENTAL_CODES = {
  sound: 'É', missing: 'H', filled: 'T', crown: 'K', root_canal: 'GY', inlay: 'IN',
  implant: 'I', bridge_abutment: 'HK', bridge_pontic: 'HT', root_remnant: 'GYM',
  impacted: 'R', necrotic: 'N', denture_tooth: 'MF',
} as const;

export function buildDentalExportContent(patient: Partial<Patient>) {
  const raw = patient.meglevoFogak;
  const hasStatus = raw != null && typeof raw === 'object' && !Array.isArray(raw);
  const fogak = hasStatus ? raw as Record<string, ToothStatus> : {};
  const rows = [...UPPER_ROW, ...LOWER_ROW].map((number) => {
    const key = String(number);
    const normalized = normalizeToothData(fogak[key]);
    const explicit = normalized != null && Object.keys(normalized).length > 0;
    const condition = readConditions(fogak[key]);
    const parts: string[] = [];
    if (explicit) {
      if (normalized?.base || normalized?.status) {
        parts.push(condition.base === 'sound' && hasCaries(condition) ? 'Természetes fog' : BASE_LABELS[condition.base] ?? 'Ismeretlen alapállapot');
      }
      if (hasCaries(condition)) parts.push('Szuvasodás');
      if (condition.periapical) parts.push('Periapikális elváltozás');
      if (condition.mobility > 0) parts.push(`Mobilitás: ${condition.mobility}`);
      const surfaces = describeSurfaces(number, condition.surfaces ?? {});
      if (surfaces) parts.push(`Felszínek - ${surfaces}`);
      if (condition.description?.trim()) parts.push(`Megjegyzés: ${condition.description.trim()}`);
      if (parts.length === 0) parts.push('Nincs részletes jelölés');
    }
    return {
      number, explicit, detail: parts.join('; '),
      code: !hasStatus ? '?' : !explicit ? 'É*' : condition.base === 'sound' && hasCaries(condition) ? 'D' :
        !normalized?.base && !normalized?.status ? '?' : `${DENTAL_CODES[condition.base] ?? '?'}${hasCaries(condition) ? '+D' : ''}`,
      base: condition.base,
    };
  });
  const filtered = Object.fromEntries(rows.filter((r) => r.explicit).map((r) => [String(r.number), fogak[String(r.number)]]));
  const index = computeDMFT(filtered);
  const notes = [
    'A dokumentum a jelenleg mentett odontogramot mutatja; az export kelte nem a vizsgálat dátuma.',
    hasStatus ? 'É*: az adatlap alapértelmezett ép jelölése; nincs külön fogszintű bejegyzés.' : 'Nincs rögzített fogazati státusz.',
    'A D/F/M összesítés az adatlap jelöléseiből számított érték; a foghiány okát nem állapítja meg.',
  ];
  return { hasStatus, rows, index, notes };
}

export function dentalProsthesisLines(patient: Partial<Patient>, jaw: 'upper' | 'lower'): string[] {
  const upper = jaw === 'upper';
  const present = upper ? patient.felsoFogpotlasVan : patient.alsoFogpotlasVan;
  const type = upper ? patient.felsoFogpotlasTipus : patient.alsoFogpotlasTipus;
  const when = upper ? patient.felsoFogpotlasMikor : patient.alsoFogpotlasMikor;
  const maker = upper ? patient.felsoFogpotlasKeszito : patient.alsoFogpotlasKeszito;
  const satisfied = upper ? patient.felsoFogpotlasElegedett : patient.alsoFogpotlasElegedett;
  const problem = upper ? patient.felsoFogpotlasProblema : patient.alsoFogpotlasProblema;
  const lines = [`Meglévő fogpótlás: ${present === true ? 'van' : present === false ? 'nincs' : 'nincs adat'}`];
  if (type) lines.push(`Típus: ${type}`);
  if (when) lines.push(`Készítés ideje: ${when}`);
  if (maker) lines.push(`Készítő: ${maker}`);
  if (satisfied != null) lines.push(`Elégedett vele: ${satisfied ? 'igen' : 'nem'}`);
  if (problem) lines.push(`Panasz: ${problem}`);
  const classification = upper ? patient.fabianFejerdyProtetikaiOsztalyFelso : patient.fabianFejerdyProtetikaiOsztalyAlso;
  if (classification) lines.push(`Fábián-Fejérdy foghiányosztály: ${classification}`);
  return lines;
}
