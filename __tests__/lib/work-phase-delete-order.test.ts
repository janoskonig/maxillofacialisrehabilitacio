import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * WP-0.8, audit #13 — sorrend-őr (kódszintű pin, a terv előírása szerint).
 *
 * A lib/work-phase-delete.ts-ben a nyitott slot_intentek lejáratásának a
 * foglalás-scan ELŐTT kell futnia: fordított sorrendnél egy párhuzamos
 * konverzió frissen commitolt appointmentje kicsúszna a scan pillanatképéből,
 * miközben az intent 'converted'-ként az expiry-t is elkerülné — élő foglalás
 * maradna egy törölt fázison. A viselkedés versenyhelyzet-függő, determinisz-
 * tikusan nem futtatható, ezért itt a forrásbeli sorrendet rögzítjük.
 */
describe('work-phase-delete — intent-expiry a foglalás-scan előtt (audit #13)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'work-phase-delete.ts'), 'utf8');

  it('a nyitott intentek lejáratása megelőzi az aktív foglalások scanjét', () => {
    const expiryIdx = src.search(/UPDATE slot_intents[\s\S]{0,200}?state = 'open'/);
    const scanIdx = src.search(/SELECT a\.id, a\.time_slot_id, a\.slot_intent_id\s*\n?\s*FROM appointments/);
    expect(expiryIdx, 'nyitott-intent expiry UPDATE nem található').toBeGreaterThan(-1);
    expect(scanIdx, 'foglalás-scan SELECT nem található').toBeGreaterThan(-1);
    expect(
      expiryIdx,
      'az open-intent expiry-nek a foglalás-scan ELŐTT kell futnia (audit #13) — ha ezt a sorrendet szándékosan változtatod, olvasd el a lib/work-phase-delete.ts 1) pontjának kommentjét'
    ).toBeLessThan(scanIdx);
  });
});
