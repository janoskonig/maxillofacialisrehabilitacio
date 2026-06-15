# Javítások + újrateszt hosszú, összetett kezelési tervekkel

_Készült: 2026-06-15 · eldobható `maxfac_sim` adatbázis · éles adatot nem érintett_

A korábbi beteg­biztonsági jelentés 6 megállapításából **5-öt kijavítottam**, a 6. (one-hard-next)
a te döntésed alapján **szándékosan KI maradt** (hogy a hónapokra előre foglalás megmaradjon).
Az újratesztet most **hosszú, sok lépéses tervekkel** futtattam (max. **20 fázis**, ~2 évre előre).

---

## Javított hibák

| # | Hiba | Javítás | Hol | Ellenőrizve |
|---|---|---|---|---|
| 1 | `step_code` `varchar(50)` < 80-as fáziskód → projekció/foglalás elszáll | Mindhárom `step_code` oszlop `varchar(80)`-ra szélesítve | `database/migrations/058_widen_step_code_to_80.sql` | ✅ A korábban hibás 54-karakteres út + új 66-karakteres kód is hibátlanul lefoglalódott |
| 2 | Lépés-sorrend nem volt kikényszerítve | Szerveroldali előfeltétel-őr: korábbi `pending` fázis esetén tiltás (override indoklással felülbírálható, auditálva) | `lib/scheduling-service.ts` (`checkStepPrerequisites`), `lib/appointment-service.ts` | ✅ Out-of-order foglalás `BLOCKED` (STEP_PREREQUISITE_NOT_MET) |
| 4 | `appointments/pending` gyenge zárolás, status/state szétcsúszás | `SELECT … FOR UPDATE` a tranzakcióban, `state` ellenőrzés+frissítés, barátságos 409 | `app/api/appointments/pending/route.ts` | ✅ typecheck + 540 teszt zöld |
| 5 | No-show kockázat szerver-helyi órával számolt | Budapest-időzónás óra (DST-helyes) | `lib/datetime.ts` (`budapestHour`), `lib/scheduling-service.ts` | ✅ Új unit teszt: `__tests__/lib/budapest-hour.test.ts` (4 teszt zöld) |
| 6 | Nincs takarító a beragadt `held`/`offered` slotokra | Védő reaper (csak árva, jövőbeli slotokat szabadít fel) | `lib/stuck-slot-reaper.ts`, `scripts/stuck-slot-reaper.ts` | ✅ Lefut, 0 árva slotot talált (helyes) |

**Plusz megelőzés:** `scripts/check-care-pathway-code-lengths.ts` — CI/kézi ellenőrzés, hibát jelez,
ha bármely ellátási út fáziskódja > 80 karakter (az #1 hibaosztály visszatérésének megakadályozására).

### #3 / one-hard-next — szándékosan változatlan
A te döntésed: **maradjon KI**, hogy egy epizódhoz több jövőbeli munkaidőpont is felvehető legyen
(a hónapokra előre foglaláshoz). A mechanizmus hibátlan, bármikor bekapcsolható, ha később mégis kell.

---

## Újrateszt — hosszú, összetett tervek

Két szintetikus, sok lépéses ellátási utat hoztam létre:
- **Komplex onkológiai rekonstrukció** — **20 fázis** (konzultáció → diagnosztika → onko-team →
  sebészi tervezés → műtét → posztop kontrollok → lenyomatok → próbák → átadás → 1/6/12 hó kontroll)
- **Komplex full-arch implantációs rehabilitáció** — **17 fázis**

### Eredmények
- **10 beteg**, **3 orvos**, **14 400 szabad időpont** (~3 évre előre, 90 perces slotok)
- **112 kezelési fázis** generálva → **112 slot-intent** projektálva → **112 időpont lefoglalva (100%)**
- Leghosszabb terv: **20 fázis** (Tóth Anna), foglalások **2026-06-16 → 2028-03-28** (~21 hónap)
- Leghosszabb időtáv: Horváth Ferenc terve **2028-08-22**-ig (~26 hónap előre)
- **Egyetlen ellátási út sem maradt ki** (az #1 javítás után a hosszú kódúak is mennek)

### Adat-integritás (112 időpont)
- Dupla foglalás: **0** ✓
- Status/state szétcsúszás: **0** ✓
- Beragadt `held`/`offered` slot: **0** ✓
- Lépés-sorrend őr: out-of-order foglalás **BLOKKOLVA** ✓

### Minőségbiztosítás
- `npx tsc --noEmit`: hibátlan
- `npm run test`: **540 teszt zöld** (1 skip) — a foglalási mag módosításai nem törtek el semmit

---

## Reprodukálás
```bash
bash scripts/sim/bootstrap-schema.sh && npm run migrate    # séma + migrációk (058 is)
npx tsx scripts/sim/run-simulation.ts                      # hosszú tervek + őr-teszt
npm run dev &                                              # app :3000
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/sim/screenshots.mjs
```

> Korlát: statikus + szimulációs eredmények eldobható adatbázison. A javítások éles bevezetése
> előtt javasolt éles-szerű adaton tesztelni és a klinikai folyamatot validálni.
