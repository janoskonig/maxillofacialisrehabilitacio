/**
 * Regresszió: a napi kimenetel („mi történt?") rögzítése nem hiúsulhat meg
 * olyan mellékhatás miatt, amit a felhasználó nem is kért.
 *
 *  1. Az átadás-munkafázisból SZÁRMAZTATOTT stádiumváltás akadálya (nincs
 *     epizód / lezárt epizód / hiányzó katalógus-sor) nem gördíti vissza a
 *     mentést — lásd lib/appointment-stage-transition.ts.
 *  2. A recall-típuszár csak tényleges típusváltásnál szólal meg; a kimenetel-
 *     űrlap a változatlan típust is elküldi, abból nem lehet 409.
 *  3. A kliens nem küld magától `clinicalEvent`-et: az átadás-származtatás a
 *     szerveré, különben KÉRT váltásként hard error lenne belőle.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const ROUTE = readFileSync(
  join(ROOT, 'app', 'api', 'appointments', '[id]', 'status', 'route.ts'),
  'utf8',
);
const HOOK = readFileSync(join(ROOT, 'hooks', 'useAppointmentOutcomes.ts'), 'utf8');
const ROW = readFileSync(join(ROOT, 'components', 'appointments', 'AppointmentOutcomeRow.tsx'), 'utf8');

describe('PATCH /api/appointments/[id]/status — a kimenetel mentése elsőbbséget élvez', () => {
  it('a tranzakció eleji FOR UPDATE olvassa a jelenlegi típust is', () => {
    expect(ROUTE).toMatch(/appointment_type\s+AS "appointmentType"/);
  });

  it('a recall-zár csak tényleges típusváltásnál fut le', () => {
    expect(ROUTE).toMatch(/const currentType: string \| null = apptBefore\.appointmentType \?\? null;/);
    expect(ROUTE).toMatch(/if \(nextType !== currentType && nextType !== 'recall'\) \{/);
    // A korábbi feltétel minden mentésnél lefutott:
    expect(ROUTE).not.toMatch(/if \(appointmentType !== 'recall'\) \{/);
  });

  it('a kihagyott származtatott stádiumváltást logolja, nem hibázik el rajta', () => {
    expect(ROUTE).toMatch(/stageTransition\?\.skipped/);
    expect(ROUTE).toMatch(/logger\.warn\(/);
  });

  it('a stádium-hibatérkép megmarad a KÉRT váltásokhoz', () => {
    expect(ROUTE).toMatch(/STAGE_EPISODE_NOT_OPEN/);
    expect(ROUTE).toMatch(/INVALID_STAGE_FOR_EPISODE/);
  });
});

describe('Mai időpontok — kliensoldali kimenetel-űrlap', () => {
  it('nem küld automatikus clinicalEvent-et átadás-fázisnál', () => {
    expect(HOOK).not.toMatch(/clinicalEvent: appointment\.isDeliveryStep \? 'delivery' : ''/);
    expect(ROW).not.toMatch(/value === 'completed' && appointment\.isDeliveryStep \? 'delivery' : ''/);
  });

  it('a stádium-visszajelzés jelöli, ha a váltás elmaradt', () => {
    expect(HOOK).toMatch(/skipped: !!stageTransition\.skipped/);
    expect(ROW).toMatch(/stageNotice\.skipped/);
  });
});
