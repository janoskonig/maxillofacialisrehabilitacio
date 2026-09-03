/**
 * Az árajánlatkérő (labor) e-mail címzettjei.
 *
 * Env-ből állítható, hogy a labor címének cseréjéhez ne kelljen kódot módosítani:
 *   LAB_QUOTE_EMAIL_TO       – a labor címe (egy cím)
 *   LAB_QUOTE_EMAIL_CC       – másolat(ok), vesszővel elválasztva
 *   LAB_QUOTE_EMAIL_REPLY_TO – válaszcím
 * Ha nincs megadva, a korábbi, kódban rögzített értékek élnek.
 */

export const DEFAULT_LAB_QUOTE_TO = 'konig.janos@semmelweis.hu';
export const DEFAULT_LAB_QUOTE_REPLY_TO = 'konig.janos@semmelweis.hu';

export interface LabQuoteRecipients {
  to: string;
  cc: string[];
  replyTo: string;
}

type RecipientEnv = Partial<
  Record<'LAB_QUOTE_EMAIL_TO' | 'LAB_QUOTE_EMAIL_CC' | 'LAB_QUOTE_EMAIL_REPLY_TO', string | undefined>
>;

function parseAddressList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.includes('@'));
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
