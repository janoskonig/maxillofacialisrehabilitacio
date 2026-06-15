# Talált hibák — funkcionális összefoglaló

_Az időpontfoglaló / kezelési terv motor szimulációs és edge-case tesztelése során, 2026-06-15._

A hibákat itt **nem technikailag, hanem a klinikai munkafolyamatra gyakorolt hatás**
szerint csoportosítom: mi romlott volna el a gyakorlatban, és mit old meg a javítás.
Összesen **8 hiba**, mind javítva; **540 unit teszt + 30 edge-case** zöld.

---

## A) Beteg-biztonsági / klinikai sorrend

### 1. Sorrenden kívüli foglalás nem volt megakadályozva
- **Tünet:** egy késői munkafázis (pl. *próba*) lefoglalható volt, mielőtt a korábbi
  kötelező fázis (pl. *lenyomat*) megtörtént volna. Klinikailag értelmetlen/veszélyes
  sorrend keletkezhetett.
- **Javítás:** szerver-oldali sorrend-őr (`checkStepPrerequisites`) — blokkolja a
  korábbi, függőben lévő fázis átugrását; **auditált indoklással felülbírálható**
  (sürgős esetre). A normál (legkorábbi-függő) worklist-folyamatot nem érinti.

### 2. Hosszú fáziskódok csendes túlcsordulása
- **Tünet:** a `step_code` / `work_phase_code` oszlop túl rövid volt; egy hosszabb
  fáziskód projekció/foglalás közben **levágódott vagy hibát dobott** — a terv néma
  sérülése.
- **Javítás:** `varchar(80)` szélesítés (migráció 058) + **CI-őr**, ami buildkor
  elkapja a 80 karakternél hosszabb pathway-kódokat.

---

## B) Dupla foglalás / versenyhelyzet (race conditions)

### 3. Megerősítetlen „pending" foglalási útvonal
- **Tünet:** a `app/api/appointments/pending` útvonal nem zárolta a slotot a
  tranzakción belül → párhuzamos kérések **ugyanarra a slotra** elcsúszhattak,
  unique-violation nyers 500-asként jöhetett vissza.
- **Javítás:** `FOR UPDATE` slot-zár a tranzakcióban, kanonikus state ellenőrzés/írás,
  és a unique-ütközés tiszta **409** hibává fordítása.

### 4. A work-fázis dupla-foglalás védelem némán kikapcsolódhatott
- **Tünet:** egy séma-próba (`work_phase_id` oszlop létezése) **átmeneti DB-hibánál
  `false`-t cache-elt** (pl. connection-pool telítettségnél induláskor) → a
  „fázisonként egy aktív időpont" védőháló a folyamat **újraindításáig kikapcsolt**.
  Ekkor ugyanaz a kezelési fázis két különböző slotra is lefoglalható lett volna.
- **Hogyan jött elő:** az EC13 edge-case (5 párhuzamos foglalás telítette a kis poolt).
- **Javítás:** átmeneti hibánál **nem cache-elünk** negatív eredményt — egy későbbi
  hívás helyreáll.

### 5. Ugyanaz a hiba az attempt-számlálás próbájában
- **Tünet:** a `attempt_number` oszlop-próbája (`probeAttemptColumns`) **ugyanazt a
  cache-poisoning hibát** hordozta → átmeneti hibánál a **próbaszámlálás és a
  sikertelen-próba előzmény** kapcsolódott volna ki.
- **Javítás:** ugyanaz — nincs negatív cache átmeneti hibánál.

---

## C) Sikertelen / elmaradt ülés → ismétlés

### 6. No-show'd kezelési fázist **nem lehetett újrafoglalni** ⚠️ (a legjelentősebb)
- **Tünet:** ha a beteg **nem jött el** (`no_show`), a kezelési fázis az egyediségi
  index szerint továbbra is „aktív foglalásnak" számított. Az **új időpont foglalása
  ugyanarra a fázisra `WORK_PHASE_ALREADY_BOOKED (409)` hibával elbukott** — vagyis a
  meg nem jelent beteg pótidőpontját a `work_phase_id` útvonalon nem lehetett rögzíteni.
- **Az ellentmondás:** a rendszer máshol a `no_show`-t **kifejezetten valós próbaként**
  tartja nyilván (attempt-számlálás), a worklist pedig korábbi próbaként mutatja —
  tehát egy ismétlést feltételez, amit a foglalás mégis blokkolt.
- **Javítás (migráció 059 + kód):**
  - a `no_show` „felszabadító" státusz lett a fázis-egyediség szempontjából (mint az
    `unsuccessful`) — az **idő (slot) elhasználva marad**, de a **lépés foglalható**
    egy új próbára;
  - a státusz-route a no-show-nál visszanyitja a fázist `pending`-re és leoldja a
    halott foglalás-linket, így a worklist újra-foglalandóként mutatja;
  - az ismétlés helyesen **2. próbaként** (`attempt_number = 2`) rögzül.
- **Lefedve:** EC16 edge-case.

### (Kontextus) Sikertelen ülés (`unsuccessful`) ismétlése — működött, leteszteltük
- A „vizit megvolt, de a klinikai cél nem teljesült" eset (`mark_unsuccessful`) már
  helyesen újranyitotta a fázist és engedte a 2. próbát. Ezt az **EC15** edge-case
  visszaigazolta (a dupla-foglalás őr kizárja az `unsuccessful` sort, az ismétlés
  `attempt_number = 2`).

---

## D) Időzóna / üzemeltetés

### 7. No-show kockázatbecslés rossz órát használt (nyári/téli időszámítás)
- **Tünet:** a meg-nem-jelenési kockázat a **szerver helyi óráját**, nem a
  **budapesti** órát nézte → DST-átmenetnél (és eltérő szerver-időzónánál) a kora
  reggeli/késő délutáni idősávok kockázata félrecsúszhatott.
- **Javítás:** `budapestHour` használata (Europe/Budapest), regressziós teszttel
  (EC11: nyáron és télen egyaránt helyes a 08:00 helyi óra).

### 8. Árva „held/offered" slotok beragadtak
- **Tünet:** megszakadt foglalási folyamatból visszamaradt `held`/`offered` slotok
  **véglegesen elfoglaltnak** látszottak, csökkentve a tényleges kapacitást.
- **Javítás:** `stuck-slot-reaper` (lib + worker), ami az **árva** holdokat
  felszabadítja, az **élő** holdokat viszont megőrzi (EC9 igazolja mindkettőt).

---

## Tervezett, NEM hiba

- **`one-hard-next` kikapcsolva hagyva** (felhasználói döntés): ez engedi a hónapokkal
  előre több fázis egyidejű befoglalását — szándékos, nem hiba.

---

## Validáció

- **Hosszú terv szimuláció:** 20- és 17-fázisos tervek → 112 fázis → 112 intent →
  **112 lefoglalt (100%)** ~26 hónapra; **0 dupla foglalás**; a sorrend-őr blokkolja a
  rossz sorrendet.
- **Edge-case harness (`scripts/sim/edge-cases.ts`): 30/30 PASS** — konkurencia,
  sorrend-őr, múltbeli/üres slot, varchar(80), reaper, DST, no-pathway, ismétlés
  (sikertelen + no-show).
- **Unit: 540 teszt zöld**, typecheck tiszta.

> Megjegyzés: a B/4, B/5 és C/6 hibákat **maga az edge-case tesztelés tárta fel** —
> ez mutatja a szélsőséges esetek végigjátszásának értékét: olyan rejtett, néma
> védőháló-kieséseket találtunk, amelyek a normál „happy path" tesztekben nem látszanak.
