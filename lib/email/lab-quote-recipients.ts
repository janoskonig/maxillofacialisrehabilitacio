/**
 * Az árajánlatkérő (labor) e-mail címzettjei.
 *
 * Alapértelmezés env-ből, hogy a labor címének cseréjéhez ne kelljen kódot módosítani:
 *   LAB_QUOTE_EMAIL_TO       – a labor címe (egy cím)
 *   LAB_QUOTE_EMAIL_CC       – másolat(ok), vesszővel elválasztva
 *   LAB_QUOTE_EMAIL_REPLY_TO – válaszcím
 * Ha nincs megadva, a korábbi, kódban rögzített értékek élnek.
 *
 * Küldéskor a felhasználó felülbírálhatja a címzetteket (buildLabQuoteSendPlan):
 * az első cím a To, a többi CC; az env-ben beállított CC mindig rákerül.
 */

export const DEFAULT_LAB_QUOTE_TO = 'konig.janos@semmelweis.hu';
export const DEFAULT_LAB_QUOTE_REPLY_TO = 'konig.janos@semmelweis.hu';
export const MAX_LAB_QUOTE_RECIPIENTS = 10;
export const EMAIL_REGEX = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export interface LabQuoteRecipients {
  to: string;
  cc: string[];
  replyTo: string;
}

export interface LabQuoteSendPlan extends LabQuoteRecipients {
  /** 'default': env/alapérték; 'custom': a felhasználó adta meg a címzetteket */
  source: 'default' | 'custom';
}

type RecipientEnv = Partial<
  Record<'LAB_QUOTE_EMAIL_TO' | 'LAB_QUOTE_EMAIL_CC' | 'LAB_QUOTE_EMAIL_REPLY_TO', string | undefined>
>;

export class LabQuoteRecipientError extends Error {
  code: 'invalid_email' | 'too_many';
  invalid: string[];

  constructor(code: 'invalid_email' | 'too_many', message: string, invalid: string[] = []) {
    super(message);
    this.name = 'LabQuoteRecipientError';
    this.code = code;
    this.invalid = invalid;
  }
}

function parseAddressList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.includes('@'));
}

function dedupeEmails(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function resolveLabQuoteRecipients(
  env: RecipientEnv | Record<string, string | undefined> = process.env
): LabQuoteRecipients {
  const to = parseAddressList(env.LAB_QUOTE_EMAIL_TO)[0] ?? DEFAULT_LAB_QUOTE_TO;
  const replyTo = parseAddressList(env.LAB_QUOTE_EMAIL_REPLY_TO)[0] ?? DEFAULT_LAB_QUOTE_REPLY_TO;
  const cc = Array.from(new Set(parseAddressList(env.LAB_QUOTE_EMAIL_CC))).filter(
    (address) => address.toLowerCase() !== to.toLowerCase()
  );
  return { to, cc, replyTo };
}

/**
 * Küldési terv a kérésben kapott címzettlistából. Üres lista → env/alapérték.
 * A lista elemei lehetnek vesszővel elválasztott címek is; a sorrend számít:
 * az első a To, a többi CC. Érvénytelen címnél vagy túl sok címzettnél dob.
 */
export function buildLabQuoteSendPlan(
  requested: unknown,
  env: RecipientEnv | Record<string, string | undefined> = process.env
): LabQuoteSendPlan {
  const defaults = resolveLabQuoteRecipients(env);
  const rawItems: unknown[] = Array.isArray(requested)
    ? requested
    : requested == null || requested === ''
      ? []
      : [requested];

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const item of rawItems) {
    if (typeof item !== 'string') {
      invalid.push(String(item));
      continue;
    }
    for (const part of item.split(/[,;\n]+/)) {
      const email = part.trim();
      if (!email) continue;
      if (EMAIL_REGEX.test(email)) valid.push(email);
      else invalid.push(email);
    }
  }

  if (invalid.length > 0) {
    throw new LabQuoteRecipientError(
      'invalid_email',
      `Érvénytelen e-mail cím: ${invalid.join(', ')}`,
      invalid
    );
  }

  const unique = dedupeEmails(valid);
  if (unique.length > MAX_LAB_QUOTE_RECIPIENTS) {
    throw new LabQuoteRecipientError(
      'too_many',
      `Legfeljebb ${MAX_LAB_QUOTE_RECIPIENTS} címzett adható meg`
    );
  }
  if (unique.length === 0) {
    return { ...defaults, source: 'default' };
  }

  const to = unique[0];
  const cc = dedupeEmails([...unique.slice(1), ...defaults.cc]).filter((address) => address !== to);
  return { to, cc, replyTo: defaults.replyTo, source: 'custom' };
}
