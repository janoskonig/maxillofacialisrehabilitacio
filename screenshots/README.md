# Showcase képernyőképek (szimulált adatokon)

Ez a mappa az alkalmazás legfontosabb funkcióit mutatja be **desktop**, **tablet**
és **mobil** nézetben, teljesen fiktív (de élethű) magyar demo adatokkal.

> Minden beteg, orvos, diagnózis és időpont **kitalált** — kizárólag bemutató célra.

## Mappastruktúra

| Nézet | Felbontás | Eszköz |
|-------|-----------|--------|
| `desktop/` | 1440 × 900 (2×) | asztali böngésző |
| `tablet/`  | 834 × 1112 (2×) | iPad-szerű |
| `mobile/`  | 390 × 844 (3×) | telefon |

Minden nézetben ugyanaz a 20 képernyőkép készült:

| Fájl | Funkció |
|------|---------|
| `01-login` | Bejelentkezés (orvos + beküldő orvos) |
| `02-dashboard` | Főoldal — napi teendők + teljes beteglista |
| `03-patient-form-uj-beteg` | Új beteg felvételi űrlap (anamnézis, fogazati státusz) |
| `04-betegut-pipeline` | Beteg-előkészítési pipeline (kanban tábla) |
| `05-betegut-gantt` | Stádium GANTT — ellátási epizódok idővonala |
| `06-patient-detail` | Beteg adatlap — kommunikáció, konzílium, érintkezési napló |
| `06b-patient-clinical` | Beteg klinikai összefoglaló nézet |
| `07-patient-history` | Beteg-változási előzmények |
| `08-calendar` | Naptár — heti időpontnézet |
| `09-time-slots` | Időpontok / szabad idősávok kezelése |
| `10-consilium` | Konzílium — multidiszciplináris esetmegbeszélések |
| `11-messages` | Üzenetek (orvos↔orvos) |
| `12-tasks` | Feladataim |
| `13-tasks-overview` | Feladat-áttekintés (delegált + adat-teljesség) |
| `14-treatment-plans` | Kezelési tervek |
| `15-waiting-times` | Várakozási idők |
| `16-workload` | Leterheltség |
| `17-admin` | Adminisztráció |
| `18-admin-stats` | Statisztikák — analitikai irányítópult (OHIP-14, betegút-analitika) |
| `19-settings` | Beállítások |

## Demo bejelentkezés

| Szerep | Email | Jelszó |
|--------|-------|--------|
| admin | `admin@demo.hu` | `Demo1234!` |
| fogpótlástanász | `fogpotlas@demo.hu` | `Demo1234!` |
| technikus | `technikus@demo.hu` | `Demo1234!` |
| beutaló orvos | `beutalo@demo.hu` | `Demo1234!` |

## Újragenerálás

1. Adatbázis + függőségek beállítása (lásd `AGENTS.md` / `DATABASE_SETUP.md`), majd
   migrációk futtatása.
2. Demo adatok betöltése:
   ```bash
   node scripts/seed-showcase-demo.js     # felhasználók, betegek, epizódok, időpontok, stb.
   node scripts/seed-showcase-stages.js   # stádium-előzmények a pipeline / GANTT feltöltéséhez
   ```
3. Dev szerver indítása: `npm run dev` (érdemes `NODE_OPTIONS=--max-old-space-size=4096`).
4. Képernyőképek készítése (Chrome for Testing automatikusan a `.demo-chrome/`
   mappából):
   ```bash
   DEMO_PATIENT_ID=<egy beteg id> node scripts/capture-showcase.js
   ```
   A `.demo-chrome/` (letöltött Chrome bináris) szándékosan nincs verziókövetve.
