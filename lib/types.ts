import { z } from 'zod';

export const patientSchema = z.object({
  // ALAPADATOK
  id: z.string().optional(),
  nev: z.string().min(1, 'Név megadása kötelező'),
  taj: z.string().optional(),
  telefonszam: z.string().optional(),
  
  // SZEMÉLYES ADATOK
  szuletesiDatum: z.string().optional(),
  nem: z.enum(['ferfi', 'no', 'egyeb']).optional(),
  email: z.string().email('Érvénytelen email cím').optional().or(z.literal('')),
  cim: z.string().optional(),
  varos: z.string().optional(),
  iranyitoszam: z.string().optional(),
  
  // BEUTALÓ
  beutaloOrvos: z.string().optional(),
  beutaloIntezmeny: z.string().optional(),
  mutetRovidLeirasa: z.string().optional(),
  mutetIdeje: z.string().optional(),
  szovettaniDiagnozis: z.string().optional(),
  nyakiBlokkdisszekcio: z.enum(['nem volt', 'volt, egyoldali', 'volt, kétoldali']).optional(),
  
  // ADJUVÁNS TERÁPIÁK
  radioterapia: z.boolean().default(false),
  radioterapiaDozis: z.string().optional(),
  radioterapiaDatumIntervallum: z.string().optional(),
  chemoterapia: z.boolean().default(false),
  chemoterapiaLeiras: z.string().optional(),
  
  // REHABILITÁCIÓS ADATOK
  // ANAMNÉZIS ÉS BETEGVIZSGÁLAT – új kezdeti mezők
  alkoholfogyasztas: z.string().optional(),
  dohanyzasSzam: z.string().optional(), // n szál/nap formátumban
  kezelesreErkezesIndoka: z.enum(['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot']).optional(),
  maxilladefektusVan: z.boolean().default(false),
  brownFuggolegesOsztaly: z.enum(['1', '2', '3', '4']).optional(),
  brownVizszintesKomponens: z.enum(['a', 'b', 'c']).optional(),
  mandibuladefektusVan: z.boolean().default(false),
  kovacsDobakOsztaly: z.enum(['1', '2', '3', '4', '5']).optional(),
  nyelvmozgásokAkadályozottak: z.boolean().default(false),
  gombocosBeszed: z.boolean().default(false),
  nyalmirigyAllapot: z.enum(['hiposzaliváció', 'hiperszaliváció']).optional(),

  // PROTÉZIS – FELSŐ/ALSÓ ÁLLCSONT
  felsoFogpotlasVan: z.boolean().default(false),
  felsoFogpotlasMikor: z.string().optional(),
  felsoFogpotlasKeszito: z.string().optional(),
  felsoFogpotlasElegedett: z.boolean().default(true),
  felsoFogpotlasProblema: z.string().optional(),

  alsoFogpotlasVan: z.boolean().default(false),
  alsoFogpotlasMikor: z.string().optional(),
  alsoFogpotlasKeszito: z.string().optional(),
  alsoFogpotlasElegedett: z.boolean().default(true),
  alsoFogpotlasProblema: z.string().optional(),

  // FOGAZATI STÁTUSZ
  meglevoFogak: z.record(z.string()).optional(), // fog szám -> részletek (szuvas, tömött, korona, stb.)
  felsoFogpotlasTipus: z.enum([
    'teljes akrilátlemezes fogpótlás',
    'részleges akrilátlemezes fogpótlás',
    'részleges fémlemezes fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',
    'fedőlemezes fogpótlás'
  ]).optional(),
  alsoFogpotlasTipus: z.enum([
    'teljes akrilátlemezes fogpótlás',
    'részleges akrilátlemezes fogpótlás',
    'részleges fémlemezes fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás kapocselhorgonyzással',
    'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',
    'fedőlemezes fogpótlás'
  ]).optional(),
  // Fábián–Fejérdy-féle protetikai osztály: felső és alsó külön
  fabianFejerdyProtetikaiOsztalyFelso: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3']).optional(),
  fabianFejerdyProtetikaiOsztalyAlso: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3']).optional(),
  // (Visszafelé kompatibilitás kedvéért meghagyjuk, de nem kötelező használni)
  fabianFejerdyProtetikaiOsztaly: z.enum(['0', '1A', '1B', '2A', '2A/1', '2B', '3']).optional(),
  kezeleoorvos: z.string().optional(),
  kezeleoorvosIntezete: z.string().optional(),
  felvetelDatuma: z.string().optional(),
  meglevoImplantatumok: z.record(z.string()).optional(), // fog szám -> részletek (típus, gyári szám, stb.)
  nemIsmertPoziciokbanImplantatum: z.boolean().default(false),
  nemIsmertPoziciokbanImplantatumRészletek: z.string().optional(),
  
  // TIMESTAMPS
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
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
  '3'
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
