# Ütemezési és kezelési-terv motor — beteg­biztonsági jelentés

_Készült: 2026-06-15 · eldobható `maxfac_sim` adatbázison futtatott szimuláció + forráskód-átvizsgálás alapján · **éles beteg­adatot nem érintett**_

Ez a jelentés azt vizsgálja, hogy az ütemezés és a kezelési tervek logikája okozhat-e
**beteget érintő hibát**: dupla foglalás, „elfelejtett” beteg, rossz időpont, vagy klinikailag
rossz sorrendű kezelési lépés. Minden megállapítás a tényleges forráskódon alapul (fájl:sor),
és külön kiemelem azt is, **ami bizonyítottan rendben van**, hogy ne aggódj feleslegesen.

---

## Összefoglaló (TL;DR)

**A motor magja biztonságos.** A foglalási tranzakció helyesen zárol, és adatbázis-szintű
`UNIQUE(time_slot_id)` védi a dupla foglalást — a 86 szimulált foglalásban **nem volt** dupla
foglalás, állapot-eltérés vagy orvosi időpont-ütközés. A *lefoglalt* időpontok időzónája is helyes.

**Amit érdemes rendezni, mielőtt baj lenne:**

| # | Probléma | Súlyosság | Beteget érintő következmény |
|---|---|---|---|
| 1 | `step_code` oszlop `varchar(50)`, de a fáziskód lehet 80 karakter | **Magas** | Egy egész ellátási út terve nem generálódik le / nem foglalható |
| 2 | Klinikai lépés-sorrend csak *javaslat*, nincs kikényszerítve | **Közepes** | Lépés rossz sorrendben lefoglalható (pl. próba a lenyomat előtt) |
| 3 | „Egy kemény következő lépés” szabály alapból **KI** van kapcsolva | **Közepes** | Egy epizódhoz több jövőbeli „kemény” munkaidőpont is felvehető |
| 4 | `appointments/pending` (admin feltételes időpont) gyenge zárolás | **Közepes** | Status/state szétcsúszás; ritka ütközésnél nyers 500-as hiba |
| 5 | No-show kockázat rossz időzónával számol | **Alacsony–közepes** | Hibás kockázati pontszám / megerősítés-kérés (időpontot nem rontja) |
| 6 | Nincs „takarító” a beragadt `held`/`offered` időpontokra | **Alacsony (látens)** | Elvi lehetőség: egy időpont véglegesen foglalhatatlanná válhat |

---

## Ami bizonyítottan RENDBEN van (ne aggódj emiatt)

- **Dupla foglalás kizárva.** `createAppointment` (`lib/appointment-service.ts`) helyesen
  tranzakcionális: `BEGIN` (135. sor) → epizód zárolás `FOR UPDATE` (142) → időpont zárolás
  `SELECT … FOR UPDATE` (275–282) → `state='free'` ellenőrzés (290–294) → foglalás (526–547)
  → `COMMIT` (566). A `convertIntentToAppointment` (`lib/convert-slot-intent.ts`) `FOR UPDATE
  SKIP LOCKED` + újrazárolással ugyanígy korrekt. Backstop: `UNIQUE(time_slot_id)`
  (`database/legacy/migration_time_slots.sql:23`) — egy időpontra csak egy foglalás. **A
  szimulációban 86 foglalásból 0 dupla foglalás.**
- **A lefoglalt időpont órája helyes.** Az időpont `start_time`-ja közvetlenül az időpont-slot
  `timestamptz` értékéből jön, adatbázis-trigger szinkronizálja (`migration_scheduling_v2.sql:62–77`).
  A nyári/téli időszámítás-váltás a *lefoglalt* időpontot nem tolja el.
- **A hold-lejárat (`lib/hold-expiry.ts`) versenyhelyzet-biztos.**
- **Az ablak-számítás nem fordul meg** (`windowStart ≤ windowEnd` mindig — `lib/step-window.ts:18–26`).
- **A fő munkalista nem ejti el a beteget.** A `wip-next-appointments` a tiszta, nem dobó
  `allPendingStepsWithData`-t használja — egy hibás adat hangosan elszáll (500 + retry), nem
  *némán* tünteti el a beteget a listáról.

---

## Bugok részletesen

### 1. `step_code` oszlopszélesség eltérés — **Magas** (bizonyított, éles adaton is jelentkezne)
- `episode_work_phases.work_phase_code` = `varchar(80)`, de `slot_intents.step_code` és
  `appointments.step_code` = **`varchar(50)`** (`migration_scheduling_v2.sql:127`,
  `migration_intent_appointment_link.sql:18`).
- A betöltött **„Kapocselhorgonyzású részleges fémlemezes fogpótlás”** ellátási út fáziskódja
  **54 karakter** → a fázisgenerálás még átengedi, de a `projectRemainingSteps` és a tömeges
  „összes intent foglalása” elszáll: `value too long for type character varying(50)`.
- **Beteget érintő következmény:** ezen az ellátási úton a beteg jövőbeli terve **nem
  generálódik le és nem foglalható tömegesen**. Hangos hiba (500), tehát a személyzet észreveszi,
  de a beteg ütemezése elakad, amíg valaki rá nem jön az okára.
- **Javítás:** a három oszlop egységesítése `varchar(80)`-ra (vagy a kód rövidítése), és egy
  teszt, amely minden `care_pathway` fáziskódjának hosszát ellenőrzi.

### 2. A klinikai lépés-sorrend csak javaslat, nincs kikényszerítve — **Közepes** (klinikailag a legrelevánsabb)
- `computePhaseWindowChain` (`lib/phase-window-chain.ts`) csak *megjelenítési* „legkorábbi kezdés”
  korlátot ad. Sem a `convertIntentToAppointment` (csak „már kész/kihagyott” 168–186 és „van már
  aktív időpont” 188–205 ellenőrzés), sem a `createAppointment` nem nézi, hogy a **megelőző
  kötelező lépés** kész/foglalt-e.
- **Beteget érintő következmény:** elvileg lefoglalható pl. `try_in_1` (próba) a `impression_1`
  (lenyomat) **előtt**. A rendszer arra épít, hogy a személyzet a munkalistából a helyes lépést
  választja. Közvetlen API-hívással vagy figyelmetlen foglalással rossz sorrend keletkezhet.
- **Javítás:** szerveroldali előfeltétel-ellenőrzés (legalább figyelmeztetés/„override” indoklással)
  a `createAppointment`/`convert` útvonalon.

### 3. „Egy kemény következő lépés” szabály alapból KI — **Közepes**
- `getSchedulingFeatureFlag` hiányzó sor esetén **`false`-t** ad (`lib/scheduling-feature-flags.ts:50`).
  A 028-as migráció `enforce_one_hard_next=false`-t állít és **eldobja** az adatbázis-szintű
  `idx_appointments_one_hard_next` parciális UNIQUE indexet (`028_one_hard_next_optional.sql:47`).
  Az éles sémában az index **nincs jelen** (ellenőrizve).
- **Beteget érintő következmény:** ha a klinika sosem kapcsolja be a flaget, egy epizódhoz **több
  jövőbeli „kemény” munkaidőpont** is felvehető, és nincs adatbázis-szintű védőháló sem. A
  `checkOneHardNext` logika maga helyes — csak alapból nem fut.
- **Javítás (döntés kérdése):** ha a klinika elvárja az „egyszerre egy munkaidőpont” szabályt,
  kapcsold be a `enforce_one_hard_next` flaget, és érdemes az adatbázis-indexet is visszaállítani.

### 4. `app/api/appointments/pending` (admin feltételes időpont) gyenge zárolás — **Közepes**
- A slotot `FOR UPDATE` **nélkül** olvassa (52–58), csak a régi `status<>'available'`-t nézi (69),
  a `state` oszlopot nem; foglaláskor **csak `status='booked'`-ot** ír, a `state`-et nem (146–149).
- **Következmény:** (a) a slot `status='booked'` de `state='free'` marad → **status/state
  szétcsúszás**; (b) két egyidejű admin kérésnél nincs sorbarendezés *itt* — a dupla foglalást a
  `UNIQUE(time_slot_id)` megfogja, de **nyers 500-asként** jön vissza (ezen az útvonalon nincs
  barátságos hibakezelés). Valódi dupla foglalás **nem** keletkezik.
- **Javítás:** `SELECT … FOR UPDATE`, a `state` ellenőrzése és frissítése, valamint
  `translateUniqueViolation` használata.

### 5. No-show kockázat rossz időzónával — **Alacsony–közepes**
- `lib/scheduling-service.ts:132` a `timeSlotStart.getHours()`-t használja (**szerver-helyi** óra,
  nem budapesti). A `no-show-risk.ts:62` a 7–9 órás idősávra emel kockázatot.
- **Következmény:** UTC szerveren egy 08:00 budapesti időpont 06:00 UTC → a kora reggeli
  kockázatemelés kimarad / más órákon téved. **Csak a kockázati pontszámot / megerősítés-kérést
  érinti, az időpontot nem.**
- **Javítás:** budapesti zónában számolt óra (mint a projektor `Intl.DateTimeFormat`-ja).

### 6. Nincs „takarító” a beragadt `held`/`offered` időpontokra — **Alacsony (látens)**
- A foglalás csak `state='free'`-t fogyaszt (`scheduling-service.ts:19–21`). Nem találtam olyan
  workert, amely a `held`/`offered` állapotú slotot visszaállítaná `free`-re a slot `state` alapján
  (a `runHoldExpiry` az *időpont* `hold_expires_at`-ja alapján szabadít fel).
- **Következmény (elvi):** ha bármely kód `held`/`offered`-re állít egy slotot megfelelő
  appointment-hold nélkül, az a slot **véglegesen foglalhatatlan** marad. Aktív „termelőt” nem
  találtam erre az állapotra, ezért ez **látens** kockázat.
- **Javítás:** időzített takarító vagy ellenőrző lekérdezés a „árva” `held`/`offered` slotokra.

### Megjegyzés (ellenőrizendő, nem megerősített bug)
A szimulációban a 91 `slot_intent` `open` maradt a foglalás után is — de ez **valószínűleg a
szimulációs harness műterméke** (közvetlenül foglaltam, nem a munkalista intent-konverziós útján,
ami `converted`-re állítaná). Éles, munkalistán át történő foglalásnál ezt érdemes leellenőrizni,
hogy a lefoglalt lépés intentje valóban lezárul-e.

---

## Javasolt fejlesztések (prioritás szerint)

1. **(Magas)** `step_code` oszlopok egységesítése `varchar(80)`-ra + automata teszt minden
   `care_pathway` fáziskód-hosszára. _(Egy egész ellátási út ütemezése múlik rajta.)_
2. **(Közepes, klinikai)** Szerveroldali lépés-előfeltétel ellenőrzés a foglalásnál (rossz sorrend
   megakadályozása vagy legalább explicit override indoklással).
3. **(Közepes)** Döntés az „egy kemény következő lépés” szabályról: flag bekapcsolása + DB-index
   visszaállítása, ha a klinika elvárja.
4. **(Közepes)** `appointments/pending` útvonal megerősítése (FOR UPDATE, `state` kezelés,
   barátságos 409).
5. **(Alacsony–közepes)** No-show kockázat budapesti időzónára.
6. **(Alacsony)** Takarító a beragadt `held`/`offered` slotokra.
7. **(Üzemeltetés)** A sémaépítés törékeny (lásd `scripts/sim/bootstrap-schema.sh`): a legacy
   migrációk implicit sorrendje és nem-idempotens triggerei miatt érdemes lenne egy tiszta,
   sorrendezett bootstrap szkript a `database/legacy/`-hoz.

---

## Mit teszteltem (módszertan)

- **Adat-integritás (éles motor, 86 foglalás):** dupla foglalás — nincs; status/state eltérés —
  nincs; orvosonkénti időpont-ütközés — nincs; beragadt `held`/`offered` — nincs.
- **Kód-átvizsgálás (fájl:sor szinten):** foglalási tranzakció és zárolás, időzóna-kezelés,
  hibaterjedés (projekció/next-step kivételek), ablak-matematika és sorrend, one-hard-next
  alapérték, lejárati/hold workerek.

> Fontos korlát: ezek **statikus + szimulációs** megállapítások egy eldobható adatbázison. Nem
> helyettesítik az éles adatokon végzett tesztelést és a klinikai folyamat-validációt.
