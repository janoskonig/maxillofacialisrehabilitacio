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
  kezelesreErkezesIndoka: z.enum(['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot', 'nincs beutaló']).optional().nullable().or(z.literal('')),
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
  kezelesiTervFelso: z.array(z.object({
    tipus: z.enum([
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
    ]),
    tervezettAtadasDatuma: z.string().optional().nullable(),
    elkeszult: z.boolean().default(false)
  })).optional().nullable().default([]),
  
  // KEZELÉSI TERV - ALSÓ ÁLLCSONT (tömb, mert több tervezet lehet)
  kezelesiTervAlso: z.array(z.object({
    tipus: z.enum([
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
    ]),
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
  uploadedBy: z.string().email('Érvénytelen email cím'),
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
