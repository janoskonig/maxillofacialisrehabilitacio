import type { PoolClient } from 'pg';

export const APPOINTMENT_CLINICAL_EVENTS = ['delivery'] as const;
export type AppointmentClinicalEvent = (typeof APPOINTMENT_CLINICAL_EVENTS)[number];

export interface AppointmentStageTransitionResult {
  requested: boolean;
  changed: boolean;
  stageCode: string | null;
  stageLabel: string | null;
  at: string | null;
  source: 'delivery' | 'manual' | null;
  message: string | null;
  /**
   * true, ha a származtatott (nem a felhasználó által kért) stádiumváltás
   * elmaradt. Ilyenkor az időpont kimenetele (státusz + „mi történt?”) MENTHETŐ
   * marad — a hívó a `message`-t figyelmeztetésként mutatja meg.
   */
  skipped: boolean;
  skippedCode: string | null;
}

interface ApplyAppointmentStageTransitionArgs {
  client: PoolClient;
  appointmentId: string;
  episodeId: string | null;
  appointmentAt: Date;
  appointmentStepCode: string | null;
  clinicalEvent: AppointmentClinicalEvent | null;
  requestedStageCode: string | null;
  changedBy: string;
}

/**
 * Strukturált átadás-felismerés. Szabad szöveget szándékosan nem elemzünk:
 * az olyan megjegyzések, mint „átadás egyeztetve” nem feltétlenül jelentenek
 * tényleges klinikai átadást.
 */
export function isDeliveryStepCode(stepCode: string | null | undefined): boolean {
  const normalized = stepCode?.trim().toLocaleLowerCase('hu-HU') ?? '';
  return normalized === 'delivery' || normalized === 'atadas' || normalized.endsWith('_atadas');
}

export function parseAppointmentClinicalEvent(value: unknown): AppointmentClinicalEvent | null {
  if (value == null || value === '') return null;
  return (APPOINTMENT_CLINICAL_EVENTS as readonly unknown[]).includes(value)
    ? (value as AppointmentClinicalEvent)
    : null;
}

/**
 * A származtatott stádiumváltás akadályainak felhasználói szövege. Ezek NEM
 * hibák: az időpont kimenetele mentve lett, csak a stádium maradt változatlanul.
 */
const SKIPPED_STAGE_MESSAGES: Record<string, string> = {
  STAGE_TRANSITION_REQUIRES_EPISODE:
    'Az időponthoz nincs ellátási epizód kötve, ezért az automatikus stádiumváltás elmaradt. Az időpont kimenetele mentve.',
  STAGE_EPISODE_NOT_FOUND:
    'Az időponthoz kötött ellátási epizód nem található, ezért az automatikus stádiumváltás elmaradt. Az időpont kimenetele mentve.',
  STAGE_EPISODE_NOT_OPEN:
    'Az ellátási epizód nem aktív (lezárt vagy szüneteltetett), ezért az automatikus stádiumváltás elmaradt. Az időpont kimenetele mentve.',
  INVALID_STAGE_FOR_EPISODE:
    'A célstádium nem szerepel az epizód stádiumkatalógusában, ezért az automatikus stádiumváltás elmaradt. Az időpont kimenetele mentve.',
};

function skippedResult(
  code: string,
  source: AppointmentStageTransitionResult['source'],
): AppointmentStageTransitionResult {
  return {
    requested: true,
    changed: false,
    stageCode: null,
    stageLabel: null,
    at: null,
    source,
    message: SKIPPED_STAGE_MESSAGES[code] ?? 'Az automatikus stádiumváltás elmaradt. Az időpont kimenetele mentve.',
    skipped: true,
    skippedCode: code,
  };
}

/**
 * Az időpont kimeneteléhez kötött stádiumváltás tranzakciós része.
 *
 * - átadás esemény vagy átadás munkafázis → STAGE_6;
 * - egyéb célstádium → kézi váltás;
 * - az esemény klinikai időpontja az appointment tényleges kezdete;
 * - idempotens: azonos stádiumot nem szúr be újra;
 * - átadás nem léptet vissza STAGE_7-ből STAGE_6-ba.
 *
 * Hibakezelés — KÉT külön eset:
 *  • KÉRT váltás (a felhasználó választott célstádiumot vagy klinikai eseményt):
 *    az akadály hibát dob, a hívó tranzakció visszagördül. A felhasználó
 *    tudatosan kért valamit, amit nem lehet végrehajtani.
 *  • SZÁRMAZTATOTT váltás (csak a munkafázis `step_code`-jából jön, pl.
 *    „delivery”): az akadály NEM dob. Az időpont-kimenetel rögzítése (státusz +
 *    „mi történt?”) sosem hiúsulhat meg egy stádium-könyvelési akadály miatt —
 *    a stádium marad, a válasz `skipped` + `message` mezője jelzi az esetet.
 */
export async function applyAppointmentStageTransition(
  args: ApplyAppointmentStageTransitionArgs,
): Promise<AppointmentStageTransitionResult> {
  const explicit = args.clinicalEvent === 'delivery' || !!args.requestedStageCode;
  const delivery = args.clinicalEvent === 'delivery' || isDeliveryStepCode(args.appointmentStepCode);
  const targetStageCode = delivery ? 'STAGE_6' : args.requestedStageCode;
  const source: AppointmentStageTransitionResult['source'] = delivery
    ? 'delivery'
    : targetStageCode
      ? 'manual'
      : null;

  // Akadály: kért váltásnál hiba, származtatottnál csendes kihagyás.
  const fail = (code: string): AppointmentStageTransitionResult => {
    if (explicit) throw new Error(code);
    return skippedResult(code, source);
  };

  if (!targetStageCode) {
    return {
      requested: false,
      changed: false,
      stageCode: null,
      stageLabel: null,
      at: null,
      source: null,
      message: null,
      skipped: false,
      skippedCode: null,
    };
  }

  if (!args.episodeId) return fail('STAGE_TRANSITION_REQUIRES_EPISODE');

  const episodeResult = await args.client.query(
    `SELECT id, patient_id, reason, status
       FROM patient_episodes
      WHERE id = $1
      FOR UPDATE`,
    [args.episodeId],
  );
  if (episodeResult.rows.length === 0) return fail('STAGE_EPISODE_NOT_FOUND');

  const episode = episodeResult.rows[0];
  if (episode.status !== 'open') return fail('STAGE_EPISODE_NOT_OPEN');

  const targetCatalog = await args.client.query(
    `SELECT code, label_hu, order_index
       FROM stage_catalog
      WHERE code = $1 AND reason = $2`,
    [targetStageCode, episode.reason],
  );
  if (targetCatalog.rows.length === 0) return fail('INVALID_STAGE_FOR_EPISODE');

  const target = targetCatalog.rows[0] as { code: string; label_hu: string; order_index: number };
  const currentResult = await args.client.query(
    `SELECT se.stage_code, se.at, sc.label_hu, sc.order_index
       FROM stage_events se
       LEFT JOIN stage_catalog sc ON sc.code = se.stage_code AND sc.reason = $2
      WHERE se.episode_id = $1
      ORDER BY se.at DESC, se.created_at DESC
      LIMIT 1`,
    [args.episodeId, episode.reason],
  );
  const current = currentResult.rows[0] as
    | { stage_code: string; at: Date; label_hu: string | null; order_index: number | null }
    | undefined;

  if (current?.stage_code === targetStageCode) {
    return {
      requested: true,
      changed: false,
      stageCode: targetStageCode,
      stageLabel: target.label_hu,
      at: current.at?.toISOString?.() ?? args.appointmentAt.toISOString(),
      source,
      message: `A stádium már „${target.label_hu}”, ezért nem jött létre duplikált bejegyzés.`,
      skipped: false,
      skippedCode: null,
    };
  }

  if (
    delivery &&
    typeof current?.order_index === 'number' &&
    current.order_index > target.order_index
  ) {
    return {
      requested: true,
      changed: false,
      stageCode: current.stage_code,
      stageLabel: current.label_hu ?? current.stage_code,
      at: current.at?.toISOString?.() ?? null,
      source,
      message: `A beteg már az átadást követő „${current.label_hu ?? current.stage_code}” stádiumban van; visszaléptetés nem történt.`,
      skipped: false,
      skippedCode: null,
    };
  }

  await args.client.query(
    `UPDATE patient_episodes
        SET stage_version = stage_version + 1
      WHERE id = $1`,
    [args.episodeId],
  );

  const note = delivery
    ? `Automatikus stádiumváltás a napi időpont átadás eredménye alapján (${args.appointmentId})`
    : `Kézi stádiumváltás a napi időpont eredményrögzítéséből (${args.appointmentId})`;

  const inserted = await args.client.query(
    `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING at`,
    [episode.patient_id, args.episodeId, targetStageCode, args.appointmentAt, note, args.changedBy],
  );
  const at = inserted.rows[0]?.at as Date | undefined;

  return {
    requested: true,
    changed: true,
    stageCode: targetStageCode,
    stageLabel: target.label_hu,
    at: at?.toISOString?.() ?? args.appointmentAt.toISOString(),
    source,
    message: delivery
      ? `Az átadás rögzítve; a stádium automatikusan „${target.label_hu}” állapotra váltott.`
      : `A stádium „${target.label_hu}” állapotra váltott.`,
    skipped: false,
    skippedCode: null,
  };
}
