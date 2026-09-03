import { describe, it, expect } from 'vitest';
import {
  resolveLabQuoteRecipients,
  buildLabQuoteSendPlan,
  LabQuoteRecipientError,
  DEFAULT_LAB_QUOTE_TO,
  DEFAULT_LAB_QUOTE_REPLY_TO,
  MAX_LAB_QUOTE_RECIPIENTS,
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

describe('buildLabQuoteSendPlan', () => {
  const env = {
    LAB_QUOTE_EMAIL_TO: 'labor@example.com',
    LAB_QUOTE_EMAIL_CC: 'archiv@example.com',
    LAB_QUOTE_EMAIL_REPLY_TO: 'valasz@example.com',
  };

  it('üres vagy hiányzó lista esetén az env/alapérték címzettjeit adja (source: default)', () => {
    for (const requested of [undefined, null, '', []]) {
      expect(buildLabQuoteSendPlan(requested, env)).toEqual({
        to: 'labor@example.com',
        cc: ['archiv@example.com'],
        replyTo: 'valasz@example.com',
        source: 'default',
      });
    }
  });

  it('megadott listánál az első a To, a többi CC, az env CC rákerül, duplikátum nélkül', () => {
    expect(
      buildLabQuoteSendPlan(['Fonover@Klinika.hu', 'labor@example.com', 'fonover@klinika.hu', 'archiv@example.com'], env)
    ).toEqual({
      to: 'fonover@klinika.hu',
      cc: ['labor@example.com', 'archiv@example.com'],
      replyTo: 'valasz@example.com',
      source: 'custom',
    });
  });

  it('vesszővel vagy pontosvesszővel felsorolt címeket is szétszedi, egyetlen stringből is', () => {
    const plan = buildLabQuoteSendPlan('a@example.com, b@example.com; c@example.com', {});
    expect(plan.to).toBe('a@example.com');
    expect(plan.cc).toEqual(['b@example.com', 'c@example.com']);
    expect(plan.source).toBe('custom');
  });

  it('érvénytelen címnél dob, és felsorolja a hibás elemeket', () => {
    expect(() => buildLabQuoteSendPlan(['jo@example.com', 'nem-email', 42], env)).toThrow(LabQuoteRecipientError);
    try {
      buildLabQuoteSendPlan(['jo@example.com', 'nem-email'], env);
    } catch (error) {
      const err = error as LabQuoteRecipientError;
      expect(err.code).toBe('invalid_email');
      expect(err.invalid).toEqual(['nem-email']);
      expect(err.message).toContain('nem-email');
    }
  });

  it('a címzettek számát korlátozza', () => {
    const many = Array.from({ length: MAX_LAB_QUOTE_RECIPIENTS + 1 }, (_, i) => `u${i}@example.com`);
    expect(() => buildLabQuoteSendPlan(many, env)).toThrow(/Legfeljebb/);
    expect(() => buildLabQuoteSendPlan(many.slice(0, MAX_LAB_QUOTE_RECIPIENTS), env)).not.toThrow();
  });
});
