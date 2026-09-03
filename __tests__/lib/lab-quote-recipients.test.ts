import { describe, it, expect } from 'vitest';
import {
  resolveLabQuoteRecipients,
  DEFAULT_LAB_QUOTE_TO,
  DEFAULT_LAB_QUOTE_REPLY_TO,
} from '@/lib/email/lab-quote-recipients';

describe('resolveLabQuoteRecipients', () => {
  it('env nélkül a kódbeli alapértékeket adja, CC nélkül', () => {
    expect(resolveLabQuoteRecipients({})).toEqual({
      to: DEFAULT_LAB_QUOTE_TO,
      cc: [],
      replyTo: DEFAULT_LAB_QUOTE_REPLY_TO,
    });
  });

  it('env-ből veszi a címzettet, a CC-listát és a válaszcímet', () => {
    expect(
      resolveLabQuoteRecipients({
        LAB_QUOTE_EMAIL_TO: ' labor@example.com ',
        LAB_QUOTE_EMAIL_CC: 'a@example.com, b@example.com; a@example.com',
        LAB_QUOTE_EMAIL_REPLY_TO: 'valasz@example.com',
      })
    ).toEqual({
      to: 'labor@example.com',
      cc: ['a@example.com', 'b@example.com'],
      replyTo: 'valasz@example.com',
    });
  });

  it('érvénytelen vagy üres értéknél visszaesik az alapértékre, és a TO-t nem duplázza CC-be', () => {
    expect(
      resolveLabQuoteRecipients({
        LAB_QUOTE_EMAIL_TO: 'nem-email',
        LAB_QUOTE_EMAIL_CC: DEFAULT_LAB_QUOTE_TO.toUpperCase(),
        LAB_QUOTE_EMAIL_REPLY_TO: '',
      })
    ).toEqual({ to: DEFAULT_LAB_QUOTE_TO, cc: [], replyTo: DEFAULT_LAB_QUOTE_REPLY_TO });
  });
});
