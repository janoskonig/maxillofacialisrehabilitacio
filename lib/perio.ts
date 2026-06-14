import { z } from 'zod';

/**
 * Parodontális státusz (perio chart) közös típusok, séma és helperek.
 * A kliens (PerioChart) és az API (/api/patients/[id]/perio) is innen dolgozik.
 *
 * Fogonként két felszín (bukkális / orális), felszínenként 3 mérőpont
 * (mesial · középső · distal). A felső íven az „orális" = palatinális,
 * az alsón = lingvális.
 */

export const PERIO_SITES_PER_SURFACE = 3;

export type PerioSurfaceKey = 'buccal' | 'oral';

export interface PerioSite {
  /** Tasakmélység (mm) pontonként. */
  pd: number[];
  /** Ínyszél / recesszió (mm) pontonként. */
  rec: number[];
  /** Vérzés szondázásra (BOP) pontonként. */
  bop: boolean[];
  /** Plakk pontonként. */
  plaque: boolean[];
}

export interface PerioToothData {
  buccal?: PerioSite;
  oral?: PerioSite;
  /** Mozgathatóság fokozata 0–3. */
  mobility?: number;
  /** Furkáció érintettség 0–3. */
  furcation?: number;
}

export interface PerioChartData {
  teeth: Record<string, PerioToothData>;
}

const triNum = (min: number, max: number) =>
  z.array(z.number().int().min(min).max(max)).length(PERIO_SITES_PER_SURFACE);
const triBool = () => z.array(z.boolean()).length(PERIO_SITES_PER_SURFACE);

const perioSiteSchema = z.object({
  pd: triNum(0, 20),
  rec: triNum(-5, 20),
  bop: triBool(),
  plaque: triBool(),
});

const perioToothSchema = z.object({
  buccal: perioSiteSchema.optional(),
  oral: perioSiteSchema.optional(),
  mobility: z.number().int().min(0).max(3).optional(),
  furcation: z.number().int().min(0).max(3).optional(),
});

export const perioChartSchema = z.object({
  teeth: z.record(perioToothSchema).default({}),
});

export function emptySite(): PerioSite {
  return { pd: [0, 0, 0], rec: [0, 0, 0], bop: [false, false, false], plaque: [false, false, false] };
}

/** Klinikai tapadásveszteség (CAL) = tasak + recesszió, pontonként. */
export function computeCAL(site: PerioSite): number[] {
  return site.pd.map((pd, i) => pd + (site.rec[i] ?? 0));
}

/** FDI sorrend a charton (felső jobb→bal, alsó jobb→bal). */
export const PERIO_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const PERIO_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
