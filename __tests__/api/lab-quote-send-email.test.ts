import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SEND_ROUTE = read('app/api/patients/[id]/lab-quote-requests/[quoteId]/send-email/route.ts');
const LIST_ROUTE = read('app/api/patients/[id]/lab-quote-requests/route.ts');
const SUGGEST_ROUTE = read('app/api/lab-quote-recipients/route.ts');
const SECTION = read('components/patient-form/ArajanlatkeroSection.tsx');

describe('árajánlatkérő e-mail címzettválasztás', () => {
  it('a küldő route a kérés címzettlistájából épít tervet, hibás címre 400-at ad, még a PDF előtt', () => {
    expect(SEND_ROUTE).toMatch(/buildLabQuoteSendPlan\(body\?\.recipients\)/);
    expect(SEND_ROUTE).toMatch(/LabQuoteRecipientError/);
    expect(SEND_ROUTE).toMatch(/HttpError\(400, error\.message, 'INVALID_RECIPIENTS'\)/);
    expect(SEND_ROUTE.indexOf('buildLabQuoteSendPlan(')).toBeLessThan(SEND_ROUTE.indexOf('generateLabQuoteRequestPDF('));
    expect(SEND_ROUTE).toMatch(/to: plan\.to/);
    expect(SEND_ROUTE).toMatch(/recipients: \[plan\.to, \.\.\.plan\.cc\]/);
  });

  it('a lista route visszaadja az utolsó küldés címzettjét és másolatát', () => {
    expect(LIST_ROUTE).toMatch(/el\.recipient as "lastEmailRecipient"/);
    expect(LIST_ROUTE).toMatch(/el\.metadata->>'cc' as "lastEmailCc"/);
  });

  it('a javaslat-végpont bejelentkezést igényel, és a labor alapértelmezéssel indul', () => {
    expect(SUGGEST_ROUTE).toMatch(/authedHandler\(/);
    expect(SUGGEST_ROUTE).toMatch(/resolveLabQuoteRecipients\(\)/);
    expect(SUGGEST_ROUTE).toMatch(/email_type = 'lab_quote' AND status = 'sent'/);
    expect(SUGGEST_ROUTE).toMatch(/FROM users/);
  });

  it('a felület a küldő-modalt nyitja meg a vak megerősítés helyett', () => {
    expect(SECTION).toMatch(/LabQuoteSendModal/);
    expect(SECTION).toMatch(/setSendTarget\(quote\)/);
    expect(SECTION).not.toMatch(/Biztosan elküldi az árajánlatkérőt emailben/);
  });
});
