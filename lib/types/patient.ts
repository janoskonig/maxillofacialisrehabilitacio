import { z } from 'zod';

export const patientSchema = z.object({
  id: z.string().optional(),
  nev: z.string().optional().nullable().or(z.literal('')),
  taj: z.string()
    .optional()
    .nullable()
    .refine((val) => {
      if (!val || val === '' || val.trim() === '') return true;
      const cleaned = val.replace(/-/g, '').trim();
      return /^\d{9}$/.test(cleaned);
    }, {
      message: 'A TAJ szám formátuma: XXX-XXX-XXX (9 számjegy). Ha nem szeretne megadni, hagyja üresen.'
    })
    .or(z.literal('')),
  telefonszam: z.string()
    .optional()
    .nullable()
    .refine((val) => {
      if (!val || val === '' || val.trim() === '' || val === '+36') return true;
      if (!val.startsWith('+36')) return false;
      const afterPrefix = val.substring(3);
      const digitsOnly = afterPrefix.replace(/\D/g, '');
      return digitsOnly.length <= 11 && digitsOnly.length > 0;
    }, {
      message: 'A telefonszám +36-tal kezdődik és maximum 11 számjegyet tartalmaz (pl. +36123456789). Ha nem szeretne megadni, hagyja üresen.'
    })
    .or(z.literal('')),

  szuletesiDatum: z.string().optional().nullable(),
  nem: z.enum(['ferfi', 'no']).optional().nullable().or(z.literal('')),
  email: z.string()
    .optional()
    .nullable()
    .refine((val) => {
      if (!val || val === '' || val.trim() === '') return true;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(val.trim());
    }, {
      message: 'Érvénytelen email cím formátum. Példa: nev@example.com. Ha nem szeretne megadni, hagyja üresen.'
    })
    .or(z.literal('')),
  cim: z.string().optional().nullable(),
  varos: z.string().optional().nullable(),
  iranyitoszam: z.string().optional().nullable(),

  beutaloOrvos: z.string().optional().nullable(),
  beutaloIntezmeny: z.string().optional().nullable(),
  beutaloIndokolas: z.string().optional().nullable(),
  mutetIdeje: z.string().optional().nullable(),
  szovettaniDiagnozis: z.string().optional().nullable(),
  nyakiBlokkdisszekcio: z.enum(['nem volt', 'volt, egyoldali', 'volt, kétoldali']).optional().nullable().or(z.literal('')),

  radioterapia: z.boolean().default(false),
  radioterapiaDozis: z.string().optional().nullable(),
  radioterapiaDatumIntervallum: z.string().optional().nullable(),
  chemoterapia: z.boolean().default(false),
  chemoterapiaLeiras: z.string().optional().nullable(),

  alkoholfogyasztas: z.string().optional().nullable(),
  dohanyzasSzam: z.string().optional().nullable(),
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

  meglevoFogak: z.record(
    z.union([
      z.string(),
      z.object({
        status: z.enum(['D', 'F', 'M']).optional(),
        description: z.string().optional()
      })
    ])
  ).optional(),
  felsoFogpotlasTipus: z.enum([
    'zárólemez', 'részleges akrilátlemezes fogpótlás', 'teljes lemezes fogpótlás',
    'fedőlemezes fogpótlás', 'kapocselhorgonyzású részleges fémlemezes fogpótlás',
    'kombinált fogpótlás kapocselhorgonyzással', 'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
    'rögzített fogpótlás fogakon elhorgonyozva', 'cementezett rögzítésű implantációs korona/híd',
    'csavarozott rögzítésű implantációs korona/híd', 'sebészi sablon készítése'
  ]).optional().nullable().or(z.literal('')),
  alsoFogpotlasTipus: z.enum([
    'zárólemez', 'részleges akrilátlemezes fogpótlás', 'teljes lemezes fogpótlás',
    'fedőlemezes fogpótlás', 'kapocselhorgonyzású részleges fémlemezes fogpótlás',
    'kombinált fogpótlás kapocselhorgonyzással', 'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
    'rögzített fogpótlás fogakon elhorgonyozva', 'cementezett rögzítésű implantációs korona/híd',
    'csavarozott rögzítésű implantációs korona/híd', 'sebészi sablon készítése'
  ]).optional().nullable().or(z.literal('')),
  fabianFejerdyProtetikaiOsztalyFelso: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T']).optional().nullable().or(z.literal('')),
  fabianFejerdyProtetikaiOsztalyAlso: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T']).optional().nullable().or(z.literal('')),
  fabianFejerdyProtetikaiOsztaly: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T']).optional().nullable().or(z.literal('')),
  kezeleoorvos: z.string().optional().nullable(),
  kezeleoorvosIntezete: z.string().optional().nullable(),
  felvetelDatuma: z.string().optional().nullable(),
  meglevoImplantatumok: z.record(z.string()).optional(),
  nemIsmertPoziciokbanImplantatum: z.boolean().default(false),
  nemIsmertPoziciokbanImplantatumRészletek: z.string().optional().nullable(),

  kezelesiTervFelso: z.array(z.object({
    tipus: z.string().optional().nullable(),
    treatmentTypeCode: z.string().optional().nullable(),
    tervezettAtadasDatuma: z.string().optional().nullable(),
    elkeszult: z.boolean().default(false)
  })).optional().nullable().default([]),

  kezelesiTervAlso: z.array(z.object({
    tipus: z.string().optional().nullable(),
    treatmentTypeCode: z.string().optional().nullable(),
    tervezettAtadasDatuma: z.string().optional().nullable(),
    elkeszult: z.boolean().default(false)
  })).optional().nullable().default([]),

  kezelesiTervArcotErinto: z.array(z.object({
    tipus: z.enum(['orrepitézis', 'fülepitézis', 'orbitaepitézis', 'középarcepitézis']),
    elhorgonyzasEszkoze: z.enum(['bőrragasztó', 'mágnes', 'rúd-lovas rendszer', 'gömbretenció']).optional().nullable(),
    tervezettAtadasDatuma: z.string().optional().nullable(),
    elkeszult: z.boolean().default(false)
  })).optional().nullable().default([]),

  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  updatedBy: z.string().optional().nullable(),

  balesetIdopont: z.string().optional().nullable(),
  balesetEtiologiaja: z.string().optional().nullable(),
  balesetEgyeb: z.string().optional().nullable(),

  primerMutetLeirasa: z.string().optional().nullable(),
  bno: z.string().optional().nullable(),
  diagnozis: z.string().optional().nullable(),

  veleszuletettRendellenessegek: z.array(z.enum([
    'kemény szájpadhasadék', 'lágyszájpad inszufficiencia', 'állcsonthasadék', 'ajakhasadék',
  ])).optional().nullable(),
  veleszuletettMutetekLeirasa: z.string().optional().nullable(),

  kortortenetiOsszefoglalo: z.string().optional().nullable(),
  kezelesiTervMelleklet: z.string().optional().nullable(),
  szakorvosiVelemény: z.string().optional().nullable(),

  halalDatum: z.string().optional().nullable(),
});

export type Patient = z.infer<typeof patientSchema>;

export const beutaloIntezmenyOptions = [
  'OOI Fej-Nyaki Daganatok Multidiszciplináris Központ',
  'Észak-Pesti Centrumkórház',
  'Arc-, Állcsont-, Szájsebészeti és Fogászati Klinika'
];

export const nyakiBlokkdisszekcioOptions = ['nem volt', 'volt, egyoldali', 'volt, kétoldali'];

export const fabianFejerdyProtetikaiOsztalyOptions = ['0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T'];

export const kezeleoorvosOptions = [
  'Dr. Herczeg', 'Dr. Jász', 'Dr. Kádár', 'Dr. Kaposi', 'Dr. Karsai',
  'Dr. König', 'Dr. Körmendi', 'Dr. Kivovics', 'Dr. Orsós', 'Dr. Takács', 'Dr. Tasi', 'Dr. Vánkos'
];

export const kezelesiTervOptions = [
  'zárólemez', 'részleges akrilátlemezes fogpótlás', 'teljes lemezes fogpótlás',
  'fedőlemezes fogpótlás', 'kapocselhorgonyzású részleges fémlemezes fogpótlás',
  'kombinált fogpótlás kapocselhorgonyzással', 'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
  'rögzített fogpótlás fogakon elhorgonyozva', 'cementezett rögzítésű implantációs korona/híd',
  'csavarozott rögzítésű implantációs korona/híd', 'sebészi sablon készítése'
];

export const kezelesiTervArcotErintoTipusOptions = ['orrepitézis', 'fülepitézis', 'orbitaepitézis', 'középarcepitézis'];

export const kezelesiTervArcotErintoElhorgonyzasOptions = ['bőrragasztó', 'mágnes', 'rúd-lovas rendszer', 'gömbretenció'];

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
