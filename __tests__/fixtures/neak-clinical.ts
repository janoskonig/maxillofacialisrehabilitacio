import type { Patient } from '@/lib/types';
import type { NeakTreatmentSources } from '@/lib/neak-treatment-content';

/** Synthetic patient for regression tests and printable examples. */
export const neakClinicalPatient: Partial<Patient> = {
  id: 'synthetic-neak-patient', nev: 'MINTA - nem valós beteg', taj: '000000000',
  meglevoFogak: {
    '11': { base: 'crown', description: 'Meglévő korona' },
    '12': { base: 'root_canal', periapical: true, description: 'Korábbi gyökérkezelés' },
    '13': { base: 'bridge_abutment' }, '14': { base: 'bridge_pontic' },
    '15': { base: 'filled', caries: true, mobility: 2, surfaces: { mesial: 'caries', occlusal: 'filling' } },
    '16': { base: 'inlay' }, '17': { status: 'M' }, '18': { base: 'impacted' },
    '21': { base: 'implant' }, '22': { base: 'root_remnant' },
    '23': { base: 'necrotic' }, '24': { base: 'denture_tooth' },
    '25': { status: 'F', description: 'Korábbi tömés' },
    '26': { status: 'D' }, '27': 'Kérdéses megtarthatóság',
    '31': { base: 'sound', surfaces: { mesial: 'caries' } },
    '36': { base: 'filled', surfaces: { occlusal: 'filling' } },
    '41': { base: 'sound', mobility: 1 },
  },
  felsoFogpotlasVan: true, felsoFogpotlasTipus: 'rögzített fogpótlás fogakon elhorgonyozva',
  felsoFogpotlasMikor: '2020', felsoFogpotlasKeszito: 'Korábbi ellátó',
  felsoFogpotlasElegedett: false, felsoFogpotlasProblema: 'Rágás közbeni panasz.',
  fabianFejerdyProtetikaiOsztalyFelso: '2A',
  alsoFogpotlasVan: false, fabianFejerdyProtetikaiOsztalyAlso: '0',
  meglevoImplantatumok: { '21': 'Rögzített implantátum, részletek az adatlapon', '46': 'Külön nyilvántartásban rögzített implantátum' },
  nemIsmertPoziciokbanImplantatum: true,
  nemIsmertPoziciokbanImplantatumRészletek: 'Korábbi dokumentáció alapján; pozíció nincs megadva.',
  kezelesiTervFelso: [{ treatmentTypeCode: 'complete', tervezettAtadasDatuma: '2026-12-10', elkeszult: false }],
  kezelesiTervAlso: [{ tipus: 'Korábban rögzített fogpótlás', elkeszult: true }],
  kezelesiTervArcotErinto: [{ tipus: 'orrepitézis', elhorgonyzasEszkoze: 'mágnes', elkeszult: false }],
  kezelesiTervMelleklet: 'Rögzített szöveges terv mintája.\nA felső és alsó rehabilitáció külön megjegyzésekkel szerepel.',
};

export const neakClinicalSources: NeakTreatmentSources = {
  labels: new Map([['complete', 'Teljes lemezes fogpótlás']]),
  toothTreatments: [
    { id: 't1', toothNumber: 15, treatmentCode: 'tomes', labelHu: 'Tömés', status: 'pending', notes: 'A rögzített felszíni igényhez kapcsolódó megjegyzés.' },
    { id: 't2', toothNumber: 12, treatmentCode: 'gyokerkezeles', labelHu: 'Gyökérkezelés', status: 'episode_linked' },
    { id: 't3', toothNumber: 36, treatmentCode: 'tomes', labelHu: 'Tömés', status: 'completed', completedAt: '2026-09-20' },
  ],
  episodes: [{ id: 'e1', caseTitle: 'Felső rehabilitáció', chiefComplaint: 'Rögzített kezelési cél mintája', treatmentTypeLabel: 'Teljes lemezes fogpótlás', status: 'open' }],
  warnings: [],
};
