import { z } from 'zod';

export const patientSchema = z.object({
  // ALAPADATOK
  id: z.string().optional(),
  nev: z.string().optional().nullable().or(z.literal('')),
  taj: z.string().optional().nullable(),
  telefonszam: z.string().optional().nullable(),
  
  // SZEMÉLYES ADATOK
  szuletesiDatum: z.string().optional().nullable(),
  nem: z.enum(['ferfi', 'no', 'egyeb']).optional().nullable().or(z.literal('')),
  email: z.string().email('Érvénytelen email cím').optional().nullable().or(z.literal('')),
  cim: z.string().optional().nullable(),
  varos: z.string().optional().nullable(),
  iranyitoszam: z.string().optional().nullable(),
  
  // BEUTALÓ
  beutaloOrvos: z.string().optional().nullable(),
  beutaloIntezmeny: z.string().optional().nullable(),
  mutetRovidLeirasa: z.string().optional().nullable(),
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
  meglevoFogak: z.record(z.string()).optional(), // fog szám -> részletek (szuvas, tömött, korona, stb.)
  felsoFogpotlasTipus: z.enum([
    'teljes akrilátlemezes fogpótlás',
    'részleges akrilátlemezes fogpótlás',
    'részleges fémlemezes fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',
    'fedőlemezes fogpótlás',
    'rögzített fogpótlás'
  ]).optional().nullable().or(z.literal('')),
  alsoFogpotlasTipus: z.enum([
    'teljes akrilátlemezes fogpótlás',
    'részleges akrilátlemezes fogpótlás',
    'részleges fémlemezes fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',
    'fedőlemezes fogpótlás',
    'rögzített fogpótlás'
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
});

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
  'Dr. Kádár',
  'Dr. Kaposi',
  'Dr. Karsai',
  'Dr. König',
  'Dr. Körmendi',
  'Dr. Kivovics',
  'Dr. Orsós',
  'Dr. Takács',
  'Dr. Tasi'
];
