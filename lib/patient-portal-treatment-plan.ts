/**
 * Normalizes kezelési terv JSONB rows for patient portal display.
 */

export type PortalTreatmentPlanItem = {
  label: string;
  tervezettAtadasDatuma: string | null;
  elkeszult: boolean;
  detail?: string | null;
};

export type PortalTreatmentPlanSummary = {
  felso: PortalTreatmentPlanItem[];
  also: PortalTreatmentPlanItem[];
  arcotErinto: PortalTreatmentPlanItem[];
};

function mapFelsoAlsoItem(
  entry: unknown,
  codeToLabel: Map<string, string>
): PortalTreatmentPlanItem {
  const o = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  const code = typeof o.treatmentTypeCode === 'string' ? o.treatmentTypeCode.trim() : '';
  const tipus = typeof o.tipus === 'string' ? o.tipus.trim() : '';
  let label: string;
  if (code && codeToLabel.has(code)) {
    label = codeToLabel.get(code)!;
  } else if (tipus) {
    label = tipus;
  } else if (code) {
    label = code;
  } else {
    label = 'Kezelés';
  }
  const tervezettAtadasDatuma =
    typeof o.tervezettAtadasDatuma === 'string' && o.tervezettAtadasDatuma
      ? o.tervezettAtadasDatuma
      : null;
  return {
    label,
    tervezettAtadasDatuma,
    elkeszult: Boolean(o.elkeszult),
  };
}

function mapArcotItem(entry: unknown): PortalTreatmentPlanItem {
  const o = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  const tipus = typeof o.tipus === 'string' ? o.tipus.trim() : '';
  const label = tipus || 'Arcot érintő kezelés';
  const elh = typeof o.elhorgonyzasEszkoze === 'string' ? o.elhorgonyzasEszkoze.trim() : '';
  const detail = elh ? `Elhorgonyzás: ${elh}` : null;
  const tervezettAtadasDatuma =
    typeof o.tervezettAtadasDatuma === 'string' && o.tervezettAtadasDatuma
      ? o.tervezettAtadasDatuma
      : null;
  return {
    label,
    detail,
    tervezettAtadasDatuma,
    elkeszult: Boolean(o.elkeszult),
  };
}

export function buildPortalTreatmentPlanSummary(
  felsoRaw: unknown,
  alsoRaw: unknown,
  arcotRaw: unknown,
  codeToLabel: Map<string, string>
): PortalTreatmentPlanSummary {
  const felso = Array.isArray(felsoRaw) ? felsoRaw.map((e) => mapFelsoAlsoItem(e, codeToLabel)) : [];
  const also = Array.isArray(alsoRaw) ? alsoRaw.map((e) => mapFelsoAlsoItem(e, codeToLabel)) : [];
  const arcotErinto = Array.isArray(arcotRaw) ? arcotRaw.map(mapArcotItem) : [];
  return { felso, also, arcotErinto };
}

export function treatmentPlanHasAnyRows(summary: PortalTreatmentPlanSummary): boolean {
  return summary.felso.length > 0 || summary.also.length > 0 || summary.arcotErinto.length > 0;
}
