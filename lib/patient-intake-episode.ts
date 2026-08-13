/**
 * Beteg-felvételkor automatikusan nyíló ellátási epizód.
 *
 * Döntés (2026-08-13): ha valaki új beteget vesz fel, ne kelljen külön
 * kattintással epizódot indítani — az epizód a felvétellel egyszerre nyíljon
 * meg a beutaló adataiból, STAGE_0 („Első konzultációra vár") stádiummal.
 * Így a beteg azonnal megjelenik a pipeline/várólista nézetekben, és nem
 * marad „epizód nélküli" kartonként láthatatlanul.
 *
 * Két belépési pont:
 *   - `openIntakeEpisode`  – POST /api/patients (a beteg létrejöttekor)
 *   - `syncAutoCreatedIntakeEpisode` – PUT /api/patients/:id (utólagos pótlás)
 *
 * A pótlás azért kell, mert a gyors felvétel űrlap (/patients/new) csak alap-
 * és személyes adatokat kér: a beutaló orvos / indokolás / etiológia szinte
 * mindig később kerül a kartonra. Amíg az epizód automatikusan nyílt
 * (`auto_created`), nyitott, és a stádiuma még STAGE_0, addig a beutaló-adatok
 * visszaíródnak rá. Az első stádiumlépés után — és kézzel indított epizódnál
 * soha — nem nyúlunk hozzá.
 */

import type { Pool, PoolClient } from 'pg';
import type { PatientEpisode } from '@/lib/types';
import { logger } from '@/lib/logger';
import { probeColumnExists } from '@/lib/schema-probe';
import {
  createOpenEpisodeWithInitialStageZero,
  EPISODE_REASON_VALUES,
} from '@/lib/patient-episode-create';

type EpisodeReason = (typeof EPISODE_REASON_VALUES)[number];

const REASON_SET = new Set<string>(EPISODE_REASON_VALUES);

/**
 * Etiológia hiányában ezt vesszük fel. A profil túlnyomó része onkológiai
 * rehabilitáció, és a `patient_episodes.reason` NOT NULL + CHECK — üresen nem
 * hagyható. Ugyanez a fallback szerepel a kézi epizódindításnál
 * (`app/api/patients/[id]/stages/new-episode/route.ts`).
 */
const DEFAULT_REASON: EpisodeReason = 'onkológiai kezelés utáni állapot';

/** Ha semmilyen beutaló-szöveg nincs, ez kerül a kötelező „Cím / ok" mezőbe. */
export const DEFAULT_INTAKE_CHIEF_COMPLAINT = 'Beutalás alapján automatikusan nyitott epizód';

/** `patient_episodes.chief_complaint` / `case_title` = VARCHAR(500). */
const MAX_TEXT_LEN = 500;

/** A beteg-űrlap azon mezői, amikből az induló epizód összeáll. */
export interface IntakeEpisodeSource {
  kezelesreErkezesIndoka?: string | null;
  beutaloOrvos?: string | null;
  beutaloIntezmeny?: string | null;
  beutaloIndokolas?: string | null;
  diagnozis?: string | null;
  szovettaniDiagnozis?: string | null;
  bno?: string | null;
  tnmStaging?: string | null;
  mutetIdeje?: string | null;
  primerMutetLeirasa?: string | null;
  radioterapia?: boolean | null;
  chemoterapia?: boolean | null;
  balesetIdopont?: string | null;
  balesetEtiologiaja?: string | null;
  balesetEgyeb?: string | null;
  veleszuletettRendellenessegek?: string[] | null;
  veleszuletettMutetekLeirasa?: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(value: string): string {
  return value.length > MAX_TEXT_LEN ? `${value.slice(0, MAX_TEXT_LEN - 1)}…` : value;
}

/**
 * Etiológia (epizód `reason`) kitalálása a felvételi adatokból.
 *
 * Sorrend: az explicit „kezelésre érkezés indoka" nyer; utána a beírt anamnézis
 * jellegzetes nyomai (veleszületett → baleseti → onkológiai); végül a fallback.
 * A stádium-katalógus etiológiánként más címkéket ad, ezért érdemes a
 * legvalószínűbbet felvenni — a stádium ettől függetlenül STAGE_0 marad, és a
 * későbbi pótlás felülírja, amíg az epizód nem lépett tovább.
 */
export function inferIntakeEpisodeReason(source: IntakeEpisodeSource): EpisodeReason {
  const explicit = text(source.kezelesreErkezesIndoka);
  if (REASON_SET.has(explicit)) return explicit as EpisodeReason;

  const congenital =
    (Array.isArray(source.veleszuletettRendellenessegek) &&
      source.veleszuletettRendellenessegek.length > 0) ||
    text(source.veleszuletettMutetekLeirasa) !== '';
  if (congenital) return 'veleszületett rendellenesség';

  const trauma =
    text(source.balesetIdopont) !== '' ||
    text(source.balesetEtiologiaja) !== '' ||
    text(source.balesetEgyeb) !== '';
  if (trauma) return 'traumás sérülés';

  return DEFAULT_REASON;
}

/**
 * A kötelező „Cím / ok" mező szövege: a beutaló indokolása a legbeszédesebb,
 * utána a diagnózisok. Sosem üres — a DB NOT NULL.
 */
export function buildIntakeChiefComplaint(source: IntakeEpisodeSource): string {
  const candidate =
    text(source.beutaloIndokolas) ||
    text(source.diagnozis) ||
    text(source.szovettaniDiagnozis) ||
    text(source.balesetEtiologiaja) ||
    text(source.bno);
  return truncate(candidate || DEFAULT_INTAKE_CHIEF_COMPLAINT);
}

/** „Beutaló: Dr. X – Intézmény" — csak ha van beutaló adat, különben null. */
export function buildIntakeCaseTitle(source: IntakeEpisodeSource): string | null {
  const parts = [text(source.beutaloOrvos), text(source.beutaloIntezmeny)].filter(
    (p) => p !== ''
  );
  if (parts.length === 0) return null;
  return truncate(`Beutaló: ${parts.join(' – ')}`);
}

/**
 * A `patient_episodes` tábla létezik-e (migráció előtti DB-n nem). A
 * schema-probe cache-eli, így requestenként nem megy külön query.
 */
async function episodesTableReady(db: Pool | PoolClient): Promise<boolean> {
  return probeColumnExists(db, 'patient_episodes', 'id');
}

/**
 * Új beteg felvételekor nyitott epizód + STAGE_0 stádium-esemény.
 * Idempotens: ha a betegnek már van bármilyen epizódja, nem csinál semmit
 * (különben egy párhuzamos hívás lezárná a frissen nyitottat).
 *
 * @returns a létrejött epizód, vagy `null`, ha nem kellett/nem lehetett nyitni.
 */
export async function openIntakeEpisode(
  pool: Pool,
  input: { patientId: string; createdBy: string; source: IntakeEpisodeSource }
): Promise<PatientEpisode | null> {
  if (!(await episodesTableReady(pool))) return null;

  const existing = await pool.query(
    `SELECT 1 FROM patient_episodes WHERE patient_id = $1 LIMIT 1`,
    [input.patientId]
  );
  if (existing.rows.length > 0) return null;

  return createOpenEpisodeWithInitialStageZero(pool, {
    patientId: input.patientId,
    reason: inferIntakeEpisodeReason(input.source),
    chiefComplaint: buildIntakeChiefComplaint(input.source),
    caseTitle: buildIntakeCaseTitle(input.source),
    parentEpisodeId: null,
    triggerType: null,
    treatmentTypeId: null,
    createdBy: input.createdBy,
    autoCreated: true,
  });
}

/**
 * A beutaló-adatok utólagos pótlásának visszaírása az automatikusan nyitott
 * epizódra. Csak akkor ír, ha az epizód
 *   - automatikusan nyílt (`auto_created`),
 *   - még nyitott, és
 *   - a stádiuma még STAGE_0 (nem történt semmi az epizódon).
 * Így kézzel írt „Cím / ok" szöveget sosem írunk felül.
 *
 * @returns hány epizódsor frissült (0 vagy 1).
 */
export async function syncAutoCreatedIntakeEpisode(
  pool: Pool,
  patientId: string,
  source: IntakeEpisodeSource
): Promise<number> {
  const hasAutoCreatedCol = await probeColumnExists(pool, 'patient_episodes', 'auto_created');
  if (!hasAutoCreatedCol) return 0;

  const result = await pool.query(
    `UPDATE patient_episodes pe
        SET reason = $2, chief_complaint = $3, case_title = $4
      WHERE pe.patient_id = $1
        AND pe.status = 'open'
        AND pe.auto_created = TRUE
        AND NOT EXISTS (
              SELECT 1 FROM stage_events se
               WHERE se.episode_id = pe.id AND se.stage_code <> 'STAGE_0'
            )
        AND (pe.reason, pe.chief_complaint, pe.case_title)
            IS DISTINCT FROM ($2, $3, $4)`,
    [
      patientId,
      inferIntakeEpisodeReason(source),
      buildIntakeChiefComplaint(source),
      buildIntakeCaseTitle(source),
    ]
  );
  return result.rowCount ?? 0;
}

/** Fire-and-forget változat: a hiba ne buktassa el a beteg mentését. */
export function syncAutoCreatedIntakeEpisodeSilent(
  pool: Pool,
  patientId: string,
  source: IntakeEpisodeSource
): void {
  void syncAutoCreatedIntakeEpisode(pool, patientId, source).catch((err) => {
    logger.error('Failed to sync auto-created intake episode:', err);
  });
}
