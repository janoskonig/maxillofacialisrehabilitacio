/**
 * OpenAI kliens az anamnézis összefoglaló generálásához
 * Server-only file - ne használd client-side!
 */

import OpenAI from "openai";
import { isValidAnamnesisSummary } from "./utils";

// Module-szinten példányosítás (server-only file)
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export type AnamnesisInput = {
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
  treatmentPlan?: {
    upper?: string | null;
    lower?: string | null;
    facial?: string | null;
  } | null;
  dental?: {
    existingTeeth?: string | null;
    implants?: string | null;
  } | null;
  historySummary?: string | null; // kortorteneti_osszefoglalo
};

/**
 * Fallback összefoglaló strukturált adatokból
 */
function fallbackSummary(input: AnamnesisInput): string {
  const na = "nincs adat";
  const lines = [
    `• Alapadatok: beteg azonosító: ${input.patientId}`,
    `• Főpanasz / beutalási ok: ${input.referralReason ?? na}`,
    `• Kórtörténeti események: baleset dátuma: ${input.accident?.date ?? na}; etiológia: ${input.accident?.etiology ?? na}; egyéb: ${input.accident?.other ?? na}`,
  ];

  // Ha van kézi összefoglaló, beemeljük
  if (input.historySummary) {
    lines.splice(3, 0, `• Korábbi összefoglaló: ${input.historySummary}`);
  }

  lines.push(
    `• Onkológia: BNO: ${input.oncology?.bno ?? na}; szövettan: ${input.oncology?.histology ?? na}; TNM: ${input.oncology?.tnm ?? na}`,
    `• Terápiák: RT: ${input.therapies?.radiotherapy ?? na} (dózis: ${input.therapies?.radiotherapyDose ?? na}; intervallum: ${input.therapies?.radiotherapyInterval ?? na}); CT: ${input.therapies?.chemotherapy ?? na} (${input.therapies?.chemotherapyDesc ?? na})`,
    `• Rizikók: dohányzás: ${input.risks?.smoking ?? na}; alkohol: ${input.risks?.alcohol ?? na}`,
    `• Allergia: ${na}`, // ha lesz mező, ide be
    `• Fogászati relevancia: meglévő fogak: ${input.dental?.existingTeeth ?? na}; implantátumok: ${input.dental?.implants ?? na}`,
    `• Megjegyzés: AI-generált összefoglaló — ellenőrzendő (fallback mód)`
  );

  return lines.join("\n");
}

// Signal típus kezelés (SDK verziótól függően)
type RequestOptions = {
  signal?: AbortSignal;
};

/**
 * AI-generált anamnézis összefoglaló generálása
 * Fallback strukturált adatokból, ha az API nem elérhető vagy hiba történik
 */
export async function generateAnamnesisSummary(
  input: AnamnesisInput
): Promise<{ text: string; aiGenerated: boolean }> {
  // Fallback ha nincs API key
  if (!openai || !process.env.OPENAI_API_KEY) {
    return { text: fallbackSummary(input), aiGenerated: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const instructions =
      "Feladat: magyar nyelvű, klinikailag neutrális anamnézis összefoglaló.\n" +
      "Szabályok: 8–12 bullet, a megadott fejezetek sorrendjében. Ne találj ki semmit. Hiányzó adatnál írd: 'nincs adat'. " +
      "A végén legyen: 'AI-generált összefoglaló — ellenőrzendő'.";

    const requestOptions: RequestOptions = { signal: controller.signal };
    const response = await openai.responses.create({
      ...(process.env.OPENAI_MODEL ? { model: process.env.OPENAI_MODEL } : {}),
      input: [
        { role: "system", content: instructions },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(input) }],
        },
      ],
      temperature: 0.1,
      ...requestOptions,
    } as any); // Cast csak itt, ha szükséges (SDK verziótól függően)

    const text = (response.output_text ?? "").trim();

    // Séma-validáció: ellenőrizzük, hogy megfelel-e a kényszernek
    if (!text || !isValidAnamnesisSummary(text)) {
      return { text: fallbackSummary(input), aiGenerated: false };
    }

    return { text, aiGenerated: true };
  } catch (e: any) {
    // PHI-safe log: csak error code / típus / request id jelleg
    // Ne logolj promptot/nyers betegadatot!
    // console.warn("OpenAI anamnesis summary failed", { name: e?.name, code: e?.code });
    return { text: fallbackSummary(input), aiGenerated: false };
  } finally {
    clearTimeout(timeout);
  }
}
