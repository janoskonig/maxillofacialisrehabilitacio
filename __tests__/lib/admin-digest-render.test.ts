import { describe, it, expect } from 'vitest';
import {
  buildAdminDigestText,
  buildDigestModel,
  renderAdminDigestHtml,
  type DigestNotification,
} from '@/lib/email/admin-digest-render';

let seq = 0;
function n(
  notification_type: string,
  summary_text: string,
  detail_json: Record<string, unknown> = {},
  minutes = 0
): DigestNotification {
  return {
    id: ++seq,
    notification_type,
    summary_text,
    detail_json,
    created_at: new Date(Date.UTC(2026, 7, 20, 6, 0) + minutes * 60_000),
  };
}

const periodText = '2026. 08. 20. 08:00:00 – 2026. 08. 20. 09:00:00';

describe('buildDigestModel', () => {
  it('szereplőnként és típusonként összesít, staff/páciens bontásban', () => {
    const model = buildDigestModel([
      n('login', 'a@k.hu: bejelentkezés', { userEmail: 'a@k.hu' }),
      n('login', 'a@k.hu: bejelentkezés', { userEmail: 'a@k.hu' }, 1),
      n('patient_search', 'a@k.hu: keresés', { userEmail: 'a@k.hu' }, 2),
      n('appointment_approved', 'Kiss Ilona elfogadta', { patientName: 'Kiss Ilona', patientEmail: 'k@p.hu' }, 3),
    ]);

    expect(model.total).toBe(4);
    expect(model.staff).toHaveLength(1);
    expect(model.staff[0].total).toBe(3);
    expect(model.staff[0].types[0]).toEqual({ type: 'login', count: 2 });
    expect(model.patient).toHaveLength(1);
    expect(model.patientTotal).toBe(1);
    expect(model.typeTotals[0]).toEqual({ type: 'login', count: 2 });
  });

  it('a kiemelt típusokat tételesen gyűjti, és nem duplázza az "Egyéb" listába', () => {
    const model = buildDigestModel([
      n('missing_data_no_owner', 'Hiányos beteg kezelőorvos nélkül: Horváth Éva'),
      n('time_slot_freed', 'Felszabadult időpont: 2026-08-22 09:00', {}, 1),
      n('login', 'a@k.hu: bejelentkezés', { userEmail: 'a@k.hu' }, 2),
    ]);

    expect(model.highlights.map((h) => h.type)).toEqual(['missing_data_no_owner']);
    expect(model.otherSummaries).toEqual(['Felszabadult időpont: 2026-08-22 09:00']);
  });
});

describe('renderAdminDigestHtml', () => {
  const many: DigestNotification[] = Array.from({ length: 30 }, (_, i) =>
    n('login', `u${i}@k.hu: bejelentkezés`, { userEmail: `u${i}@k.hu` }, i)
  );

  it('mobilbarát: nincs vízszintesen görgetett blokk és nincs 13px alatti betűméret', () => {
    const html = renderAdminDigestHtml(many, { periodText });
    expect(html).not.toMatch(/overflow-x/);
    const tooSmall = html.match(/font-size:\s*(\d+)px/g)?.filter((m) => {
      const px = Number(m.replace(/\D/g, ''));
      return px > 0 && px < 12;
    });
    expect(tooSmall ?? []).toEqual([]);
  });

  it('a hosszú farkat összecsukja "+N további" sorrá', () => {
    const html = renderAdminDigestHtml(many, { periodText });
    expect(html).toContain('+ 22 további (22 esemény)');
  });

  it('escape-eli a naplóból jövő szöveget', () => {
    const html = renderAdminDigestHtml(
      [n('patient_created', '<script>alert(1)</script> & "x"', { userEmail: 'a@k.hu' })],
      { periodText }
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('csak akkor tesz gombot a levélbe, ha van appUrl', () => {
    expect(renderAdminDigestHtml(many, { periodText })).not.toContain('<a href=');
    expect(renderAdminDigestHtml(many, { periodText, appUrl: 'https://example.hu' })).toContain(
      'https://example.hu'
    );
  });
});

describe('buildAdminDigestText', () => {
  it('olvasható sima szöveget ad (nem TSV-mátrixot)', () => {
    const text = buildAdminDigestText(
      [
        n('patient_created', 'a@k.hu: új beteg — Tóth Gábor', { userEmail: 'a@k.hu' }),
        n('login', 'a@k.hu: bejelentkezés', { userEmail: 'a@k.hu' }, 1),
      ],
      { periodText }
    );

    expect(text).toContain('AKTIVITÁS — 2 esemény');
    expect(text).toContain('KIEMELT ESEMÉNYEK (1)');
    expect(text).toContain('- a@k.hu — 2 (');
    expect(text).not.toContain('\t');
  });
});
