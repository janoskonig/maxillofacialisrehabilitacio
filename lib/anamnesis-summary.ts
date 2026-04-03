/** NEAK export: anamnézis összefoglaló a rögzített strukturált mezőkből. */

export type AnamnesisSummaryInput = {
  patientId: string;
  referralReason?: string | null;
  accident?: {
    date?: string | null;
    etiology?: string | null;
    other?: string | null;
  } | null;
  oncology?: {
    bno?: string | null;
    histology?: string | null;
    tnm?: string | null;
  } | null;
  therapies?: {
    radiotherapy?: string | null;
    radiotherapyDose?: string | null;
    radiotherapyInterval?: string | null;
    chemotherapy?: string | null;
    chemotherapyDesc?: string | null;
  } | null;
  risks?: {
    smoking?: string | null;
    alcohol?: string | null;
  } | null;
  dental?: {
    existingTeeth?: string | null;
    implants?: string | null;
  } | null;
  historySummary?: string | null;
};

/**
 * Összefoglaló a rögzített mezőkből; nem hív külső modellt.
 */
export function buildStructuredAnamnesisSummary(input: AnamnesisSummaryInput): string {
  const na = 'nincs adat';
  const lines = [
    `• Alapadatok: beteg azonosító: ${input.patientId}`,
    `• Főpanasz / beutalási ok: ${input.referralReason ?? na}`,
    `• Kórtörténeti események: baleset dátuma: ${input.accident?.date ?? na}; etiológia: ${input.accident?.etiology ?? na}; egyéb: ${input.accident?.other ?? na}`,
  ];

  if (input.historySummary) {
    lines.splice(3, 0, `• Korábbi összefoglaló: ${input.historySummary}`);
  }

  lines.push(
    `• Onkológia: BNO: ${input.oncology?.bno ?? na}; szövettan: ${input.oncology?.histology ?? na}; TNM: ${input.oncology?.tnm ?? na}`,
    `• Terápiák: RT: ${input.therapies?.radiotherapy ?? na} (dózis: ${input.therapies?.radiotherapyDose ?? na}; intervallum: ${input.therapies?.radiotherapyInterval ?? na}); CT: ${input.therapies?.chemotherapy ?? na} (${input.therapies?.chemotherapyDesc ?? na})`,
    `• Rizikók: dohányzás: ${input.risks?.smoking ?? na}; alkohol: ${input.risks?.alcohol ?? na}`,
    `• Allergia: ${na}`,
    `• Fogászati relevancia: meglévő fogak: ${input.dental?.existingTeeth ?? na}; implantátumok: ${input.dental?.implants ?? na}`,
    `• Megjegyzés: strukturált betegadatokból készült összefoglaló — klinikai ellenőrzés szükséges`
  );

  return lines.join('\n');
}
