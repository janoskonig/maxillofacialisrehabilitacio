# Kezelési terv & időpont fül — újratervezési és javítási terv

**Státusz:** A TELJES TERV VÉGREHAJTVA — FÁZIS 0–3: 2026-08-27 (PR #58–#76),
FÁZIS 4: 2026-08-28 (PR #77–#80, külön `episode_visits` táblával);
FÁZIS 6 (Puzzle v2, kéthasábos tábla): 2026-09-02 ·
**Készült:** 2026-08-27 · **Alap-commit:** `09d6446` (main)
**Címzett:** végrehajtó agent-szett. Ez a fájl a kanonikus forrás; ha valami ellentmond a
beszélgetésnek, ez a fájl nyer.

> **EGYETLEN IGAZSÁGFORRÁS (SSOT): ez a fájl, a `main` branchen**
> (`docs/KEZELESI_TERV_FUL_REDESIGN_TERV.md`). A claude.ai artifact
> (`d0051dc6-6db4-484a-9c37-427aa0613ffb`) csak publikált tükör, mérföldköveknél frissül;
> eltérés esetén ez a fájl nyer.

## Végrehajtási napló

A táblázat WP-nként frissül, amint egy WP elkészült (PR + merge után).
Jelmagyarázat: ⬜ nincs elkezdve · 🔄 folyamatban · ✅ kész (mergelve) · ⏸ jóváhagyásra vár.

| WP | Státusz | PR | Megjegyzés |
|---|---|---|---|
| WP-0.0 harness | ✅ | [#58](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/58) | Pillanatkép-alapú teszt-DB (a legacy lánc friss DB-n törik); route-teszteknél cleanup-minta a rollback helyett — dokumentálva |
| WP-0.1 skip felszabadítás | ✅ | [#61](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/61) | Review-javítás: work_phase_id-elsődleges párosítás (testvér-fázis foglalását nem bántja) + FOR UPDATE |
| WP-0.2 intent-lejáratás + horgony | ✅ | [#60](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/60) | #10-nél a skip-ági horgony-változat került be (az első intent padlója marad `now`) |
| WP-0.3 audit-tombstone (084) | ✅ | [#63](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/63) | Közös `insertWorkPhaseAudit` helper; review-javítás: nemlétező fázisnál NULL id-s tombstone |
| WP-0.4 slot_intent_id (085) | ✅ | [#65](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/65) | Link-nullázás minden lejáratási ágon + 085 partiális index; review 2 elő-létező hézagot talált → WP-0.8 kiegészítés |
| WP-0.5 reorder SAVEPOINT | ✅ | [#62](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/62) | Review-javítás: epizód-státusz kapu a tranzakción belül (FOR SHARE) |
| WP-0.6 köteg EWP-link | ✅ | [#64](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/64) | Konverzió tranzakción belül írja az EWP appointment_id/status-t |
| WP-0.7 GET + tombstone (086) | ✅ | [#66](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/66) | GET route + roleHandler a generate-en; tombstone KÜLÖN táblával (nem deleted_at — indoklás a PR-ban); review 2 majorja javítva perzisztens őrökkel, piros-ellenőrzéssel |
| WP-0.8 kis javítások (#08/#09/#11/#13) | ✅ | [#68](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/68) | + a 3 release-hézag (Mégsem kész ág, betegportál-lemondás, hold-lejárat); review-javítás: flag-olvasás tranzakción kívül, index-hű #08 szonda, #13 sorrend-őr. **Ezzel a FÁZIS 0 teljes.** |
| WP-0.9 pinning-teszt | ✅ | [#59](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/59) | A 029+059 együttes (hatályos) állapotot pinneli; index-őr regexek toleránsak |
| WP-1.1 validáció-zajcsökkentés | ✅ | [#70](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/70) | Warningok kivezetve, errors|approved|ready modell; mellékjavítás: a batch route alias-hibája (42P01) miatt a Gantt-badge eddig némán 500-azott |
| WP-1.2 integritás kivezetés | ✅ | [#74](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/74) | Banner ki; auto-repair zárolt+guardolt (review: reprodukált verseny és flip-flop javítva); multi-link nem-javítható violation; admin-only scan; `integrity_repair` change_type. **Ezzel a FÁZIS 1 teljes.** |
| WP-1.3 lánc-banner szöveg | ✅ | [#67](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/67) | Mindhárom előfordulás (terv-kártya, worklist-widget, ChainBookingCallout) ajánlattá fogalmazva, amber→kék |
| WP-1.4 feltételes időpont egy kártya | ✅ | [#69](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/69) | Új ConditionalAppointmentOffers komponens; jegyzet: az e-mail-hiányos küldés-gomb disabled marad (technikai előfeltétel, nem klinikai kapu); 2 örökölt hiba külön feladat-chipben (LIMIT 50 csonkolás, halott AppointmentBooking.tsx) |
| WP-2.1 terv-mutáció audit (087) | ✅ | [#71](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/71) | change_type oszlop; minden mutáció naplóz (create/delete/reorder/merge/unmerge/timing/template_apply/template_remove); review-javítás: addPathway + create-episode auditja, reorder tiebreaker |
| WP-2.2 napló endpoint + UI | ✅ | [#75](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/75) | GET plan-history (lapozható, changed_by-feloldás, tombstone-olvasható) + lecsukott „A terv változásai (N)" idővonal; review-javítás: lapozás-dedupe, egy-pillanatképes count. **Ezzel a FÁZIS 2 teljes — minden jóváhagyott WP kész.** |
| WP-3.1 recall séma (088) | ✅ | [#72](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/72) | CHECK feloldva, source/label/created_by, epizód-szintű recall_risk_level; deploy-kötés: a 088 a kód ELŐTT fusson (kétirányú törés) |
| WP-3.2 recall szolgáltatásréteg | ✅ | [#72](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/72) | Pure kadencia-katalógus (számok a #76-ban jóváhagyva); horgony = utolsó teljesült kezelés/kontroll; a STAGE_6 kapu a #76-ban lazítva; kézi sorokat az auto sosem írja felül |
| WP-3.3 Gondozás kártya | ✅ | [#73](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/73) | Rizikó-választó + egy időrendi lista + kézi felvétel + törlés-AJÁNLAT (új, őrzött DELETE végpont); A kadencia-számok a #76-ban jóváhagyva; az élesítés az orvos per-epizód rizikó-választásán múlik. **Ezzel a FÁZIS 3 teljes.** |
| D1+D2 recall-döntések | ✅ | [#76](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/76) | Kadencia-számok jóváhagyva; STAGE_6 kapu lazítva (horgony: utolsó teljesült kezelés, átadás előtt is) |
| WP-4.1a vizit-séma (089) | ✅ | [#77](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/77) | episode_visits + visit_id/jaw/fog-kapcsolótábla + újrafuttatható backfill; review-javítás: láncolt merge-csoport (ciklusos backfill, lánc-lapítás a merge-ben, árva-vizit takarítás) |
| WP-4.1b step_code→work_phase_id identitás | ✅ | [#78](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/78) | Minden identitás-út wp-elsődleges (legacy fallback); review: CRITICAL param-kötési hiba a prereq-ágon javítva; mellékjavítás: a worklist „korábbi próbák" lekérdezés eddig némán elhasalt (ats.end_time) |
| WP-4.2 vizit API + forecast | ✅ | [#79](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/79) | Vizit CRUD + PATCH visitId/jaw/teeth + vizit-tudatos forecast (kompat-invariáns fuzz-igazolva) + wp-tudatos projektor; review: 4 major javítva (kombinált body, csoport-mozgatás, reorder=EWP-átszámozás, scoped backfill), 1 medium cáfolva (advisory lock) |
| WP-4.3 vizit-kártyás UI | ✅ | [#80](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/80) | Alkalom-kártyák + kockák (hatókör-badge), drag-drop + teljes nem-drag alternatíva, „Feltöltés sablonból"; élőben ellenőrizve; review-major (visit-move seq-átszámozás) javítva. **Ezzel a FÁZIS 4 és a TELJES TERV kész.** |
| WP-6.3 „Az időpontfoglalás a váz" — alkalom-tulajdonú időpont, üres alkalom megmarad (2026-09-02) | ✅ | `c5192fd` (main) | 094: `episode_visits.appointment_id`; a tartalom mozgatása nem viszi az időpontot (a fázis várakozó lesz, a következő tag promótálódik); üres alkalom soha nem tűnik el automatikusan; alkalom nélküli foglalt időpontok sávja + hozzárendelés/leválasztás (attach/detach); foglalt alkalmak időrendben pinnelve; a tervezett alkalom a következő fix pont elé szorul (lánc + projektor plafon); a blokk hossza olvasáskor számolt. 5 új integrációs + 3 komponens + 3 lánc-teszt. |
| WP-6.2 Felelős orvos az epizódon, a sablontól leválasztva (2026-09-02) | ✅ | `1ba6d99` (main) | Feltűnő chip a terv-kártya fejlécében (EpisodeProviderControl): orvos-választó, indok, lekapcsolás, váltás-történet; a sablon-szerkesztőből kikerült; PATCH /episodes/:id írja a `provider_assignment_events` naplót (092: lekapcsolás is), GET provider-history; a váltás előre hat (intentek lejárnak, új foglalás az új orvoshoz). 8 komponens- + 3 integrációs teszt. **Utójavítás (mobil élő ellenőrzés):** 093 — a napló-tábla és DEFAULT partíciója garantálva, a napló-sor SAVEPOINT-on belül (hiányzó tábla nem buktatja a váltást); a chip popovere viewport-őrrel; a toast a műveletet nevezi meg + correlationId. |
| WP-6.1 Puzzle v2 — kéthasábos tábla (2026-09-02) | ✅ | `fb52424` (main) | Bal paletta (091 generikus katalógus: csonkpreparálás, precíziós-szituációs lenyomatvétel, átadás, …) + jobb alkalom-sorok kockákkal; vizitköz alap 7 nap, egy kattintással állítható; fázis-szintű offset kivezetve a UI-ból; optimista mutációk, kaszkád-újratöltés csak státusz-változásnál; POST work-phases `visitId` (egy kérés); merged gyerek leválik áthelyezésnél; vizit-szintű foglalás `prepare-booking`-gal; vizit-tudatos projektor. 13 komponens-, 5+29 helper-, 8 integrációs teszt. |

---

## 0. Mit kell tudni, mielőtt bármihez hozzáérsz

### 0.1 A feladat eredete

A gyakorló orvos (a rendszer egyetlen fő felhasználója és megrendelője) öt konkrét kifogást
emelt a `/patients/[id]/stages` oldal ellen:

1. A „Feltételes időpontválasztás" és a „Jóváhagyásra váró időpontok" összefüggnek, mégis
   külön blokkok.
2. A kezelési terv sablonokat el akarja hagyni: minden eset más, főleg ha egy munkafázisra
   több alkalom kell, vagy ha munkafázisokat összevonna. Helyette **interaktív, puzzle-szerű
   felület**, ahol egy betegvizit-alkalomra be lehet dobálni kezeléseket, amiket fog(ak)hoz
   vagy állcsont(ok)hoz rendelünk.
3. A recall nem működik jól: a **rövid távú** (egy-, két-, háromhetes) és a **hosszú távú**
   (féléves, éves) visszarendeléseket **együtt** kellene kezelni, orvosi belátással, főszabály
   szerint rizikócsoport-függő szoros vagy lazább kontrollal.
4. Az integritás-figyelmeztetések zavaróak, a működésük átláthatatlan.
5. A „konzultáció hiányzik a tervből" figyelmeztetés felesleges.

### 0.2 Nem tárgyalható megkötések

- **Blokkoló kapu tabu.** 2026-08-13-án a felhasználó kérésére eltávolítottuk a klinikai
  adatteljességi kaput. A rendszer **nem tiltja meg** az orvosnak, hogy dolgozzon: nudge,
  ajánlat, figyelmeztetés igen — `disabled` gomb és „kötelező lépés" nyelvezet nem.
  Ez a terv több WP-je pont ilyen szöveg átírása; ne vezess be újat.
- **Magyar domain-nyelv.** Tábla-, oszlop-, enum- és UI-nevek magyarok, az angol keveredik
  bele. Ne „fordíts" azonosítót (`fogpótlástanász`, `beutalo_orvos`, `episode_work_phases`).
- **Nincs `next dev`.** `npm run dev` (custom `server.ts` a Socket.io miatt).
- **Séma-változás csak `database/migrations/`-ba**, `npm run migrate:create <név>`-vel
  létrehozva. A legfrissebb tracked migráció ma **083**; a terv 084-től számoz.
- **Sötét mód kötelező** minden új UI-elemre (`globals.css` komponens-réteg konvenciója).
- Minden WP végén: `npm run test` és `npm run typecheck` zöld. Ez ma 600+ teszt.

### 0.3 A kód mai állapota, amit félreértenél

- **A kezelési terv igazsága az `episode_work_phases` (EWP) sorok halmaza**,
  `COALESCE(seq, pathway_order_index)` sorrendben. A `care_pathways.work_phases_json` csak
  sablon-mag.
- **A terv-kártyának nincs GET endpointja**: a `loadSteps()` egy *mutáló*
  `POST .../work-phases/generate`-tel olvas (`components/EpisodeStepsManager.tsx:897`).
  A kártya megnyitása írhat a DB-be. Ez a 0.7-es WP tárgya, és több hiba gyökere.
- **`episode_work_phase_audit`** (018-as migráció) az epizód-terv naplója. A
  `care_pathway_change_events` **NEM** ez — az sablon-szintű (`pathway_id` FK), a
  változásnaplóhoz nem használható.
- **A recall ma két külön világ:** a hosszú táv az `episode_tasks`-ban
  (`recall_interval_days` **`CHECK (... IN (180, 365))`**, kizárólag STAGE_6 eseményre
  generálva); a rövid táv sehol — a 075-ös migráció minden `control` lépést kivett a
  sablonokból.
- **A `kontroll_1..3` fázisok szándékosan `work` poolba foglalnak**
  (`lib/next-step-engine.ts:80` `isFirstThreeControlStep`). Nem bug, ne „javítsd".
- **A tesztek nagy része source-regex jellegű**: a route fájl *szövegében* keres SQL-t vagy
  kommentet, nem futtatja a kódot. Ezért volt 86/86 zöld 13 élő hiba mellett. Az e tervben
  előírt tesztek közül azok, amiknél „viselkedési teszt" szerepel, **nem** lehetnek regex-esek.

### 0.4 A 13 auditált hiba

2026-08-20-i többagentes kódaudit, `288f945` commit. Riport:
<https://claude.ai/code/artifact/a8b3bd66-ef99-42ef-9376-f3cd47da5542>
**2026-08-27-én ellenőrizve: egyik sincs javítva** (az attempt-outcome route-ban 0
`slot_intents` hivatkozás, a reorderben 0 `SAVEPOINT`, a 018-as FK `ON DELETE CASCADE`).
A terv Fázis 0-ja ezek közül azokat javítja, amelyek nélkül az új UI hazug adatra épülne.

---

## 1. A terv szerkezete

Hat fázis, mindegyik után **le lehet állni**: a rendszer működőképes és jobb állapotban van,
mint előtte. A fázisokon belüli WP-k párhuzamosíthatók, kivéve ahol függőség szerepel.

| Fázis | Cím | Miért itt | Kb. ráfordítás |
|---|---|---|---|
| 0 | Előfeltétel-javítások | Az új UI hazug adatra épülne | 4–6 nap |
| 1 | Zajcsökkentés | A felhasználó 1., 4., 5. pontja; olcsó, azonnal érezhető | 2–3 nap |
| 2 | Változásnapló | A felhasználó külön kiemelte; a szabad terv előfeltétele | 1–2 nap |
| 3 | Gondozás (recall) | A felhasználó 3. pontja; önálló, jól körülhatárolt | 3–4 nap |
| 4 | Vizit-alapú terv (puzzle) | A felhasználó 2. pontja; a nagy falat | 8–12 nap |
| 5 | Integrációs tesztréteg | Cross-cutting; a 0. fázissal együtt kezdődik | 2 nap |

**Ajánlott megállási pont, ha korlátos a kapacitás:** a 2. fázis vége. Onnan a 3. (recall)
önállóan is értékes, a 4. (puzzle) pedig külön döntést érdemel.

---

## FÁZIS 0 — Előfeltétel-javítások

Cél: a terv/foglalás réteg ne mondjon ellent önmagának. **UI-változás ebben a fázisban
nincs**, kivéve a megerősítő dialógusok szövegét, ahol a javítás új mellékhatást vezet be.

### WP-0.0 — Integrációs tesztharness (a 0. fázis első lépése)

**Függőség:** nincs. **Ezt kell először megcsinálni**, mert a többi WP elfogadási kritériuma
erre épül.

- Új, CI-ben flaggelt vitest projekt eldobható Postgres DB-vel (`vitest.integration.config.ts`),
  `npm run test:integration` scripttel. A meglévő `npm run test` maradjon érintetlen és gyors.
- A DB-t séma-fájlból építsd: `database/schema.sql` → a `database/README.md`-ben felsorolt
  kulcs-legacy migrációk → `npm run migrate`. Ha ez túl törékeny, egy `pg_dump --schema-only`
  pillanatkép a dev DB-ről is elfogadható, `scripts/sim/`-hez hasonló elrendezésben — de akkor
  írj mellé egy frissítő scriptet, és dokumentáld, hogy migráció után újra kell generálni.
- Minden teszt saját tranzakcióban fusson és `ROLLBACK`-kel záruljon.
- Adj egy `docs/INTEGRATION_TESTS.md`-t: hogyan indul lokálisan, hogyan CI-ben, mikor kell
  frissíteni a sémát.

**Elfogadás:** `npm run test:integration` lokálisan zöld egy legalább 1 tesztes suite-tal
(pl. „egy EWP sor létrehozható és lekérdezhető"), `npm run test` futásideje nem nőtt.

---

### WP-0.1 — `scheduled → skipped` szabadítsa fel a foglalást (audit #02)

**Súly:** high — az egyetlen közvetlen beteghatású hiba. **Függőség:** WP-0.0.
**Fájl:** `app/api/episodes/[id]/work-phases/[workPhaseId]/route.ts:274` (az `else` ág),
`components/EpisodeStepsManager.tsx` (megerősítő panel).

**Ma:** az átmenet engedélyezett (`scheduled: ['skipped','completed']`), de az ág csak az
EWP-t és az auditot írja. Nem mondja le az aktív appointmentet, nem szabadítja fel a slotot,
nem járatja le az intenteket, az `appointment_id`-t sem nullázza. A beteg megjelenik egy
kihúzott lépésre; a `skipped` sor az összecsukott renderágra esik, így a lemondás-gombok
eltűnnek; a `convert-slot-intent` pedig `STEP_ALREADY_DONE`-nal utasítja el az újrafoglalást.

**Csináld:**
1. A `newStatus === 'skipped'` ágban, még COMMIT előtt, futtasd le ugyanazt a felszabadítást,
   amit a `completed → pending` ág (ugyanennek a fájlnak a ~225–260. sorai) — appointment
   lemondás `cancelled_by_doctor`-ra, slot `state='free', status='available'`, `slot_intents`
   `state='expired'`.
2. **Fontos szűkítés:** csak a jövőbeli aktív appointmentekre (`a.start_time >
   CURRENT_TIMESTAMP`). Vak `releaseWorkPhasesForDelete` **nem jó**: a skip legitim retro-
   használata lemondaná a már megtörtént vizitet.
3. Nullázd az `episode_work_phases.appointment_id`-t a skip ágon.
4. A `skipped → pending` visszaút is tisztítsa az `appointment_id`-t.
5. A megerősítő panel írja ki, hány jövőbeli időpontot fog lemondani — a törlés-panel már
   így viselkedik, másold a nyelvezetét. Ne blokkolj, csak tájékoztass.
6. Post-commit `projectRemainingSteps(episodeId)` (a `completed → pending` ág mintájára).

**Teszt (viselkedési, `__tests__/integration/work-phase-skip-releases-booking.test.ts`):**
jövőbeli foglalással bíró `scheduled` fázis skip-elése után: appointment `cancelled_by_doctor`,
slot `free`, EWP `appointment_id IS NULL`, intent `expired`. Külön eset: **múltbeli**
appointment skip-nél érintetlen marad.

---

### WP-0.2 — `mark_unsuccessful` intent-lejáratás + vezető kihagyás horgonya (audit #04 + #10)

**Súly:** high. **Függőség:** WP-0.0. Együtt javítandó, ugyanaz a hiba-alak.
**Fájl:** `app/api/appointments/[id]/attempt-outcome/route.ts:375`,
`app/api/episodes/[id]/convert-all-intents/route.ts:176`.

**Ma (#04):** az attempt-outcome route soha nem nyúl a `slot_intents`-hez (ma is 0 találat a
fájlban), csak post-commit `projectRemainingSteps`-et hív. A projektor viszont nem tud
`converted` sort újranyitni (`WHERE state IN ('open','expired')`), második sor pedig nem
lehet (`uq_slot_intents_episode_step_seq`). Minden testvér-út lejáratja — csak ez nem.
Következmény: torzult lenyomat után a köteg a *harapásregisztrációval* kezd, a kimaradt
lenyomat még `skipped[]` bejegyzést sem kap.

**Ma (#10):** a kihagyás-kompenzáció `if (prevActualStart && chainMinStartTime)` alatt van,
így ha a lista **első** intentje kimarad, a horgony-előretolás elmarad, és a 2. intent
egyetlen padlója a `now`.

**Csináld:**
1. `attempt-outcome` route-ban, a `mark_unsuccessful` ágon, **COMMIT előtt**:
   ```sql
   UPDATE slot_intents si SET state = 'expired'
     FROM appointments a
    WHERE a.id = $1 AND a.slot_intent_id = si.id AND si.state = 'converted'
   ```
   A már meglévő post-commit `projectRemainingSteps` visszanyitja.
2. `convert-all-intents`-ben: a horgony akkor is induljon, ha még nincs sikeres előző —
   `prevActualStart ??= now` a ciklus előtt, vagy skip esetén
   `prevActualStart = chainMinStartTime ?? new Date()`.

**Teszt:** viselkedési, integrációs. (a) `mark_unsuccessful` után az intent `expired`, majd a
projektor `open`-re nyitja. (b) Ha a köteg 1. intentje `skipped`, a 2. intent alsó korlátja
nem a `now`. A meglévő `__tests__/api/convert-all-intents-chain.test.ts:82` regex-tesztet
**hagyd meg**, de ne arra hivatkozz elfogadásként.

---

### WP-0.3 — A munkafázis-audit ne törlődjön (audit #12) — a változásnapló előfeltétele

**Súly:** medium, de a 2. fázis nem indulhat nélküle. **Függőség:** WP-0.0.
**Fájl:** `database/migrations/018_episode_work_phase_audit.sql` → új **084** migráció;
`lib/work-phase-delete.ts`, `app/api/episodes/[id]/route.ts:421` (pathway force-eltávolítás).

**Ma:** a DELETE beszúr egy `new_status='deleted'` audit sort, majd ugyanabban a
tranzakcióban törli a fázist — az `episode_work_phase_audit.episode_work_phase_id` FK
`ON DELETE CASCADE`, így a friss sor és a fázis egész előzménye eltűnik. Reprodukálva:
3 sor → INSERT után 4 → DELETE után **0**, még commit előtt. A `handleRemovePathway` force
ága N fázist töröl audit írás nélkül. Feltűnő: az `episode_work_phases`-ra mutató minden más
FK `ON DELETE SET NULL` — az audit az egyetlen CASCADE.

**Csináld (084-es migráció):**
1. `episode_work_phase_id` legyen nullable, az FK `ON DELETE SET NULL`. Az `episode_id` marad
   a kapaszkodó (az ő CASCADE-je helyes: epizód törlésekor az audit is mehet).
2. Denormalizált snapshot oszlopok: `work_phase_code`, `custom_label`, `pool`,
   `duration_minutes`. Törléskor ezek nélkül a sor olvashatatlan.
3. Backfill a meglévő sorokra az élő EWP-kből (ahol még létezik a fázis).
4. Kódoldal: minden audit INSERT töltse ki a snapshot oszlopokat.
5. A pathway force-eltávolítás írjon **fázisonkénti** audit sort (`new_status='deleted'`,
   `reason` = a force-eltávolítás oka).

**Teszt:** integrációs — fázis törlése után az audit sor megmarad `episode_work_phase_id IS
NULL`-lal és kitöltött `work_phase_code`-dal; sablon force-eltávolítás N fázisra N audit sort ír.

---

### WP-0.4 — `slot_intent_id` link/index rendbetétele (audit #03)

**Súly:** high — napi működést blokkol. **Függőség:** WP-0.0.
**Fájl:** `lib/convert-slot-intent.ts:474`,
`database/legacy/migration_intent_appointment_link.sql:12` → új **085** migráció.

**Ma:** a konverzió mindig kiírja az `appointments.slot_intent_id`-t, és **semmi nem nullázza
soha** (a repóban nincs `slot_intent_id = NULL` írás). Az `idx_appointments_unique_slot_intent`
státusz-predikátum nélküli, tehát a halott (lemondott / no-show) sor örökre birtokolja az
intentet. A cancel/no-show `expired`-re állít, a projektor `open`-re nyit vissza ugyanazzal az
id-vel → a következő konverzió **más slotra** 23505-tel hasal, amit `INTENT_ALREADY_CONVERTED`
409-cé fordítunk.

**Pontos hatókör (ne írd túl):** az `INSERT … ON CONFLICT (time_slot_id) DO UPDATE` arbitere
csak a `time_slot_id`. Ha a beteg **ugyanarra** a slotra kerül vissza, a revive ág frissíti a
régi sort, ütközés nélkül. **Csak a másik slotra** történő újrafoglalás dől el — ami a no-show
utáni normál eset.

**Csináld — a kisebb kockázatú utat válaszd:** `slot_intent_id = NULL` a cancel/no-show ágon,
ott, ahol az intent lejáratása már megtörténik. **Emellé** partiális index (085-ös migráció),
ami kizárja a halott státuszokat — a kettő együtt véd a régi adatra is.

**Teszt:** integrációs — foglalás intenten át → no-show → **másik** slotra újrafoglalás
sikerül. Regressziós eset: ugyanarra a slotra visszafoglalás továbbra is működik.

---

### WP-0.5 — Reorder SAVEPOINT + swap-ütközés (audit #05)

**Súly:** high. **Függőség:** WP-0.0.
**Fájl:** `app/api/episodes/[id]/work-phases/reorder/route.ts:93`, `:143`.

**Ma:** a `shiftAppointmentsAfterReorder` egy „non-fatal" feliratú `try/catch`-ben van a
`BEGIN … COMMIT` **belsejében**. Postgresben egy hibás statement abortálja a tranzakciót; a
COMMIT ekkor nem dob, hanem `ROLLBACK` command taggel tér vissza — a `seq`-átírások is
elvesznek, a külső catch soha nem fut, a válasz a rendezés **előtti** sorokkal 200-at ad.
Két determinisztikus kiváltó: (a) az `UPDATE slot_intents SET step_code, step_seq` ütközik a
`uq_slot_intents_episode_step_seq`-cel; (b) két jövőbeli pending appointment cseréje sérti az
`idx_appointments_unique_pending_step`-et (klasszikus swap-temp-nélkül probléma).

**Csináld:**
1. A shiftet `SAVEPOINT`-tal vedd körbe — a minta megvan: `withSavepoint`,
   `lib/slot-intent-projector.ts:42`.
2. A swap-ütközést kétfázisú update-tel oldd meg (temp sentinel `step_seq`, pl. negatív
   tartomány), külön a `slot_intents`-re és az `appointments`-re.
3. A nem-fatális kimenetet **jelezd a kliensnek** (a válaszban `partial: true` + üzenet), és
   a UI mutasson toastot — ma a toast csak `!res.ok`-nál jelenik meg.
4. Adj epizód-státusz kaput (`patient_episodes.status = 'open'`), ma nincs.
5. Ne kösse át az időpontot összevont (rejtett) al-fázisra (`:143`).

**Teszt:** integrációs — két **lefoglalt** munkafázis drag-drop cseréje ténylegesen
megcserélődik és nem ad néma 200-at; intenttel és intent nélkül is.

---

### WP-0.6 — A kötegelt konverzió kösse az időpontot az EWP sorhoz (audit #06)

**Súly:** medium-high. **Függőség:** WP-0.0.
**Fájl:** `lib/convert-slot-intent.ts:604`, minta: `lib/appointment-service.ts:581`.

**Ma:** a tranzakció végén csak az intent áll `converted`-re; az
`episode_work_phases.status='scheduled'` / `appointment_id` nincs írva — szemben a soronkénti
úttal. Következmény: a worklist BOOKED-ot mutat (az `appointments`-ből), a terv-kártya
ugyanazokat a sorokat „Várakozik" chippel és becsült ablakkal. Ha az orvos ezután
„Elhagyom"-ot választ, elmarad a figyelmeztetés (a UI a `status === 'scheduled'`-re kapuzza),
a törlés viszont `work_phase_id` alapján mégis lemondja a beteg időpontját.

**Csináld:** ugyanabban a tranzakcióban tükrözd a `lib/appointment-service.ts:581` blokkot:
előbb nullázz bármely más EWP hivatkozást erre az appointmentre, majd `appointment_id` +
`status = CASE WHEN status IN ('pending','scheduled') THEN 'scheduled' ELSE status END`.
Érinti a `POST /api/slot-intents/:id/convert`-et is.

**Teszt:** integrációs — köteg után mindhárom fázis `scheduled`, `appointment_id` kitöltve.

---

### WP-0.7 — Olvasás/írás szétválasztása + törlés-tombstone (audit #01 + #07)

**Súly:** high, és **a 4. fázis kemény előfeltétele**. **Függőség:** WP-0.0, WP-0.3.
**Fájl:** `lib/generate-episode-work-phases.ts:53`, `:85`, `:141`;
`components/EpisodeStepsManager.tsx:897`; új GET route; új **086** migráció.

**Ma (#01):** a generate idempotencia-őre „létezik-e most sor" kérdés, tombstone nélkül; a
fog-szinkron minden `episode_linked` `tooth_treatments` sort visszatesz, amihez nincs fázis —
a törlés viszont a `tooth_treatments.status`-hoz hozzá sem nyúl. Mivel az olvasás maga a
`POST .../generate`, a törölt sor a következő mountnál visszakerül. Élő DB-n reprodukálva:
`completed` fázisok törlése után `totalGenerated: 3`, mindhárom `pending`, `completed_at=NULL`.

**Ma (#07):** a 006-os migráció DROP-olta a 2-oszlopos unique constraintet és 3-elemű
kifejezés-indexre cserélte (`COALESCE(jaw,'_none_')`), így az `ON CONFLICT (episode_id,
care_pathway_id)` arbiter-inferencia semmit nem talál → 42P10 → a csupasz catch a
`'__legacy__'` fallbackra visz. Következmény: a sablon vagy kétszer szúródik be (duplikált
terv, duplikált intentek), vagy sosem generálódik le.

**Csináld:**
1. **Új `GET /api/episodes/:id/work-phases`** a terv-kártyához. A `generate` maradjon explicit,
   írásra szánt művelet. A `EpisodeStepsManager.loadSteps()` erre álljon át.
2. **Jogosultság:** a generate route ma `authedHandler`-rel van becsomagolva — szemben minden
   testvérével —, tehát technikus is generálhat bármely epizódra. Állítsd
   `roleHandler(['admin','beutalo_orvos','fogpótlástanász'])`-ra. A GET maradhat `authedHandler`.
3. **Tombstone (086):** `deleted_at TIMESTAMPTZ` az `episode_work_phases`-en (vagy opt-out
   tábla, ha tisztább). A `:85`-ös őr és a `:141`-es missing query is nézze.
4. A fog-fázis törlése minimum állítsa át a `tooth_treatments.status`-t, hogy a fog-szinkron
   ne tegye vissza.
5. Az `ON CONFLICT` arbitert igazítsd a valós indexhez, **vagy** hagyd el (ez az ág csak
   `epPathways.length === 0`-nál fut) és fogd el a 23505-öt. A catch csak `42P01`-re essen a
   `__legacy__` ágra; a `__legacy__` őr `IS NULL` predikátuma amúgy is túl széles.

**Teszt:** integrációs — (a) törölt fázis a következő `GET` után **nem** jön vissza;
(b) ugyanaz `generate` explicit hívása után sem; (c) sablon kétszeri alkalmazása nem
duplikálja a tervet; (d) ha az epizódon van ad-hoc (NULL-source) sor, a sablon fázisai
**legenerálódnak**.

---

### WP-0.8 — Kis ráfordítású javítások (audit #08, #09, #11, #13)

**Függőség:** WP-0.0. Egy WP-ben, de külön committal mindegyik.

- **#08** (`attempt-outcome/route.ts:171`) — a „Visszavonás" determinisztikus 409-et ad, ha a
  következő próba már le van foglalva. Futtasd le a meglévő `hasOtherActive` szondát (lehetőleg
  `work_phase_id` szerint), adj típusos 409-et (`RETRY_ALREADY_BOOKED`) a blokkoló appointment
  id-jével, ahogy a reassign-step route már teszi. Kösd be a `translateUniqueViolation`-t.
  Javítsd a `RevertUnsuccessfulModal.tsx:124` szövegét, ami ma azt állítja, ez az eset kezelt.
- **#09** (`convert-slot-intent.ts:618`) — a kimerült retry `throw`-ol, a `return { status: 503 }`
  halott kód, és a köteg 500-nál eltitkolja a már COMMIT-olt foglalásokat. Essen a 503-as ágra;
  a batch loopban `try/catch` írja `skipped[]`-be a dobott hibát; a kliens `!res.ok` esetén is
  frissítsen.
- **#11** (`convert-slot-intent.ts:377, :422, :565`) — nyitott tranzakcióban kér új
  pool-kapcsolatot, `DB_POOL_MAX=5` mellett kiéhezteti a poolt. Add át a `client`-et a
  szondának (`probeAppointmentsWorkPhaseIdColumn(client)`), a risk-settings számítást emeld a
  `pool.connect()` elé, a self-heal `pool.query`-t a `client.release()` utánra.
- **#13** (`lib/work-phase-delete.ts:54`) — a `slot_intents` expiry fusson a foglalás-scan
  **előtt**, vagy futtasd újra a lemondást az intent-UPDATE után. `FOR UPDATE` hozzáadása nem
  elég (a sor a SELECT pillanatában nincs a találati halmazban).

**Teszt:** #08-ra és #09-re viselkedési teszt; #11 és #13 kódszintű + a meglévő suite zöld.

**Kiegészítés (a WP-0.4 review-jából, 2026-08-27):** három elő-létező, azonos alakú
hézag került elő, amelyeket ez a WP zár be (mind: a lemondott appointmenthez kötött
`converted` intent lejáratása + `appointments.slot_intent_id = NULL`, a skip-ág mintájára):
- a `completed → pending` („Mégsem kész") ág a work-phases/[workPhaseId] route-ban —
  itt az appointment-párosítást is `work_phase_id`-elsődlegesre kell állítani
  (csupasz `step_code` duplikált fáziskódnál a testvér foglalását is lemondaná);
- a betegportál-lemondás (`app/api/patient-portal/appointments/[id]/route.ts`);
- a hold-lejárat (`lib/hold-expiry.ts`, `hold_expired` ág).

---

### WP-0.9 — Pinning-teszt javítása

`__tests__/lib/migration-029-attempts.test.ts:88` ma azt állítja, hogy a work-phase index nem
zárhatja ki a `no_show`-t — ez a **059-es migráció által javított** hibát kodifikálja. Átmegy,
mert csak a 029-es fájlt olvassa. Javítsd az assertiont a valós, hatályos állapotra.

---

## FÁZIS 1 — Zajcsökkentés

Cél: a felhasználó 1., 4. és 5. pontja. Kicsi, önálló, azonnal érezhető.

### WP-1.1 — Terv-validáció: warningok kivezetése (felh. 5. pont)

**Fájl:** `lib/treatment-plan-validation.ts`, `components/PlanReadinessBadge.tsx`,
`hooks/usePlanReadiness.ts`, `components/StagesGanttChart.tsx`,
`app/api/episodes/[id]/plan-validation/route.ts`, `app/api/episodes/plan-validation/batch/route.ts`.

**Csináld:**
1. Töröld a `MISSING_CONSULT` szabályt (`:110–118`). A felhasználó szerint konzultáció nem kell
   minden tervbe.
2. Töröld a `DUPLICATE_STEP` és a `CONTROL_BEFORE_WORK` warningokat is: mindkettő a 4. fázis
   modellje ellen dolgozik (ugyanaz a fázis többször = a kért „több alkalom"), és a
   kétállcsontos terv ma is hamis riasztást ad.
3. Az `EMPTY_PLAN` warning maradhat, de ne badge legyen, hanem a terv-kártya üres-állapota.
4. **Maradjon a két error:** `INVALID_POOL`, `INVALID_DURATION` — ezek nélkül tényleg nem
   lehet foglalni. `LONG_DURATION` maradhat, de csak a szerkesztő sorban, inline hintként.
5. A `summarizePlanReadiness` / `aggregatePlanReadiness` így gyakorlatilag `errors | approved |
   ready` lesz; egyszerűsítsd, és igazítsd a Gantt badge-t.

**Teszt:** `__tests__/lib/treatment-plan-validation.test.ts` frissítése — a törölt szabályok
**ne** termeljenek issue-t; a két error igen.

---

### WP-1.2 — Integritás-figyelmeztetések kivezetése a betegkartonról (felh. 4. pont)

**Fájl:** `components/EpisodeIntegrityBanner.tsx`, `components/EpisodeStepsManager.tsx:1495`,
`app/api/episodes/[id]/scheduling-integrity/route.ts`, új admin oldal.

**Ma:** a banner olyan címkéket rak a beteg kartonjára, hogy *„step_code eltér a hozzá kötött
munkafázistól"* és *„Stale foglalás-hivatkozás munkafázison"*. Ezek DB-konzisztencia-jelzések,
és többségük a Fázis 0-ban javított hibák tünete.

**Csináld:**
1. Vedd ki az `EpisodeIntegrityBanner`-t a terv-kártyából.
2. A **javítható** violationöket futtasd automatikusan szerveroldalon (a meglévő repair-út),
   idempotensen, és logold (Sentry breadcrumb + szerver log). Ne kérdezzen rá senkitől.
3. A maradékot mutasd egy **admin oldalon** (`/admin` új fül: „Ütemezési integritás"), ott
   maradhat a technikai nyelvezet, epizód/beteg linkkel.
4. A kartonon **csak** annak legyen nyoma, aminek klinikai jelentése van, és akkor a **soron**,
   nem bannerként: pl. `EWP_DANGLING_APPOINTMENT_LINK` → a sor melletti halk sor:
   „Ehhez a lépéshez már nincs élő időpont — foglaljon újat" + a meglévő foglalás gomb.
5. Ne vezess be új blokkoló állapotot.

**Teszt:** a meglévő `__tests__/api/scheduling-integrity.test.ts` maradjon zöld; új teszt az
auto-repair idempotenciájára.

---

### WP-1.3 — Lánc-foglalási banner átfogalmazása

**Fájl:** `components/EpisodeStepsManager.tsx:1521`.

**Ma:** „Teljes sorozat lefoglalása **kötelező lépés**" / „foglald le egyszerre a szükséges
időpontokat, ne csak az első lépést egyenként". Ez ugyanaz a minta, amit a klinikai kapunál a
felhasználó kérésére már egyszer kidobtunk.

**Csináld:** fogalmazd ajánlatnak. Pl. cím: „Több lépés is foglalható egyszerre";
törzs: „Az epizód következő N lépése egy menetben lefoglalható, a láncolást a rendszer
számolja."; gomb marad „Összes szükséges időpont lefoglalása". Semmi „kötelező", semmi tiltás.

---

### WP-1.4 — Feltételes időpont: három blokk egy kártyába (felh. 1. pont)

**Fájl:** `components/AppointmentBooking.tsx` (`mode === 'conditional'` ágak: `:1007` űrlap,
`:1226` várakozók, `:1322` elutasítottak), `components/ConditionalAppointmentBooking.tsx`,
`app/patients/[id]/stages/page.tsx:450`.

**Ma:** három külön `.card` egymás alatt ugyanarról a dologról, és beteg-scope-ban is
Beteg/Email/TAJ oszlopokkal listáz, pedig egy beteg kartonján állunk.

**Csináld:**
1. Egy kártya: **„Betegnek küldött időpont-ajánlatok"**. Fejlécében az „Új ajánlat küldése"
   gomb (a mai űrlap lecsukható panelben), alatta **egy** lista az ajánlatokról állapot-chippel:
   Várakozik / Elfogadva / Elutasítva.
2. Beteg-scope-ban (`propPatientId` megvan) a lista oszlopai: **időpont, kiküldve, állapot**.
   A Beteg/Email/TAJ oszlopok csak a globális (admin-lista) nézetben.
3. E-mail cím hiányát egy helyen jelezd, a kártya tetején.
4. Az admin-oldali globális nézet viselkedése ne változzon.
5. Ez jó alkalom az `AppointmentBooking.tsx` conditional ágának külön komponensbe emelésére
   (`components/ConditionalAppointmentOffers.tsx`) — a fájl ma ~1400 sor, két üzemmóddal.

---

## FÁZIS 2 — Változásnapló a kezelési terven

**Függőség:** WP-0.3 (enélkül a napló törli magát), WP-0.7 (enélkül a napló a visszaéledő
fázisokat is naplózza).

A felhasználó külön kiemelte: szabad szerkesztésnél előbb-utóbb jön a „ki vette ki ezt a
fázist" kérdés.

### WP-2.1 — Minden terv-mutáció írjon auditot

**Fájl:** `app/api/episodes/[id]/work-phases/**`, `lib/work-phase-delete.ts`.

Ma csak a státusz-váltás és a törlés ír (utóbbi el is vész). Egészítsd ki: **létrehozás**
(katalógusból / szabadszöveges / fogkezelésből), **törlés**, **átrendezés**,
**összevonás/felbontás**, **időzítés-módosítás**, **sablon alkalmazása/eltávolítása**.
Az `old_status`/`new_status` mellé kell egy `change_type` oszlop (087-es migráció) — a
státusz-váltás nem fedi ezeket.

Minden sor tartalmazza: ki (`changed_by`), mikor, mi (snapshot a WP-0.3-ból), miért (`reason`,
ahol van).

### WP-2.2 — Napló-endpoint és UI

- `GET /api/episodes/:id/plan-history` — időrendben csökkenő, lapozható.
- A terv-kártya alján **lecsukott** `<details>`: „A terv változásai (N)". Nyitva egyszerű
  idővonal: `2026-08-20 14:12 · Dr. Kiss Anna · elhagyta: Koronapróba (2 időpont lemondva)`.
- Ne legyen visszavonás-gomb ebben az iterációban — csak olvasható napló.

**Teszt:** integrációs — 6 különböző mutáció után 6 napló sor, helyes `change_type`-pal;
törölt fázis sora is olvasható marad.

---

## FÁZIS 3 — Gondozás: rövid és hosszú távú recall egy helyen (felh. 3. pont)

**Függőség:** Fázis 0 (a foglalási út javítása), egyébként önálló.

### WP-3.1 — Séma (088-as migráció)

**Ma:** `episode_tasks.recall_interval_days` **`CHECK (... IN (180, 365))`**
(`database/migrations/081_recall_workflow.sql:11`), a pár kizárólag a STAGE_6 eseményre jön
létre (`lib/recall-tasks.ts:29`), `RECALL_SCHEDULE_DAYS = [180, 365]`. Rövid távú
visszarendelésnek nincs helye — a 075-ös migráció a sablonokból is kivette a `control` lépéseket.

**Csináld:**
1. Oldd fel a `CHECK`-et: tetszőleges pozitív `recall_interval_days`. A
   `idx_episode_tasks_recall_interval_unique` így nem jó — cseréld
   `(episode_id, recall_interval_days)` helyett egy sor-szintű `id`-alapú modellre, vagy
   tartsd meg az unique-ot, de csak az **automatikusan generált** sorokra (partiális index
   `source = 'auto'`-ra).
2. Új oszlopok az `episode_tasks`-on: `source VARCHAR(10)` (`'auto' | 'manual'`),
   `label VARCHAR(200)` (pl. „2 hetes sebgyógyulási kontroll"), `created_by UUID`.
3. **Rizikócsoport:** `patient_episodes.recall_risk_level VARCHAR(10)`
   (`'low' | 'medium' | 'high'`), nullable. A beteg szintjén ne vezesd be — a felhasználó
   epizód-kontextusban gondolkodik, és a rizikó epizódonként eltérhet.
4. Backfill: a meglévő 180/365 sorok `source='auto'`, `label` generált.

### WP-3.2 — Szolgáltatásréteg

**Fájl:** `lib/recall-tasks.ts`, `lib/recall-task-lifecycle.ts`.

1. **Kadencia-katalógus** rizikószintenként, pure helperben (tesztelhető):
   - `low`: 180, 365 nap (a mai viselkedés)
   - `medium`: 90, 180, 365
   - `high`: 30, 90, 180, 365
   A konkrét számok **javaslatok** — a WP végén kérdezd meg a felhasználót, mielőtt élesítjük.
2. **Horgony:** ne csak a STAGE_6 esemény legyen. A recall induljon az epizód utolsó
   teljesült kezeléséhez/kontrolljához képest, hogy a rövid távú (1–3 hetes) visszarendelés
   fogalmilag beleférjen. A meglévő idempotens UPSERT logikát tartsd meg.
3. **Kézi sor hozzáadása:** `POST /api/episodes/:id/recall-tasks` tetszőleges nappal és
   címkével, `source='manual'`. A kézi sorokat az auto-generálás **soha ne írja felül**.
4. A rizikószint váltása ajánljon új sorokat, de **ne töröljön** kézit és ne mondjon le
   foglalást; a felesleges auto sorokat felajánlja törlésre.

### WP-3.3 — UI: „Gondozás" kártya

**Fájl:** `components/EpisodeRecallPanel.tsx` (átalakítás), `app/patients/[id]/stages/page.tsx`.

- A kártya címe **„Gondozás"**, alcím nélkül a „6 és 12 hónapos" megkötésre.
- Fejlécben a rizikócsoport-választó (Alacsony / Közepes / Magas) + egy mondat, hogy ez csak
  a **javasolt** kadenciát állítja.
- Egy lista, időrendben: rövid és hosszú távú sorok együtt, esedékesség szerint, lejárt sor
  kiemelve. Soronként: címke, esedékesség, állapot (Nincs foglalva / Foglalva dátummal /
  Teljesült), és „Foglalás" gomb.
- „+ Visszarendelés hozzáadása" — nap + címke.
- A kártya akkor is jelenjen meg, ha nincs sor (ma `tasks.length === 0`-nál `null`-ra
  renderel) — üres állapottal, hogy az orvos tudjon kézit felvenni.

**Teszt:** pure helper tesztje a kadenciára; integrációs a kézi sor + auto-generálás
együttélésére.

---

## FÁZIS 4 — Vizit-alapú kezelési terv („puzzle") (felh. 2. pont)

**Függőség:** WP-0.7 (kötelező), WP-0.5, WP-0.6, Fázis 2.
**Ez a fázis külön jóváhagyást igényel, mielőtt elkezdődik.**

### 4.0 A modell, amiben gondolkodunk

A felhasználó kérése: „egy betegvizit alkalomra be lehet dobálni kezeléseket, amiket fog(ak)hoz
vagy állcsont(ok)hoz rendelünk". Jó hír: ennek a nagy része **már létezik**, csak nem
vizitnek hívjuk.

- `episode_work_phases.tooth_treatment_id` + a „Fogkezelés" fül a lépés-hozzáadóban
  (`EpisodeStepsManager.tsx:1795`) → fog→kezelés kötés él.
- `merged_into_episode_work_phase_id` + `POST .../work-phases/merge` → **„több kezelés egy
  alkalomra" már működik**, csak checkbox-os „Összevonás" módnak hívjuk.
- Szabadszöveges lépés tetszőleges poollal és perccel; drag-drop átrendezés (`@dnd-kit` bent van).

**Hiányzik:** (a) állcsont-hatókör a munkafázison (`jaw` ma csak az `episode_pathways`-en van);
(b) több fog egy lépéshez (ma 1:1 `tooth_treatment_id`); (c) „N alkalom ugyanabból a fázisból";
(d) a vizit mint elsőrendű, nevesített objektum a UI-ban.

**Vagyis a puzzle ≈ a merge-csoport átnevezve „Alkalom"-má, fog/állcsont-hatókörrel és
ismétléssel.** Ne írj új tervmotort a semmiből.

### 4.1 Séma (089)

- `episode_work_phases.jaw VARCHAR(10)` (`'felso' | 'also' | 'mindketto'`), nullable.
- Fog-hatókör: `episode_work_phase_teeth (episode_work_phase_id, tooth_number)` kapcsolótábla
  a mai 1:1 `tooth_treatment_id` mellé (azt tartsd meg a visszafelé-kompatibilitásért).
- A merge-csoport kapjon identitást: vagy `episode_visits` tábla (`id, episode_id, seq, label,
  planned_duration_minutes`) és az EWP `visit_id` FK-ja, **vagy** maradjon a
  `merged_into_episode_work_phase_id`, és a „vizit" a primary sor. **Döntést igényel** —
  ajánlás: külön `episode_visits` tábla, mert a mai modellben a primary sor törlése a
  csoportot is viszi, és a vizitnek saját címkéje/hossza kell.
- **Ismétlés:** ne új oszlop legyen, hanem egyszerűen több EWP sor ugyanazzal a
  `work_phase_code`-dal. A `(episode_id, work_phase_code)` páron **nincs** unique — ez most
  előny. De: a `step_code` több helyen pszeudo-identitásként szolgál
  (`nextAttemptNumber`, `hasOtherActive`, worklist-prior-attempts) — ezeket át kell állítani
  `work_phase_id`-re, **különben az ismétlés eltöri a próba-számlálást**. Ez a fázis
  legkockázatosabb része; külön WP-t érdemel.

### 4.2 API

- `POST/PATCH/DELETE /api/episodes/:id/visits` — vizit CRUD.
- `PATCH /api/episodes/:id/work-phases/:id` bővítése `visitId`, `jaw`, `teeth[]` mezőkkel.
- A `merge`/`unmerge` route-ok maradjanak, de belül vizit-műveletre képezd le.
- **A forecast ne haljon meg:** a `default_days_offset` legyen **vizit-szintű** és
  szerkeszthető („ennyi nappal az előző alkalom után"). Enélkül a Gantt, a becsült befejezés
  és a kapacitástervezés némán elromlik.

### 4.3 UI

- A terv-kártya sorlistája helyett **alkalom-kártyák** függőleges sorban; egy kártya = egy
  vizit (dátum vagy becsült ablak, összidő, státusz-chip).
- A kártyába kezelés-„kockák" húzhatók: katalógusból, szabadszövegesen, vagy a beteg
  fogkezelési igényeiből. A kocka mutatja a hatókört (fog-számok vagy állcsont).
- Kockák **áthúzhatók** vizitek között; új vizit létrehozása üres területre ejtéssel.
- **Kötelező nem-drag alternatíva** minden műveletre (mobil + akadálymentesség): „Áthelyezés
  másik alkalomra" menü. A `@dnd-kit` mintát a pipeline board már használja.
- A sablon lekerül egy másodlagos gombra: **„Feltöltés sablonból"** — beszúrja a kockákat,
  utána a terv szabadon alakítható. Semmi automatikus újragenerálás (ezt a WP-0.7 biztosítja).

### 4.4 Migrációs út

Az élő epizódok terve nem törhet el. A meglévő EWP sorokból generálj vizit-hozzárendelést:
összevont csoport → egy vizit; magányos sor → egy egyfős vizit. Ez adat-backfill, írd meg
és próbáld ki eldobható DB-n (`scripts/sim/` harness mintájára), mielőtt élesbe megy.

---

## FÁZIS 6 — Puzzle v2: kéthasábos, „snappy" tervezés (2026-09-02)

**Eredet.** A felhasználó 2026-09-02-én: a `/stages` terv-formálás „kusza, lomha,
áttekinthetetlen". Kért: bal hasábban generikus kezelések (csonkpreparálás,
precíziós-szituációs lenyomatvétel, átadás, …), jobb oldalon vizitek, amikbe pakolni
lehet; a vizitek között alapból **1 hét**; a konkrét munkafázisnak **ne legyen
cooldown-ja**; nagyon gyors, hiperkönnyű felület.

### 6.1 Modell-döntések

- **A vizitköz az egyetlen időbeli távolság.** `episode_visits.days_offset` alap 7 nap
  (`lib/visit-plan-constants.ts` `DEFAULT_VISIT_GAP_DAYS`); a `POST /visits` és a
  `POST /work-phases` új alkalma is ezzel születik. A fázis `default_days_offset`-je csak
  legacy fallback (vizit nélküli sor); a UI-ból a „Nap offset" mező kikerült.
- **Vizit-tudatos projektor** (`lib/slot-intent-projector.ts` +
  `lib/slot-intent-projection-units.ts`): egy alkalom fázisai közös ablakot/javasolt
  kezdést kapnak, a horgony egyszer lép — ugyanaz a csoportosítás, mint a
  `computeVisitAwareWindowChain`-ben. Eddig a projektor soronként lépdelt (fázis-cooldown).
- **Generikus paletta a katalógusban** (091): `work_phase_catalog.palette_order`,
  `default_duration_minutes`, `default_pool`; 20 `gen_*` sor. `gen_atadas` szándékosan
  illeszkedik a stádium-motor `_atadas` mintáira; a sebészi sablon átadása `_atadasa`
  végű, hogy ne számítson protetikai átadásnak. A pathway-specifikus kódok maradnak,
  keresésből érhetők el (címkénként egyszer).
- **Egy alkalom = egy időpont.** A foglalás alkalom-szinten indul; ≥2 nyitott fázisnál a
  `POST /visits/:id/prepare-booking` a sorrendben első (vagy már foglalt) fázis alá vonja
  a többit (meglévő merge-mechanizmus), a primary perce a tagok összege (vagy a vizit
  `planned_duration_minutes`); idempotens. Az összevont gyerek áthelyezése előbb
  leválik a csoportról (a csoport nem hasad két vizitre).
- **Nincs új tervmotor**: az EWP-sorrend igazsága marad (`COALESCE(seq, poi)`), a
  meglévő alkalomba szúrt / áthelyezett sor az alkalom végére kerül — az optimista
  kliens ugyanezt rajzolja, így a visszatöltés nem ugráltat.

### 6.2 Kliens

`components/EpisodeStepsManager.tsx` (konténer) + `components/visit-plan/`:
`usePlanBoard.ts` (optimista állapot, `tmp…` id-k, hibánál visszaállás, vetítés
debounce-olva), `PhasePalette.tsx`, `VisitRow.tsx`, `VisitGap.tsx`, `PhasePill.tsx`,
`VisitBookingButton.tsx`, `Popover.tsx`. Törölve: `VisitCard`, `VisitPhaseTile`,
`MoveToVisitMenu`. A karton-szintű kaszkád (`onStepChanged`) csak státusz-változásnál fut;
rutin-műveletről nincs siker-toast; a kompozíciós hívások egy kérésesek.

### 6.2b Felelős orvos — az epizód elsőrendű tulajdonsága (WP-6.2)

A felhasználó 2026-09-02-én: a felelős orvos legyen feltűnőbb, váljon le a sablonról,
kötődjön az epizódhoz, de az epizód folyamán váltható maradjon.

- **Modell:** a felelős orvos eddig is az epizódon élt (`patient_episodes.assigned_provider_id`),
  de csak a sablon-szerkesztőben (EpisodePathwayEditor) volt állítható. Mostantól saját
  vezérlője van (`components/EpisodeProviderControl.tsx`) a terv-kártya fejlécében — a
  sablon-szerkesztő csak sablon. Nem kapu: hiányzó orvosnál borostyán nudge.
- **Váltás az epizód folyamán:** bármikor, indokkal; a váltás ELŐRE hat — a nyitott
  slot-intentek lejárnak (`invalidateIntentsForEpisode('provider_changed')`, meglévő), az új
  foglalások az új orvos naptárába mennek (a foglalási motor az epizód `assigned_provider_id`-jét
  nézi), a korábbi időpontok érintetlenek. A történet a `provider_assignment_events`
  táblába kerül (régi → új, indok, ki, mikor) — a tábla a legacy event-partitioning
  migrációval született, de eddig senki nem írt bele; a 092 a `new_user_id`-t nullable-re
  oldja, hogy a lekapcsolás is rögzülhessen. `GET /api/episodes/:id/provider-history`.
- **Kezelőorvos vs. felelős orvos:** a beteg-szintű kezelőorvos (fejléc-widget,
  adatteljesség-felelős, ragadós) külön fogalom marad; a felelős-orvos váltás után az
  ajánlat („legyen ő a kezelőorvos is?") a chipnél jelenik meg, ha a betegnek még nincs.
- **Nem épült:** vizitenkénti (alkalmankénti) orvos — a modell epizód-szintű maradt;
  ha kell, az `episode_visits` kaphat `provider_user_id` felülírást.
- **Mellékjavítás (élő ellenőrzés találta):** a `/stages` oldalon a terv-kártya és a
  gondozás-panel testvérként ugyanazt a `key={activeEpisode.id}`-t kapta (a régóta ismert
  „duplikált React key" feladat-chip) — a felelős-orvos váltás utáni újrarenderelésnél
  React árva kártya-példányokat hagyott a DOM-ban (4 terv-kártya, a régi nyitva ragadt
  popoverrel). Egyedi kulcsok (`plan-`, `recall-`, `stepper-` előtag) — a chip frissülése ezen
  múlt.
- **Utójavítás — mobil élő ellenőrzés (2026-09-02 16:53, iPhone) találta:**
  1. *A popover kilógott a képernyő bal szélén.* A chip a kártya bal oldalán ül, a panelje
     jobbra igazított és `w-80` (320px) széles — 390px-es képernyőn ~40px lelógott, a fejléc, a
     kereső és az indok-mező bal széle levágva. A `Popover` (visit-plan) mostantól nyitáskor
     megméri a panelt, és ha a bal/jobb szélen kilóg, `translateX`-szel a képernyőn belülre
     tolja (viewport-őr, 8px margó; `viewportShiftX` tiszta függvény), a szélessége sosem több
     `calc(100vw-1rem)`-nél. Érintőképernyőn (`pointer: coarse`) a kereső nem fókuszál
     automatikusan — a felugró billentyűzet eltakarná a listát. Minden visit-plan popover
     (PhasePill, VisitRow, VisitGap, VisitBookingButton) ugyanezt kapja.
  2. *Orvos választásakor „Hiba történt" (500), a felelős orvos nem állt át.* A
     `provider_assignment_events` a legacy `migration_event_partitioning.sql`-ből jön, ami nem
     tracked (a deploy csak `npm start`, migrációt nem futtat): ahol sosem futott le, a
     napló-INSERT 42P01-gyel (undefined_table) bukott, és — egy tranzakció — vele az UPDATE is;
     a 092 (`ALTER TABLE … DROP NOT NULL`) ott el is torlaszolta volna a tracked láncot.
     Javítás három rétegben: **092 toleráns** (hiányzó táblánál NOTICE, nem hiba); **093**
     létrehozza a táblát a legacy alakjával (nullable `new_user_id`, havi partíciók 2020-01 …
     2028-12, `IF NOT EXISTS`), és meglévő táblához is **DEFAULT partíciót** ad (2029-től / lyuk
     esetén sem 23514 „no partition found"); **a napló-sor SAVEPOINT-on belül** megy
     (`lib/episode-provider.ts`) — hiányzó tábla/partíció (42P01/42703/23514) esetén a sor
     kimarad hangos `logger.error`-ral, a felelős orvos váltása átmegy; minden más hiba
     (pl. FK) továbbra is ROLLBACK. A történet-lekérdezés hiányzó táblánál üres lista. A
     toast a generikus „Hiba történt" helyett a műveletet nevezi meg, `[kód · correlationId]`
     címkével (`formatApiErrorParts`). **Éles teendő:** `npm run migrate` (092 + 093).
     Tesztek: `episode-provider` (SAVEPOINT-ágak), `popover` (viewport-őr), 2 új komponens-
     eset (toast-szöveg), integráció: `migration-093-provider-assignment-events` (092/093
     hiányzó és meglévő táblán, partíció-routing, idempotencia), `episode-provider-history`
     (+1: hiányzó táblánál a váltás átmegy).

### 6.2c „Az időpontfoglalás a váz, a tartalom a kezelési terv" (WP-6.3)

A felhasználó 2026-09-02 este: a tartalom rendezgetése közben kiürült és eltűnt az első
alkalom (a szept. 3-i időponttal), az új alkalmat nem tudta szept. 3-ra tenni, minden
„elcsúszott". Két szabály: **üres alkalom ne szűnjön meg automatikusan**, és **a terv
csússzon rá fluidan a már foglalt időpontokra** — az időpont a váz, a fázis a tartalom.

- **Modell (094):** `episode_visits.appointment_id` — az alkalom birtokolja az időpontját.
  A fázis-szintű link (`ewp.appointment_id` ↔ `appointments.work_phase_id`) megmarad a régi
  motorok (worklist, státusz-átmenet, projektor) felé, de csak az alkalom nyitott blokkjának
  **primary** fázisa hordozza; a többi nyitott tag alá van vonva (`merged_into`). Ezt az
  invariánst minden kompozíciós mutáció után a `syncVisitAppointment`
  (`lib/visit-appointment-sync.ts`) állítja helyre; a booking-motorok (appointment-service,
  convert-slot-intent, link-appointment) `adoptAppointmentForPhaseVisit`-tel adják át az
  alkalomnak az új foglalást. Backfill: az alkalom a tagjai legkorábbi aktív foglalását örökli.
- **Mozgatás = tartalom mozog, időpont marad.** A primary áthelyezése: a fázis várakozó lesz
  (link nélkül), a forrás-alkalom időpontja marad, a következő tag promótálódik rá; a célban
  a fázis a blokk része (ha a célnak van időpontja, rácsúszik). Az alá vont tagok NEM mennek
  a primary-val (korábban vitte őket). A fázis törlése sem mondja le az alkalom időpontját
  (`releasePhaseFromVisit` + `keepAppointmentIds`); az üres-de-foglalt alkalom törlése igen.
- **Üres alkalom megmarad** — minden `deleteEpisodeVisitsIfEmpty` hívás kikerült (move,
  delete, merge). A kliens sem távolítja el.
- **A váz felülete:** alkalom nélküli, jövőbeli foglalt időpontok sávja a tábla tetején
  („Foglalt időpont alkalom nélkül") → alkalomhoz / új alkalomhoz rendelhető
  (`POST /visits/:id/attach-appointment`); az alkalom menüjében „Meglévő időpont
  hozzárendelése" és „Időpont leválasztása (megmarad)" (`detach-appointment`). Üres, de foglalt
  alkalom: időpont-chip + „tartalom nélkül" jelzés.
- **Rácsúszás:** a foglalt alkalmak időrendben pinnelve (`normalizeVisitOrder` — a foglalt
  pozíciókat az időrend tölti, a tervezettek a helyükön maradnak); a tervezett alkalom ablaka
  a következő fix pont (foglalt/teljesült) elé szorul — plafon a `computeVisitAwareWindowChain`
  / `computePhaseWindowChain` láncban és a slot-intent projektorban. A „márc. 24." típusú
  elcsúszás (jövőbeli horgony) ezzel a plafonra ül.
- **Blokk-hossz olvasáskor:** a worklist / projektor / slot-választó az alkalom nyitott
  tagjainak összpercét (vagy `planned_duration_minutes`) használja; a primary saját perce nem
  íródik át (a korábbi prepare-booking bump kivezetve).

### 6.3 Nyitott / követés

- A `default_days_offset` oszlop EWP-n és a pathway JSON-ban megmarad (sablon-alkalmazás
  továbbra is fázisonként egyfős vizitet nyit a sablon offsetjével).
- A `convert-all-intents` lánc-gap továbbra is a fázis-offsetből számol
  (`gapByStep`); a projektor és a lánc már vizit-alapú — a köteg-foglalás a több-fázisú
  alkalmakat előbb `prepare-booking`-gal vonja egybe (kliens), így egy alkalom = egy intent.
- Admin katalógus-szerkesztő (`StepCatalogEditor`) még nem kezeli a paletta-mezőket.

---

## FÁZIS 5 — Tesztlefedettség (folyamatos)

A WP-0.0 harnesse mellé, a fázisokkal párhuzamosan, a riport által javasolt esetek:

| Fájl | Eset |
|---|---|
| `work-phase-skip-releases-booking` | `scheduled → skipped` lemond, felszabadít, nulláz (WP-0.1) |
| `attempt-outcome-intent-expiry` | `mark_unsuccessful` intent-lejáratás + revert blokkoló-ellenőrzés (WP-0.2, WP-0.8) |
| `work-phases-reorder` | shift SAVEPOINT-on belül; epizód-státusz kapu (WP-0.5) |
| `generate-episode-work-phases` | arbiter = a 006 indexe; `__legacy__` őr nem `IS NULL`; törölt fázis nem éled újra (WP-0.7) |
| `convert-slot-intent-ewp-link` | a konverzió ír EWP `appointment_id`/`status`-t; a szonda `client`-et kap (WP-0.6, WP-0.8) |
| `convert-all-intents-chain` (bővítés) | vezető kihagyás ága; kimerült retry a 503-as ágra (WP-0.2, WP-0.8) |
| `migration-029-attempts` (javítás) | a `:88` assertion ma a 059 által javított hibát kodifikálja (WP-0.9) |

---

## 2. Ami még nyitva van (a felhasználó döntését várja — 2026-08-27 esti állapot)

1. ~~**Recall-kadencia konkrét számai**~~ **ELDÖNTVE 2026-08-27:** a felhasználó a
   javasolt számokat jóváhagyta (low 180/365, medium 90/180/365, high 30/90/180/365) —
   [#76](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/76).
2. ~~**STAGE_6 mint auto-generálási kapu**~~ **ELDÖNTVE 2026-08-27:** a felhasználó a
   lazítást kérte — auto-recall átadás előtt is születik, ha van már teljesült
   kezelés/kontroll (az a horgony); horgony nélkül továbbra sem —
   [#76](https://github.com/janoskonig/maxillofacialisrehabilitacio/pull/76).
3. **`episode_visits` külön tábla vs. merge-csoport** megtartása (WP-4.1) — a terv
   ajánlása a külön tábla, de ez séma-elköteleződés.
4. ~~**FÁZIS 4 (vizit-alapú „puzzle" terv)**~~ **JÓVÁHAGYVA 2026-08-28-án — végrehajtás
   alatt.**
5. A 19 nem verifikált audit-megállapítás (a riport 02. szakaszának végén) —
   plauzibilisek, de nem igazoltak; a javítások során 5 új, elő-létező hézag elő is
   került és javítva lett (#65 review → WP-0.8 kiegészítés; multi-link a #74-ben).
   A maradékot érdemes szemmel tartani.
6. Két örökölt hiba külön feladat-chipként vár indításra: az ajánlat-lista LIMIT 50
   csonkolása és a halott `AppointmentBooking.tsx` kivezetése (WP-1.4 review).

## 3. Munkamódszer a végrehajtó agenteknek

- **Egy WP = egy branch = egy PR**, a WP azonosítójával a címben (`WP-0.1: …`).
- A PR leírásában: mi volt a hibás viselkedés, mi lett, és **hogyan verifikáltad** (a teszt neve
  vagy az élő preview lépései). Ha nem futtattad, írd le, hogy nem futtattad.
- **Ne írj source-regex tesztet** olyan viselkedésre, amit futtatni is lehet.
- Élő ellenőrzéshez `npm run dev` + preview; a levélküldés nem-éles környezetben alapból száraz
  (`EMAIL_DRY_RUN`). Ne kapcsold ki.
- A dev DB adatait a `.env.local` tartalmazza; ne írj credentialt commitba.
- Ha egy WP közben kiderül, hogy a leírás téved: **állj meg, jelezd**, ne tervezz át magadtól.
