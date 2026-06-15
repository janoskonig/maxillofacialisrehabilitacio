# Edge-case (szélsőséges eset) tesztek — jelentés

_Készült: 2026-06-15 · eldobható `maxfac_sim` adatbázis · a valódi motorfüggvényeken futtatva_

Adverzáriális, assert-alapú tesztharness (`scripts/sim/edge-cases.ts`), amely a szélsőséges
helyzeteket a tényleges foglalási kódon futtatja. **Eredmény: 22 ellenőrzés, mind PASS.**
A futás közben **egy valódi (kis súlyú) robusztussági hibát is feltárt**, amit kijavítottam.

## Lefedett szélsőséges esetek

| Eset | Mit tesztel | Eredmény |
|---|---|---|
| **EC1** | 5 egyidejű foglalás **ugyanarra az időpontra** | Pontosan 1 nyer; 1 appointment; slot `booked` ✓ |
| **EC2** | Munkafázis foglalása a **sorrendből kihagyva** | Tiltva (`STEP_PREREQUISITE_NOT_MET`) ✓ |
| **EC3** | Sorrenden kívüli foglalás **override indoklással** | Engedélyezve + auditálva ✓ |
| **EC4** | Korábbi fázisok **kihagyva (skipped)** | A későbbi lépés foglalható ✓ |
| **EC5** | **Múltbeli** időpont foglalása | Elutasítva ✓ |
| **EC6** | **Nincs szabad slot** az ablakban | `kind=none` (nem omlik össze) ✓ |
| **EC7** | **80 karakteres** fáziskód projekciója | Nem dob hibát, intentek létrejönnek ✓ |
| **EC8** | **81 karakteres** kód | A hossz-ellenőrző elkapja ✓ |
| **EC9** | Slot-takarító: **árva** vs **élő hold** | Árvát felszabadít, élőt megőriz ✓ |
| **EC10** | Epizód **ellátási út nélkül** | Nem omlik össze, kezelt fallback ✓ |
| **EC11** | **Nyári/téli időszámítás** (DST) | 08:00 budapesti óra mindkét évszakban helyes ✓ |
| **EC12** | **Csak kontroll** fázisokból álló terv | Foglalható következő lépés ✓ |
| **EC13** | **Ugyanazon kezelési fázis** egyidejű foglalása két slotra | Csak 1 nyer (`WORK_PHASE_ALREADY_BOOKED`) ✓ |
| **EC14** | **Ismétlődő fáziskódok** egy tervben | Generálás + projekció nem hibázik ✓ |

(13 esetből 22 assertion, mert több esetnek több ellenőrzése van — pl. EC1/EC9/EC13.)

## A teszt által feltárt valódi hiba (+ javítás)

**Schema-probe `false`-ra cache-elt átmeneti hibánál** — `lib/active-appointment.ts`
`probeAppointmentsWorkPhaseIdColumn`. Ez ellenőrzi, hogy létezik-e a `work_phase_id` oszlop
(ettől függ a **„fázisonként egy aktív időpont”** dupla-foglalás elleni védelem). A kód
átmeneti hiba (pl. connection-pool telítettség) esetén **`false`-t cache-elt**, ami a
folyamat újraindításáig **kikapcsolta** a `work_phase_id`-t — és vele a fázis-szintű
dupla-foglalás védelmet.

- **Hogyan jött elő:** EC1 öt egyidejű foglalása telítette a kis poolt (`DB_POOL_MAX=5`),
  a probe nem kapott saját kapcsolatot → `false`-t cache-elt → EC13-ban a védelem „eltűnt”.
- **Súlyosság:** alacsony (ritka, csak ha az első probe pont átmenetileg hibázik), de
  beteg­biztonsági szempontból releváns, mert egy védőhálót némán kikapcsolhatott.
- **Javítás:** átmeneti hibánál **nem cache-elünk** negatív eredményt — egy későbbi hívás
  újrapróbálhatja. (`lib/active-appointment.ts`)
- A teszt-harness ezen felül „bemelegíti” a probe-ot a konkurens eset előtt.

## Minőségbiztosítás
- `tsc --noEmit`: hibátlan
- `npm run test`: **540 teszt zöld**
- `scripts/sim/edge-cases.ts`: **22/22 PASS** (riport: `sim-out/edge-cases-report.txt`)

## Reprodukálás
```bash
npx tsx scripts/sim/edge-cases.ts   # exit 0 = minden PASS, exit 1 = van FAIL
```
