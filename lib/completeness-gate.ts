import { getDbPool } from '@/lib/db';
import { getPatientCompletenessRow } from '@/lib/patient-data-completeness';
import { logger } from '@/lib/logger';

/**
 * Klinikai adat-teljességi kapu egy mérföldkőhöz (jelenleg: új epizód indítása).
 *
 * A kötelező klinikai minimum (8 mező + OP-röntgen) hiányában a mérföldkő
 * blokkol (422). A felelős kezelőorvos (fogpótlástanász) vagy admin `force` +
 * `overrideReason` megadásával felülbírálhatja — minden felülbírálás a
 * `completeness_gate_override` táblába naplózódik (későbbi számonkérés).
 */

export type GateRole = 'admin' | 'beutalo_orvos' | 'fogpótlástanász' | 'technikus';

export type GateDecision =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

export interface ClinicalGateInput {
  patientId: string;
  /** Melyik kapu (audit + jövőbeli kapuk megkülönböztetése), pl. 'new_episode'. */
  gate: string;
  role: GateRole;
  userId: string;
  force?: boolean;
  overrideReason?: string;
}

/** Felülbírálásra a kezelőorvos (fogpótlástanász) és az admin jogosult. */
export function canOverrideClinicalGate(role: GateRole): boolean {
  return role === 'admin' || role === 'fogpótlástanász';
}

/** A klinikai kapu által vizsgált beteg-sor (a teljes completeness sor részhalmaza). */
export interface GateCompletenessRow {
  clinicalComplete: boolean;
  clinicalMissing: { key: string; label: string }[];
}

export type GatePureDecision =
  | { kind: 'allow' }
  | { kind: 'override'; missingSummary: string }
  | { kind: 'block'; status: number; body: Record<string, unknown> };

/**
 * A kapu DÖNTÉSI logikája — tiszta (DB-mentes), így unit-tesztelhető. A hívó
 * `'override'` esetén naplóz, majd átengedi a műveletet.
 */
export function decideClinicalGate(
  row: GateCompletenessRow | null,
  input: { role: GateRole; force?: boolean; overrideReason?: string },
): GatePureDecision {
  // Nincs sor (ismeretlen beteg) vagy teljes klinikai adat → a kapu nyitva.
  if (!row || row.clinicalComplete) return { kind: 'allow' };

  const canOverride = canOverrideClinicalGate(input.role);
  const force = input.force === true;
  const overrideReason = input.overrideReason?.trim?.() || '';

  if (!force) {
    return {
      kind: 'block',
      status: 422,
      body: {
        error: 'CLINICAL_DATA_INCOMPLETE',
        message:
          'A kötelező klinikai adatok hiányosak. Pótolja a hiányzó mezőket, vagy kezelőorvosként/adminként felülbírálással folytassa.',
        missing: row.clinicalMissing,
        canOverride,
      },
    };
  }

  if (!canOverride) {
    return {
      kind: 'block',
      status: 403,
      body: {
        error: 'OVERRIDE_NOT_ALLOWED',
        message: 'A hiányos adat felülbírálását csak a kezelőorvos vagy admin végezheti.',
      },
    };
  }

  if (!overrideReason) {
    return {
      kind: 'block',
      status: 422,
      body: {
        error: 'OVERRIDE_REASON_REQUIRED',
        message: 'A kapu felülbírálásához indok megadása kötelező.',
      },
    };
  }

  return { kind: 'override', missingSummary: row.clinicalMissing.map((m) => m.label).join(', ') };
}

export async function checkClinicalGate(input: ClinicalGateInput): Promise<GateDecision> {
  const row = await getPatientCompletenessRow(input.patientId);
  const decision = decideClinicalGate(row, input);

  if (decision.kind === 'allow') return { ok: true };
  if (decision.kind === 'block') {
    return { ok: false, status: decision.status, body: decision.body };
  }

  // override → naplózzuk, majd átengedjük.
  try {
    await getDbPool().query(
      `INSERT INTO completeness_gate_override (patient_id, gate, user_id, reason, missing_summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.patientId, input.gate, input.userId, input.overrideReason?.trim?.() || '', decision.missingSummary],
    );
  } catch (auditErr) {
    // A napló hibája ne akadályozza a (jogosultan) felülbírált műveletet.
    logger.error('[completeness-gate] override naplózás sikertelen:', auditErr);
  }

  return { ok: true };
}
