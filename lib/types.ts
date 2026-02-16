import { z } from 'zod';

export const patientSchema = z.object({
  // ALAPADATOK
  id: z.string().optional(),
  nev: z.string().optional().nullable().or(z.literal('')),
  taj: z.string()
    .optional()
    .nullable()
    .refine((val) => {
      if (!val || val === '' || val.trim() === '') return true; // Optional field - empty is OK
      // If value is provided, it must be valid
      // Remove dashes for validation
      const cleaned = val.replace(/-/g, '').trim();
      // Should be exactly 9 digits
      return /^\d{9}$/.test(cleaned);
    }, {
      message: 'A TAJ szám formátuma: XXX-XXX-XXX (9 számjegy). Ha nem szeretne megadni, hagyja üresen.'
    })
    .or(z.literal('')),
  telefonszam: z.string()
    .optional()
    .nullable()
    .refine((val) => {
      if (!val || val === '' || val.trim() === '' || val === '+36') return true; // Optional field - empty is OK
      // If value is provided, it must be valid
      // Should start with +36
      if (!val.startsWith('+36')) return false;
      // After +36, should have maximum 11 digits
      const afterPrefix = val.substring(3);
      // Remove spaces, dashes, and other formatting characters
      const digitsOnly = afterPrefix.replace(/\D/g, '');
      return digitsOnly.length <= 11 && digitsOnly.length > 0;
    }, {
      message: 'A telefonszám +36-tal kezdődik és maximum 11 számjegyet tartalmaz (pl. +36123456789). Ha nem szeretne megadni, hagyja üresen.'
    })
    .or(z.literal('')),
  
  // SZEMÉLYES ADATOK
  szuletesiDatum: z.string().optional().nullable(),
  nem: z.enum(['ferfi', 'no']).optional().nullable().or(z.literal('')),
  email: z.string()
    .optional()
    .nullable()
    .refine((val) => {
      if (!val || val === '' || val.trim() === '') return true; // Optional field - empty is OK
      // If value is provided, it must be valid
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(val.trim());
    }, {
      message: 'Érvénytelen email cím formátum. Példa: nev@example.com. Ha nem szeretne megadni, hagyja üresen.'
    })
    .or(z.literal('')),
  cim: z.string().optional().nullable(),
  varos: z.string().optional().nullable(),
  iranyitoszam: z.string().optional().nullable(),
  
  // BEUTALÓ
  beutaloOrvos: z.string().optional().nullable(),
  beutaloIntezmeny: z.string().optional().nullable(),
  beutaloIndokolas: z.string().optional().nullable(),
  mutetIdeje: z.string().optional().nullable(),
  szovettaniDiagnozis: z.string().optional().nullable(),
  nyakiBlokkdisszekcio: z.enum(['nem volt', 'volt, egyoldali', 'volt, kétoldali']).optional().nullable().or(z.literal('')),
  
  // ADJUVÁNS TERÁPIÁK
  radioterapia: z.boolean().default(false),
  radioterapiaDozis: z.string().optional().nullable(),
  radioterapiaDatumIntervallum: z.string().optional().nullable(),
  chemoterapia: z.boolean().default(false),
  chemoterapiaLeiras: z.string().optional().nullable(),
  
  // REHABILITÁCIÓS ADATOK
  // ANAMNÉZIS ÉS BETEGVIZSGÁLAT – új kezdeti mezők
  alkoholfogyasztas: z.string().optional().nullable(),
  dohanyzasSzam: z.string().optional().nullable(), // n szál/nap formátumban
  kezelesreErkezesIndoka: z.enum(['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot']).optional().nullable().or(z.literal('')),
  maxilladefektusVan: z.boolean().default(false),
  brownFuggolegesOsztaly: z.enum(['1', '2', '3', '4']).optional().nullable().or(z.literal('')),
  brownVizszintesKomponens: z.enum(['a', 'b', 'c']).optional().nullable().or(z.literal('')),
  mandibuladefektusVan: z.boolean().default(false),
  kovacsDobakOsztaly: z.enum(['1', '2', '3', '4', '5']).optional().nullable().or(z.literal('')),
  nyelvmozgásokAkadályozottak: z.boolean().default(false),
  gombocosBeszed: z.boolean().default(false),
  nyalmirigyAllapot: z.enum(['hiposzaliváció', 'hiperszaliváció', 'Nem számol be eltérésről']).optional().nullable().or(z.literal('')),
  tnmStaging: z.string().optional().nullable(),

  // PROTÉZIS – FELSŐ/ALSÓ ÁLLCSONT
  felsoFogpotlasVan: z.boolean().default(false),
  felsoFogpotlasMikor: z.string().optional().nullable(),
  felsoFogpotlasKeszito: z.string().optional().nullable(),
  felsoFogpotlasElegedett: z.boolean().default(true),
  felsoFogpotlasProblema: z.string().optional().nullable(),

  alsoFogpotlasVan: z.boolean().default(false),
  alsoFogpotlasMikor: z.string().optional().nullable(),
  alsoFogpotlasKeszito: z.string().optional().nullable(),
  alsoFogpotlasElegedett: z.boolean().default(true),
  alsoFogpotlasProblema: z.string().optional().nullable(),

  // FOGAZATI STÁTUSZ
  // Visszafelé kompatibilitás: elfogad string-et (régi formátum) vagy objektumot (új formátum)
  meglevoFogak: z.record(
    z.union([
      z.string(), // régi formátum: "szuvas, korona"
      z.object({
        status: z.enum(['D', 'F', 'M']).optional(), // D=szuvas, F=tömött, M=hiányzik
        description: z.string().optional() // szabadszavas leírás
      })
    ])
  ).optional(), // fog szám -> állapot objektum vagy string
  felsoFogpotlasTipus: z.enum([
    'zárólemez',
    'részleges akrilátlemezes fogpótlás',
    'teljes lemezes fogpótlás',
    'fedőlemezes fogpótlás',
    'kapocselhorgonyzású részleges fémlemezes fogpótlás',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
    'rögzített fogpótlás fogakon elhorgonyozva',
    'cementezett rögzítésű implantációs korona/híd',
    'csavarozott rögzítésű implantációs korona/híd',
    'sebészi sablon készítése'
  ]).optional().nullable().or(z.literal('')),
  alsoFogpotlasTipus: z.enum([
    'zárólemez',
    'részleges akrilátlemezes fogpótlás',
    'teljes lemezes fogpótlás',
    'fedőlemezes fogpótlás',
    'kapocselhorgonyzású részleges fémlemezes fogpótlás',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
    'rögzített fogpótlás fogakon elhorgonyozva',
    'cementezett rögzítésű implantációs korona/híd',
    'csavarozott rögzítésű implantációs korona/híd',
    'sebészi sablon készítése'
  ]).optional().nullable().or(z.literal('')),
  // Fábián–Fejérdy-féle protetikai osztály: felső és alsó külön
  fabianFejerdyProtetikaiOsztalyFelso: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T']).optional().nullable().or(z.literal('')),
  fabianFejerdyProtetikaiOsztalyAlso: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T']).optional().nullable().or(z.literal('')),
  // (Visszafelé kompatibilitás kedvéért meghagyjuk, de nem kötelező használni)
  fabianFejerdyProtetikaiOsztaly: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T']).optional().nullable().or(z.literal('')),
  kezeleoorvos: z.string().optional().nullable(),
  kezeleoorvosIntezete: z.string().optional().nullable(),
  felvetelDatuma: z.string().optional().nullable(),
  meglevoImplantatumok: z.record(z.string()).optional(), // fog szám -> részletek (típus, gyári szám, stb.)
  nemIsmertPoziciokbanImplantatum: z.boolean().default(false),
  nemIsmertPoziciokbanImplantatumRészletek: z.string().optional().nullable(),
  
  // KEZELÉSI TERV - FELSŐ ÁLLCSONT (tömb, mert több tervezet lehet)
  // READ: elfogad tipus (legacy) és treatmentTypeCode (új). UI-ban treatmentTypeCode.
  // WRITE: backend normalizál → mindig treatmentTypeCode mentésre.
  kezelesiTervFelso: z.array(z.object({
    tipus: z.string().optional().nullable(), // legacy, backward compat
    treatmentTypeCode: z.string().optional().nullable(), // = treatment_types.code
    tervezettAtadasDatuma: z.string().optional().nullable(),
    elkeszult: z.boolean().default(false)
  })).optional().nullable().default([]),
  
  // KEZELÉSI TERV - ALSÓ ÁLLCSONT (tömb, mert több tervezet lehet)
  kezelesiTervAlso: z.array(z.object({
    tipus: z.string().optional().nullable(), // legacy, backward compat
    treatmentTypeCode: z.string().optional().nullable(), // = treatment_types.code
    tervezettAtadasDatuma: z.string().optional().nullable(),
    elkeszult: z.boolean().default(false)
  })).optional().nullable().default([]),
  
  // KEZELÉSI TERV - ARCOT ÉRINTŐ REHABILITÁCIÓ (tömb, mert több tervezet lehet)
  kezelesiTervArcotErinto: z.array(z.object({
    tipus: z.enum([
      'orrepitézis',
      'fülepitézis',
      'orbitaepitézis',
      'középarcepitézis'
    ]),
    elhorgonyzasEszkoze: z.enum([
      'bőrragasztó',
      'mágnes',
      'rúd-lovas rendszer',
      'gömbretenció'
    ]).optional().nullable(),
    tervezettAtadasDatuma: z.string().optional().nullable(),
    elkeszult: z.boolean().default(false)
  })).optional().nullable().default([]),

  // TIMESTAMPS
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  updatedBy: z.string().optional().nullable(),

  // ANAMNÉZIS – csoportosított feltételes kérdések
  // Trauma esetén
  balesetIdopont: z.string().optional().nullable(), // date (trauma esetén)
  balesetEtiologiaja: z.string().optional().nullable(),
  balesetEgyeb: z.string().optional().nullable(),

  // Onkológia esetén
  primerMutetLeirasa: z.string().optional().nullable(),
  bno: z.string().optional().nullable(),
  diagnozis: z.string().optional().nullable(),
  // szovettaniDiagnozis (már létezik)
  // adjuváns terápiák (már léteznek)

  // Veleszületett rendellenesség esetén
  veleszuletettRendellenessegek: z.array(z.enum([
    'kemény szájpadhasadék',
    'lágyszájpad inszufficiencia',
    'állcsonthasadék',
    'ajakhasadék',
  ])).optional().nullable(),
  veleszuletettMutetekLeirasa: z.string().optional().nullable(),

  // MÉLTÁNYOSSÁGI KÉRELEMHEZ SZÜKSÉGES ADATOK
  kortortenetiOsszefoglalo: z.string().optional().nullable(),
  kezelesiTervMelleklet: z.string().optional().nullable(),
  szakorvosiVelemény: z.string().optional().nullable(),

  // HALÁL JELÖLÉS
  halalDatum: z.string().optional().nullable(),
});

// Lab Quote Request Schema (külön táblában tárolva)
export const labQuoteRequestSchema = z.object({
  id: z.string().optional(),
  patientId: z.string().min(1, 'Beteg ID kötelező'),
  szoveg: z.string().min(1, 'Árajánlatkérő szöveg kötelező'),
  datuma: z.string().min(1, 'Árajánlatkérő dátuma kötelező'),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  updatedBy: z.string().optional().nullable(),
});

export type LabQuoteRequest = z.infer<typeof labQuoteRequestSchema>;

export type Patient = z.infer<typeof patientSchema>;

export const beutaloIntezmenyOptions = [
  'OOI Fej-Nyaki Daganatok Multidiszciplináris Központ',
  'Észak-Pesti Centrumkórház',
  'Arc-, Állcsont-, Szájsebészeti és Fogászati Klinika'
];

export const nyakiBlokkdisszekcioOptions = [
  'nem volt',
  'volt, egyoldali',
  'volt, kétoldali'
];

export const fabianFejerdyProtetikaiOsztalyOptions = [
  '0',
  '1A',
  '1B',
  '2A',
  '2A/1',
  '2B',
  '3',
  'T'
];

export const kezeleoorvosOptions = [
  'Dr. Herczeg',
  'Dr. Jász',
  'Dr. Kádár',
  'Dr. Kaposi',
  'Dr. Karsai',
  'Dr. König',
  'Dr. Körmendi',
  'Dr. Kivovics',
  'Dr. Orsós',
  'Dr. Takács',
  'Dr. Tasi',
  'Dr. Vánkos'
];

export const kezelesiTervOptions = [
  'zárólemez',
  'részleges akrilátlemezes fogpótlás',
  'teljes lemezes fogpótlás',
  'fedőlemezes fogpótlás',
  'kapocselhorgonyzású részleges fémlemezes fogpótlás',
  'kombinált fogpótlás kapocselhorgonyzással',
  'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
  'rögzített fogpótlás fogakon elhorgonyozva',
  'cementezett rögzítésű implantációs korona/híd',
  'csavarozott rögzítésű implantációs korona/híd',
  'sebészi sablon készítése'
];

export const kezelesiTervArcotErintoTipusOptions = [
  'orrepitézis',
  'fülepitézis',
  'orbitaepitézis',
  'középarcepitézis'
];

export const kezelesiTervArcotErintoElhorgonyzasOptions = [
  'bőrragasztó',
  'mágnes',
  'rúd-lovas rendszer',
  'gömbretenció'
];

// Patient Document Schema
export const documentSchema = z.object({
  id: z.string().optional(),
  patientId: z.string(),
  filename: z.string().min(1, 'Fájlnév kötelező'),
  filePath: z.string().optional(),
  fileSize: z.number().int().positive('Fájlméret pozitív szám kell legyen'),
  mimeType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  uploadedBy: z.string(),
  uploadedByName: z.string().optional().nullable(),
  uploadedAt: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
});

export type PatientDocument = z.infer<typeof documentSchema>;

// Medical Statistics Types
export type MedicalStats = {
  bno: {
    data: Array<{ kod: string; elofordulas: number }>;
  };
  referringDoctors: {
    data: Array<{ orvos: string; darab: number }>;
  };
  dmfDistribution: {
    data: Array<{ dmft: number; betegSzama: number }>;
    stats: {
      atlag: number;
      median: number;
      szoras: number;
      min: number;
      max: number;
    };
  };
  toothPositions: {
    data: Array<{
      fogSzam: number;
      dSzama: number;
      fSzama: number;
      mSzama: number;
      osszes: number;
    }>;
  };
  implantPositions: {
    data: Array<{
      fogSzam: number;
      implantatumSzama: number;
    }>;
  };
  waitingTime: {
    atlagNapokban: number;
    medianNapokban: number;
    szorasNapokban: number;
    minNapokban: number;
    maxNapokban: number;
    betegSzamaIdoponttal: number;
  };
  doctorWorkload: {
    data: Array<{
      orvosNev: string;
      orvosEmail: string;
      jovobeliIdopontokSzama: number;
      elerhetoIdopontokSzama: number;
      multbeliIdopontokSzama: number;
    }>;
  };
  waitingPatients: {
    osszes: number;
    pending: number;
    nincsIdopont: number;
    betegek: Array<{
      id: string;
      nev: string | null;
      taj: string | null;
      kezeleoorvos: string | null;
      betegLetrehozva: string;
      status: 'pending' | 'nincs_idopont';
    }>;
  };
};

// Doctor-to-doctor messaging types
export interface DoctorMessage {
  id: string;
  senderId: string;
  recipientId: string | null; // Lehet NULL csoportos beszélgetésnél
  groupId?: string | null; // Új mező a csoport ID-hoz
  senderEmail: string;
  senderName: string | null;
  recipientName?: string | null; // Címzett neve (opcionális, csak megjelenítéshez)
  groupName?: string | null; // Csoport neve (opcionális, csak megjelenítéshez)
  groupParticipantCount?: number; // Csoport résztvevők száma (opcionális, csak megjelenítéshez)
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
  pending?: boolean; // Küldés alatt
  mentionedPatientIds?: string[]; // Új mező a megemlített betegek ID-ihoz
  readBy?: Array<{ // Új mező: ki olvasta az üzenetet (group chat-ekhez)
    userId: string;
    userName: string | null;
    readAt: Date;
  }>;
}

export interface DoctorConversation {
  doctorId: string;
  doctorName: string;
  doctorEmail: string;
  lastMessage: DoctorMessage | null;
  unreadCount: number;
  type?: 'individual' | 'group';
  groupId?: string;
  groupName?: string | null;
  participantCount?: number;
}

// Doctor message group types
export interface DoctorMessageGroup {
  id: string;
  name: string | null;
  createdBy: string;
  createdAt: Date;
  participantCount?: number;
}

export interface DoctorGroupParticipant {
  userId: string;
  userName: string;
  userEmail: string;
  joinedAt: Date;
}

export interface DoctorGroupConversation {
  groupId: string;
  groupName: string | null;
  participants: DoctorGroupParticipant[];
  lastMessage: DoctorMessage | null;
  unreadCount: number;
  participantCount: number;
}

// Patient mention types
export interface PatientMention {
  id: string;
  nev: string;
  mentionFormat: string; // @vezeteknev+keresztnev formátum
}

// Patient stages types
export type PatientStage = 
  | 'uj_beteg'
  | 'onkologiai_kezeles_kesz'
  | 'arajanlatra_var'
  | 'implantacios_sebeszi_tervezesre_var'
  | 'fogpotlasra_var'
  | 'fogpotlas_keszul'
  | 'fogpotlas_kesz'
  | 'gondozas_alatt';

export const patientStageSchema = z.object({
  id: z.string().optional(),
  patientId: z.string().min(1, 'Beteg ID kötelező'),
  episodeId: z.string().min(1, 'Epizód ID kötelező'),
  stage: z.enum([
    'uj_beteg',
    'onkologiai_kezeles_kesz',
    'arajanlatra_var',
    'implantacios_sebeszi_tervezesre_var',
    'fogpotlasra_var',
    'fogpotlas_keszul',
    'fogpotlas_kesz',
    'gondozas_alatt'
  ]),
  stageDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
});

export type PatientStageEntry = z.infer<typeof patientStageSchema>;

export interface PatientStageTimeline {
  currentStage: PatientStageEntry | null;
  history: PatientStageEntry[]; // Teljes timeline, dátum szerint csökkenő sorrendben
  episodes: {
    episodeId: string;
    startDate: string;
    endDate?: string;
    stages: PatientStageEntry[];
  }[]; // Epizódok szerint csoportosítva
}

// Patient stage options for UI (régi, backward compat - új rendszer stage_catalogot használ)
export const patientStageOptions: Array<{ value: PatientStage; label: string }> = [
  { value: 'uj_beteg', label: 'Új beteg' },
  { value: 'onkologiai_kezeles_kesz', label: 'Onkológiai kezelés kész' },
  { value: 'arajanlatra_var', label: 'Árajánlatra vár' },
  { value: 'implantacios_sebeszi_tervezesre_var', label: 'Implantációs sebészi tervezésre vár' },
  { value: 'fogpotlasra_var', label: 'Fogpótlásra vár' },
  { value: 'fogpotlas_keszul', label: 'Fogpótlás készül' },
  { value: 'fogpotlas_kesz', label: 'Fogpótlás kész' },
  { value: 'gondozas_alatt', label: 'Gondozás alatt' },
];

// --- Episode + Stage catalog + Stage events + Milestones (új modell) ---
export const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'] as const;
export type ReasonType = typeof REASON_VALUES[number];

export const EPISODE_STATUS_VALUES = ['open', 'closed', 'paused'] as const;
export type EpisodeStatus = typeof EPISODE_STATUS_VALUES[number];

export const TRIGGER_TYPE_VALUES = ['recidiva', 'fogelvesztes', 'potlasvesztes', 'kontrollbol_uj_panasz', 'egyeb'] as const;
export type TriggerType = typeof TRIGGER_TYPE_VALUES[number];

export interface PatientEpisode {
  id: string;
  patientId: string;
  reason: ReasonType;
  pathwayCode?: string | null;
  chiefComplaint: string;
  caseTitle?: string | null;
  status: EpisodeStatus;
  openedAt: string;
  closedAt?: string | null;
  parentEpisodeId?: string | null;
  triggerType?: TriggerType | null;
  createdAt?: string | null;
  createdBy?: string | null;
  carePathwayId?: string | null;
  assignedProviderId?: string | null;
  carePathwayName?: string | null;
  assignedProviderName?: string | null;
  treatmentTypeId?: string | null;
  treatmentTypeCode?: string | null;
  treatmentTypeLabel?: string | null;
}

export interface StageCatalogEntry {
  code: string;
  reason: ReasonType;
  labelHu: string;
  orderIndex: number;
  isTerminal: boolean;
  defaultDurationDays?: number | null;
}

export interface StageEventEntry {
  id: string;
  patientId: string;
  episodeId: string;
  stageCode: string;
  at: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
}

export interface PatientMilestoneEntry {
  id: string;
  patientId: string;
  episodeId: string;
  code: string;
  at: string;
  params?: Record<string, unknown> | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
}

export interface StageEventTimeline {
  currentStage: StageEventEntry | null;
  history: StageEventEntry[];
  episodes: {
    episodeId: string;
    episode?: PatientEpisode;
    startDate: string;
    endDate?: string;
    stages: StageEventEntry[];
  }[];
}

// OHIP-14 types
export type OHIP14Timepoint = 'T0' | 'T1' | 'T2';

export type OHIP14ResponseValue = 0 | 1 | 2 | 3 | 4;

export const ohip14ResponseValueSchema = z.enum(['0', '1', '2', '3', '4']).transform((val) => parseInt(val) as OHIP14ResponseValue);

export const ohip14ResponseSchema = z.object({
  id: z.string().optional(),
  patientId: z.string().min(1, 'Beteg ID kötelező'),
  episodeId: z.string().optional().nullable(),
  timepoint: z.enum(['T0', 'T1', 'T2']),
  stageCode: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  completedByPatient: z.boolean().default(true),
  q1_functional_limitation: z.number().int().min(0).max(4).nullable(),
  q2_functional_limitation: z.number().int().min(0).max(4).nullable(),
  q3_physical_pain: z.number().int().min(0).max(4).nullable(),
  q4_physical_pain: z.number().int().min(0).max(4).nullable(),
  q5_psychological_discomfort: z.number().int().min(0).max(4).nullable(),
  q6_psychological_discomfort: z.number().int().min(0).max(4).nullable(),
  q7_physical_disability: z.number().int().min(0).max(4).nullable(),
  q8_physical_disability: z.number().int().min(0).max(4).nullable(),
  q9_psychological_disability: z.number().int().min(0).max(4).nullable(),
  q10_psychological_disability: z.number().int().min(0).max(4).nullable(),
  q11_social_disability: z.number().int().min(0).max(4).nullable(),
  q12_social_disability: z.number().int().min(0).max(4).nullable(),
  q13_handicap: z.number().int().min(0).max(4).nullable(),
  q14_handicap: z.number().int().min(0).max(4).nullable(),
  totalScore: z.number().int().min(0).max(56).optional(),
  functionalLimitationScore: z.number().int().min(0).max(8).optional(),
  physicalPainScore: z.number().int().min(0).max(8).optional(),
  psychologicalDiscomfortScore: z.number().int().min(0).max(8).optional(),
  physicalDisabilityScore: z.number().int().min(0).max(8).optional(),
  psychologicalDisabilityScore: z.number().int().min(0).max(8).optional(),
  socialDisabilityScore: z.number().int().min(0).max(8).optional(),
  handicapScore: z.number().int().min(0).max(8).optional(),
  notes: z.string().optional().nullable(),
  lockedAt: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  updatedBy: z.string().optional().nullable(),
});

export type OHIP14Response = z.infer<typeof ohip14ResponseSchema>;

export interface OHIP14Question {
  id: string;
  question: string;
  dimension: string;
  dimensionHungarian: string;
  questionNumber: number;
}

export interface OHIP14Dimension {
  id: string;
  name: string;
  nameHungarian: string;
  questions: OHIP14Question[];
}

export const ohip14TimepointOptions: Array<{ value: OHIP14Timepoint; label: string; description: string }> = [
  { value: 'T0', label: 'T0', description: 'Kezelés megkezdése előtt' },
  { value: 'T1', label: 'T1', description: 'Rehabilitáció megkezdése előtt' },
  { value: 'T2', label: 'T2', description: 'Rehabilitáció után' },
];

export const ohip14ResponseValueOptions: Array<{ value: OHIP14ResponseValue; label: string }> = [
  { value: 0, label: 'Soha' },
  { value: 1, label: 'Ritkán' },
  { value: 2, label: 'Néha' },
  { value: 3, label: 'Gyakran' },
  { value: 4, label: 'Mindig' },
];
