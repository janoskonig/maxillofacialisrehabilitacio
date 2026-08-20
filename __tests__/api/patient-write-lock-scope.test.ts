/**
 * Forrás-szintű őrtesztek a beteg-mentés optimista zárolására.
 *
 * Ezek NEM futtatnak DB-t; a cél, hogy a PR 2 invariánsai egy későbbi refaktorban
 * ne essenek ki csendben. Mindegyik olyan tulajdonságot véd, aminek a hiánya
 * NÉMA adatvesztéshez vagy holtponthoz vezet, nem látható hibához.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const PATIENT_PUT = read('app', 'api', 'patients', '[id]', 'route.ts');
const TOOTH_PATCH = read('app', 'api', 'patients', '[id]', 'tooth-treatments', '[treatmentId]', 'route.ts');
const APPOINTMENT_SERVICE = read('lib', 'appointment-service.ts');
const CONVERT_INTENT = read('lib', 'convert-slot-intent.ts');

describe('beteg-PUT: compare-and-swap az írási tranzakcióban', () => {
  it('a patients UPDATE WHERE ága tartalmazza az If-Match feltételt', () => {
    // Enélkül az ellenőrzés visszacsúszna a tranzakción kívülre (TOCTOU), és egy
    // párhuzamos fog-lezárás fogtérképe némán felülíródna a következő autosave-vel.
    expect(PATIENT_PUT).toContain("date_trunc('milliseconds', updated_at) = $19::timestamptz");
    expect(PATIENT_PUT).toContain('$19::timestamptz IS NULL');
  });

  it('az összehasonlítás ezredmásodpercre igazít — a nyers egyenlőség tilos', () => {
    // A patients.updated_at teljes (mikroszekundumos) timestamptz, a token viszont
    // körbejár egy JS Date-en, ami ms-re csonkol. Nyers `updated_at = $19`-cel a
    // predikátum gyakorlatilag soha nem talál egyezést (élőben ellenőrizve: a dev DB
    // 9 sorából 0 volt ms-igazított) → MINDEN mentés hamis 409-et kapna, és a beteg
    // tartósan menthetetlenné válna.
    expect(PATIENT_PUT).not.toMatch(/AND\s+updated_at\s*=\s*\$19::timestamptz/);
  });

  it('a token clock_timestamp()-ből jön, nem CURRENT_TIMESTAMP-ből, és ms-igazított', () => {
    // A CURRENT_TIMESTAMP a TRANZAKCIÓ KEZDETE: egy záron várakozó író régebbi
    // tokent írna, mint amit az előtte commitoló már visszaadott a kliensnek.
    expect(PATIENT_PUT).toContain("date_trunc('milliseconds', clock_timestamp())");
    expect(PATIENT_PUT).not.toContain('updated_at=CURRENT_TIMESTAMP');
    // GREATEST: két, azonos ezredmásodpercbe eső írásnál is szigorúan nő a token —
    // erre épül a kliensoldali monotonitás-ellenőrzés.
    expect(PATIENT_PUT).toContain('GREATEST(');
  });

  it('a saját tokent RETURNING-ből olvassa', () => {
    expect(PATIENT_PUT).toMatch(/RETURNING updated_at/);
  });

  it('a gyermektáblák írása a CAS-kapu UTÁN van', () => {
    const casIndex = PATIENT_PUT.indexOf('$19::timestamptz IS NULL');
    const childIndex = PATIENT_PUT.indexOf('INSERT INTO patient_referral');
    expect(casIndex).toBeGreaterThan(-1);
    expect(childIndex).toBeGreaterThan(casIndex);
  });

  it('nincs explicit SELECT ... FOR UPDATE a patients soron', () => {
    // A FOR UPDATE ütközne a ~37 gyermektábla INSERT-jeinek FOR KEY SHARE zárával
    // (üzenet, időpont, dokumentum) — a kulcsot nem érintő UPDATE nem.
    expect(PATIENT_PUT).not.toMatch(/FROM patients WHERE id = \$1 FOR UPDATE/);
  });

  it('a 409 beágyazott error objektumot ad, kóddal', () => {
    // A kliens (lib/storage.ts) csak objektum-`error`-ból olvassa ki a code-ot;
    // lapos alaknál a STALE_WRITE banner némán elmaradna.
    expect(PATIENT_PUT).toContain("code: 'STALE_WRITE'");
    expect(PATIENT_PUT).toContain("name: 'ConflictError'");
  });

  it('a COMMIT utáni visszaolvasás a tranzakció kliensének elengedése UTÁN fut', () => {
    // Bent hagyva minden párhuzamos PUT egy kapcsolatot fogva kérne egy másodikat;
    // DB_POOL_MAX (alap: 5) darab elég a kölcsönös várakozáshoz, amit csak a 10 s-os
    // connection timeout oldana fel — a sikeres írásra 500 jönne vissza.
    const release = PATIENT_PUT.indexOf('client.release()');
    const reread = PATIENT_PUT.indexOf('FROM patients_full WHERE id = $1');
    expect(release).toBeGreaterThan(-1);
    expect(reread).toBeGreaterThan(release);
  });

  it('a törölt beteg a visszaolvasáskor 404, nem üres objektum 200-zal', () => {
    expect(PATIENT_PUT).toContain("return { ok: false, reason: 'not_found' };");
    expect(PATIENT_PUT).not.toContain('patient: row ?? {}');
  });

  it('a kezelőorvos-újraolvasás nem írja felül a tranzakcióból kapott tokent', () => {
    // Az az olvasás a COMMIT után, zár nélkül fut — egy közben commitolt idegen
    // írás tokenjét adhatná vissza, amit a kliens If-Match-ként küldve megkerülné
    // a CAS-kaput.
    expect(PATIENT_PUT).toContain('const ownToken = newPatient.updatedAt');
    expect(PATIENT_PUT).toContain('newPatient.updatedAt = ownToken');
  });
});

describe('fog-lezárás: zár-sorrend és feltételes bump', () => {
  it('a patients zárat a tooth_treatments zár ELŐTT veszi fel', () => {
    const patientLock = TOOTH_PATCH.indexOf('lockPatientForWrite');
    const toothLock = TOOTH_PATCH.indexOf('FROM tooth_treatments WHERE id = $1');
    expect(patientLock).toBeGreaterThan(-1);
    expect(toothLock).toBeGreaterThan(patientLock);
  });

  it('csak akkor bumpol, ha a fogtérkép ténylegesen változott', () => {
    // A szabály nélküli kódok (pl. csiszolás) korai return-nel távoznak; egy no-op
    // lezárás nem küldheti 409-be a többi megnyitott fület.
    expect(TOOTH_PATCH).toMatch(/if\s*\(dentalStatusUpdated\)\s*\{/);
  });

  it('a válasz a bump ELŐTTI tokent is visszaadja', () => {
    // Enélkül egy elavult fül „megmosná" a saját tokenjét — ezen a végponton nincs
    // If-Match, tehát a friss token önmagában nem bizonyíték a naprakészségre.
    expect(TOOTH_PATCH).toContain('patientPreviousUpdatedAt');
    expect(TOOTH_PATCH).toContain('patientUpdatedAt');
  });

  it('a bump és a lezárás egy tranzakcióban van (COMMIT után nincs bump)', () => {
    const bump = TOOTH_PATCH.indexOf('bumpPatientLockToken(client');
    const commit = TOOTH_PATCH.indexOf("client.query('COMMIT')");
    expect(bump).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(bump);
  });
});

describe('foglalási út: patients-first zár-sorrend', () => {
  it('a patients zárat az epizód-zár ELŐTT veszi fel', () => {
    // Fordított sorrendnél holtpont-pár áll fenn a lib/patient-episode-create.ts-szel:
    // ott patients → epizód a sorrend, itt epizód → (FK miatt) patients lenne.
    const patientLock = APPOINTMENT_SERVICE.indexOf('lockPatientKeyShare(client');
    const episodeLock = APPOINTMENT_SERVICE.indexOf('FROM patient_episodes WHERE id = $1 FOR UPDATE');
    expect(patientLock).toBeGreaterThan(-1);
    expect(episodeLock).toBeGreaterThan(patientLock);
  });

  it('a foglalási út a leggyengébb elég zárat használja (FOR KEY SHARE)', () => {
    // FOR UPDATE itt minden párhuzamos gyermek-INSERT-et blokkolna a betegen.
    expect(APPOINTMENT_SERVICE).toContain('lockPatientKeyShare');
  });

  it('a tömeges intent-konverzió is patients-first', () => {
    // A „Összes szükséges időpont lefoglalása" út külön kódon megy; ha kimarad,
    // a holtpont-kör zárva marad a patient-episode-create.ts-szel.
    const patientLock = CONVERT_INTENT.indexOf('lockPatientKeyShare(client');
    const episodeLock = CONVERT_INTENT.indexOf('FROM patient_episodes WHERE id = $1 FOR UPDATE');
    expect(patientLock).toBeGreaterThan(-1);
    expect(episodeLock).toBeGreaterThan(patientLock);
  });
});
