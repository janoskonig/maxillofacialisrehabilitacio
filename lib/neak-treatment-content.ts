import type { Patient } from '@/lib/types';

export interface NeakToothTreatment {
  id: string;
  toothNumber: number;
  treatmentCode: string;
  labelHu?: string | null;
  status: string;
  notes?: string | null;
  completedAt?: Date | string | null;
}

export interface NeakEpisodeTreatment {
  id: string;
  caseTitle?: string | null;
  chiefComplaint?: string | null;
  status: string;
  treatmentTypeLabel?: string | null;
}

export interface NeakTreatmentSources {
  labels: Map<string, string>;
  toothTreatments: NeakToothTreatment[];
  episodes: NeakEpisodeTreatment[];
  warnings: string[];
}

export interface NeakTreatmentSection { title: string; lines: string[] }

export function treatmentLabel(item: { treatmentTypeCode?: string | null; tipus?: string | null }, labels: Map<string, string>): string {
  const code = item.treatmentTypeCode?.trim();
  return (code && labels.get(code)) || item.tipus?.trim() || (code ? `Ismeretlen kezeléstípus (${code})` : 'Kezeléstípus nincs megadva');
}

function formatDate(value?: Date | string | null): string {
  if (!value) return '';
  if (value instanceof Date) return value.toLocaleDateString('hu-HU');
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return day ? `${day[1]}.${day[2]}.${day[3]}.` : value;
}

/** Export only recorded content. Keep clinical plans and episode context labelled. */
export function buildTreatmentExportContent(patient: Partial<Patient>, sources: NeakTreatmentSources) {
  const sections: NeakTreatmentSection[] = [];
  const add = (title: string, lines: string[]) => { if (lines.length) sections.push({ title, lines }); };
  const jaws = [
    ['Felső állcsont - adatlapon rögzített terv', patient.kezelesiTervFelso],
    ['Alsó állcsont - adatlapon rögzített terv', patient.kezelesiTervAlso],
  ] as const;
  for (const [title, items] of jaws) {
    add(title, (Array.isArray(items) ? items : []).map((item, i) => {
      const date = formatDate(item.tervezettAtadasDatuma);
      return `${i + 1}. ${treatmentLabel(item, sources.labels)}; állapot: ${item.elkeszult ? 'elkészült' : 'tervezett'}${date ? `; tervezett átadás: ${date}` : ''}`;
    }));
  }
  add('Arcot érintő rehabilitáció - adatlapon rögzített terv', (patient.kezelesiTervArcotErinto ?? []).map((item, i) => {
    const date = formatDate(item.tervezettAtadasDatuma);
    return `${i + 1}. ${item.tipus}; állapot: ${item.elkeszult ? 'elkészült' : 'tervezett'}${item.elhorgonyzasEszkoze ? `; elhorgonyzás: ${item.elhorgonyzasEszkoze}` : ''}${date ? `; tervezett átadás: ${date}` : ''}`;
  }));
  if (patient.kezelesiTervMelleklet?.trim()) add('Részletes kezelési terv / melléklet szövege', [patient.kezelesiTervMelleklet.trim()]);
  const sorted = [...sources.toothTreatments].sort((a, b) => a.toothNumber - b.toothNumber || a.id.localeCompare(b.id));
  const toothLine = (item: NeakToothTreatment) => {
    const label = item.labelHu?.trim() || item.treatmentCode;
    const completed = item.status === 'completed';
    const status = completed ? 'elkészült' : item.status === 'episode_linked' ? 'epizódhoz kapcsolt igény' : 'tervezett igény';
    const date = completed ? formatDate(item.completedAt) : '';
    return `${item.toothNumber}. fog: ${label}; állapot: ${status}${date ? `; elkészült: ${date}` : ''}${item.notes?.trim() ? `\nMegjegyzés: ${item.notes.trim()}` : ''}`;
  };
  add('Fogankénti kezelési igények', sorted.filter((t) => t.status !== 'completed').map(toothLine));
  add('Elkészült fogankénti kezelések', sorted.filter((t) => t.status === 'completed').map(toothLine));
  add('Aktív ellátási epizódok - kezelési összefüggések', sources.episodes.filter((ep) => ep.status !== 'closed').map((ep) => {
    const title = ep.caseTitle?.trim() || ep.chiefComplaint?.trim() || 'Ellátási epizód';
    return `${title}${ep.treatmentTypeLabel ? `; kezelés: ${ep.treatmentTypeLabel}` : ''}; állapot: ${ep.status === 'paused' ? 'szünetel' : 'nyitott'}${ep.caseTitle && ep.chiefComplaint && ep.caseTitle !== ep.chiefComplaint ? `\nPanasz / cél: ${ep.chiefComplaint}` : ''}`;
  }));
  if (sections.length === 0) add('Rögzített kezelési terv', ['Nincs rögzített kezelési terv vagy fogankénti kezelési igény.']);
  const notes = [...sources.warnings, 'A dokumentum kizárólag a rögzített adatokat tartalmazza. A jelenlegi fogstátusz és a tervezett beavatkozások külön dokumentumban szerepelnek.'];
  return { sections, notes };
}

export type NeakTreatmentContent = ReturnType<typeof buildTreatmentExportContent>;

export function treatmentContentToText(patient: Partial<Patient>, content: NeakTreatmentContent): string {
  return [
    'KEZELÉSI TERV', `Beteg: ${patient.nev || 'Nincs név'}`, `TAJ: ${patient.taj || 'Nincs adat'}`, '',
    ...content.sections.flatMap((section) => [section.title.toUpperCase(), ...section.lines, '']),
    'MEGJEGYZÉSEK', ...content.notes,
  ].join('\n');
}
