/**
 * Egységes kliens-oldali hibakiolvasó az API-válaszokból.
 *
 * Cél: SOHA ne vesszen el a hiba forrása. Minden nem-2xx válaszból kinyerjük a
 *   • `error`  — emberi (magyar) üzenet,
 *   • `code`   — stabil gépi kód (pl. SLOT_ALREADY_BOOKED),
 *   • `hint`   — opcionális teendő,
 *   • `correlationId` — az `x-correlation-id` fejlécből (a backend MINDEN
 *     válaszra ráteszi, lásd lib/api/route-handler.ts), amivel a UI-hiba
 *     egy-az-egyben összeköthető a szerver-loggal.
 *
 * A `formatApiError` ebből a felhasználónak is olvasható, ugyanakkor support/
 * debug szempontból nyomonkövethető szöveget épít.
 */

export interface ExtractedApiError {
  /** Emberi üzenet a szervertől (vagy fallback). */
  message: string;
  /** Stabil gépi kód, ha a szerver küldött. */
  code: string | null;
  /** Opcionális teendő/tipp a szervertől. */
  hint: string | null;
  /** Korrelációs azonosító a log-összekötéshez. */
  correlationId: string | null;
  /** HTTP státusz. */
  status: number;
}

/** Strukturált hibaboríték (api-error-handler.ts) — best-effort olvasáshoz. */
interface ErrorBodyShape {
  error?: unknown;
  code?: unknown;
  hint?: unknown;
  _errorMeta?: { code?: unknown; correlationId?: unknown } | null;
}

/**
 * Kiolvassa a hibainformációt egy `fetch` Response-ból. Nem dob: non-JSON
 * (pl. proxy HTML hibaoldal) vagy üres test esetén is értelmes objektumot ad.
 * A választ `clone()`-on olvassa, hogy a hívó később még olvashassa a bodyt.
 */
export async function extractApiError(
  response: Response,
  fallbackMessage = 'Hiba történt',
): Promise<ExtractedApiError> {
  const status = response.status;
  const correlationFromHeader = response.headers?.get?.('x-correlation-id') ?? null;

  let body: ErrorBodyShape | null = null;
  try {
    body = (await response.clone().json()) as ErrorBodyShape;
  } catch {
    // non-JSON / üres test — marad a fallback
  }

  const rawMessage = typeof body?.error === 'string' ? body.error.trim() : '';
  const message = rawMessage.length > 0 ? rawMessage : fallbackMessage;

  const metaCode = body?._errorMeta && typeof body._errorMeta.code === 'string' ? body._errorMeta.code : null;
  const code = typeof body?.code === 'string' ? body.code : metaCode;

  const hint = typeof body?.hint === 'string' && body.hint.trim().length > 0 ? body.hint.trim() : null;

  const metaCorrelation =
    body?._errorMeta && typeof body._errorMeta.correlationId === 'string' ? body._errorMeta.correlationId : null;
  const correlationId = correlationFromHeader ?? metaCorrelation;

  return { message, code, hint, correlationId, status };
}

/**
 * Felhasználónak + supportnak is használható szöveg: a valódi üzenet, az
 * opcionális tipp, és egy másolható debug-címke a kód + korrelációs azonosítóból.
 * Pl.: "Ez az időpont már le van foglalva\n[SLOT_ALREADY_BOOKED · 7f3a…]".
 */
export function formatApiError(e: ExtractedApiError): string {
  const parts: string[] = [e.message];
  if (e.hint) parts.push(`Tipp: ${e.hint}`);
  const tag = [e.code, e.correlationId].filter(Boolean).join(' · ');
  if (tag) parts.push(`[${tag}]`);
  return parts.join('\n');
}

/** Convenience: Response → felhasználói szöveg egy lépésben. */
export async function toUserMessage(response: Response, fallbackMessage = 'Hiba történt'): Promise<string> {
  return formatApiError(await extractApiError(response, fallbackMessage));
}
