# MaxRehab „reverse engineering”: a rögzített változóktól a publikálható hipotézisekig

> **Cél.** A MaxRehab-ban már ma rögzített (vagy a rögzített adatokból származtatható) változókból visszafejteni, milyen tudományos közlemények írhatók meg az adatbázisból. Minden irányhoz a **változók → predikciók → hipotézis** láncot adom meg, ahol a hipotézis kötelező alakja:
> **„… \<állítás\> …, mert … \<indoklás\> …”**.
>
> **Forrás.** Kizárólag a kódbázis: `database/schema.sql`, `database/legacy/migration_*.sql`, `database/migrations/001–093`, a `lib/` domain-modulok (OHIP-14, epizód/stádium, munkafázis, ütemezés, next-step/forecast, no-show-rizikó, adat-teljesség, kutatási regiszter) és a meglévő statisztika-végpontok (`app/api/admin/stats/*`, `app/api/patients/demographics`). Betegadatot nem érintettem, adatbázis ebben a környezetben nem futott: **az elemszámok ismeretlenek**, ezért minden irányhoz megadom, milyen *n* mellett értelmes.
>
> **Jogi/etikai keret (a rendszer maga kényszeríti ki).** Kutatási kohorsz-export csak akkor lehetséges, ha (1) az `ethics_approvals` táblában érvényes ETT TUKEB engedély van (`lib/research-registry/research-export-gate.ts`), (2) a beteg `consent_status = 'granted'` és nem `LEGACY_UNVERIFIED` (`consent.ts`), és (3) a `RESEARCH_EXPORT_MODE` átáll `disabled`-ről `consent_required`-re (`operational-policy.ts`). Az export álnevesített: 5 éves korsáv, 2 karakteres irányítószám-előtag, sózott SHA-256 alanykulcs (`research-patient-view.ts`). **Minden alábbi publikáció ezekre a kapukra épül** — a legelső lépés tehát az engedély és a hozzájárulás-gyűjtés, nem a statisztika.

---

## Tartalom

1. [Változó-leltár: mi van a MaxRehab-ban](#1-változó-leltár-mi-van-a-maxrehab-ban)
2. [Publikációs irányok (K1–K8) — változók → predikciók → hipotézisek](#2-publikációs-irányok)
3. [Hipotézis-regiszter (pre-regisztrációs váz)](#3-hipotézis-regiszter)
4. [Prioritás és ütemezés](#4-prioritás-és-ütemezés)
5. [Adat-harmonizációs buktatók, amiket a kód elárul](#5-adat-harmonizációs-buktatók)
6. [Előfeltételek a MaxRehab-ban](#6-előfeltételek-a-maxrehab-ban)
- [Függelék A: adatkinyerési SQL-vázlatok](#függelék-a-adatkinyerési-sql-vázlatok)
- [Függelék B: rövid változó-szótár](#függelék-b-rövid-változó-szótár)

---

## 1. Változó-leltár: mi van a MaxRehab-ban

A `patients` tábla az 005-ös migráció óta öt táblára bontott (`patients`, `patient_referral`, `patient_anamnesis`, `patient_dental_status`, `patient_treatment_plans`), a `patients_full` VIEW adja vissza egyben. Az epizód/ütemezési réteg külön táblacsalád. Alább domainenként, a **statisztikai típussal** és a **publikációs szereppel** (kimenet / prediktor / zavaró / folyamat).

### 1.1 Demográfia, adminisztráció (`patients`)

| Változó | Tábla.oszlop | Típus | Szerep |
|---|---|---|---|
| Nem | `patients.nem` (`ferfi`/`no`) | bináris | zavaró |
| Életkor felvételkor | `szuletesi_datum` + `felvetel_datuma` → származtatott | folytonos (exportban 5 éves sáv) | zavaró / prediktor |
| Lakóhely-régió | `iranyitoszam` → 2 karakter előtag | nominális | távolság-proxy (no-show, utánkövetés) |
| Felvétel dátuma | `felvetel_datuma` | dátum | folyamat-horgony |
| Halálozás dátuma | `halal_datum` (migration_patient_death, 080 zárja az epizódokat) | dátum | **versengő esemény** (K3) |
| Intake-státusz | `intake_status` (JUST_REGISTERED → NEEDS_TRIAGE → TRIAGED → IN_CARE) | ordinális FSM | folyamat |
| Kezelőorvos | `kezeleoorvos_user_id` (027, sticky 051) | nominális | klaszter-változó (orvos-hatás) |
| Kiskorú / képviselő | `torvenyes_kepviselo_*` (050) | bináris | alcsoport (veleszületett) |
| Hozzájárulás | `consent_status`, `patient_consent_events` (037), `gdpr_consents` | enum + eseménynapló | export-kapu |

### 1.2 Beutalás és etiológia-specifikus anamnézis (`patient_referral`, `patient_anamnesis`)

| Változó | Oszlop | Típus | Megjegyzés |
|---|---|---|---|
| Kezelésre érkezés indoka (etiológia) | `kezelesre_erkezes_indoka` | 3 (+1) kategória: *onkológiai kezelés utáni állapot*, *traumás sérülés*, *veleszületett rendellenesség*, (*nincs beutaló*) | **fő rétegző változó** minden irányban |
| Beutaló orvos / intézmény | `beutalo_orvos`, `beutalo_orvos_user_id` (050), `beutalo_intezmeny` (törzs: `referral_institutions`, 067) | nominális | beutalási út, késés |
| Beutalás indokolása | `beutalo_indokolas` | szöveg | — |
| Primer műtét leírása, ideje | `primer_mutet_leirasa`, `mutet_ideje` | szöveg, dátum | `mutet_ideje → felvetel_datuma` = **beutalási késés** |
| Szövettani diagnózis | `szovettani_diagnozis` | szöveg (kódolandó) | onkológiai alcsoport |
| BNO-kód | `bno` (vesszővel elválasztott), `lib/bno-codes.json` szótár | nominális | diagnózis-rétegzés (C00–C14, C41 stb.) |
| TNM-stádium | `tnm_staging` | szöveg (kódolandó T/N/M) | súlyosság |
| Nyaki blokkdisszekció | `nyaki_blokkdisszekcio` (nem volt / egyoldali / kétoldali) | ordinális | műtéti kiterjedés |
| Radioterápia | `radioterapia` (bool), `radioterapia_dozis` (szöveg) → `radioterapia_dozis_gy` (051, numerikus), `radioterapia_datum_intervallum` | bináris + folytonos | **kulcs-prediktor** (xerostomia, gyógyulás, implantáció) |
| Kemoterápia | `chemoterapia`, `chemoterapia_leiras` | bináris + szöveg | prediktor |
| Dohányzás | `dohanyzas_szam` → `dohanyzas_szam_ertek` (szál/nap) | folytonos | zavaró |
| Alkohol | `alkoholfogyasztas` | szöveg (kódolandó) | zavaró |
| Baleset (trauma) | `baleset_idopont`, `baleset_etiologiaja`, `baleset_egyeb` | dátum, szöveg | trauma-alcsoport |
| Veleszületett rendellenességek | `veleszuletett_rendellenessegek` JSONB (kemény szájpadhasadék, lágyszájpad-inszufficiencia, állcsonthasadék, ajakhasadék), `veleszuletett_mutetek_leirasa` | multi-select | veleszületett alcsoport |

### 1.3 Defektus- és funkció-osztályozás (`patient_anamnesis`)

| Változó | Oszlop | Skála | Klinikai jelentés |
|---|---|---|---|
| Maxilladefektus | `maxilladefektus_van` (háromállapotú: NULL = nincs adat) | bináris | — |
| Brown-osztály, függőleges | `brown_fuggoleges_osztaly` 1–4 | ordinális | a maxillektómia kiterjedése (1 legkisebb → 4 orbita-exenteráció) |
| Brown, vízszintes/palatinális | `brown_vizszintes_komponens` a–c | ordinális | a szájpad/alveolus érintettsége |
| Mandibuladefektus | `mandibuladefektus_van` | bináris | — |
| Kovács–Dobák-osztály | `kovacs_dobak_osztaly` 1–5 | ordinális* | mandibuladefektus kiterjedése (*az ordinalitás irányát a protokollban rögzíteni kell) |
| Nyelvmozgások akadályozottak | `nyelvmozgasok_akadalyozottak` | bináris | funkció (beszéd, lenyomat tűrése) |
| „Gombócos” beszéd | `gombocos_beszed` | bináris | funkció |
| Nyálmirigy-állapot | `nyalmirigy_allapot` (hiposzaliváció / hiperszaliváció / nem számol be eltérésről) | nominális | **xerostomia-proxy** |
| Fábián–Fejérdy protetikai osztály, felső / alsó | `fabian_fejerdy_protetikai_osztaly_felso/_also` (0, 1A, 1B, 2A, 2A/1, 2B, 3, T) | ordinális (T = teljes fogatlanság) | a támasztási viszonyok, a pótlástípus fő meghatározója |

### 1.4 Fogazati, parodontális és implantációs státusz (`patient_dental_status`, `perio_charts`, `dental_status_snapshots`, `tooth_treatments`)

| Változó | Forrás | Típus | Származtatható mutató |
|---|---|---|---|
| Odontogram | `meglevo_fogak` JSONB: fogszám → {`status` D/F/M (régi) **vagy** `base` ∈ {sound, missing, filled, crown, root_canal, inlay, implant, bridge_abutment, bridge_pontic, root_remnant, impacted, necrotic, denture_tooth}, `caries`, `periapical`, `mobility` 0–3, `surfaces` (M/D/V/O/Occl: caries/filling)} | fog-szintű | **DMFT** (harmonizált, lásd 5. fejezet), maradék fogak száma állcsontonként, hiányzó fogak száma, mobilitás-index |
| Kiindulási vs datált státusz | `dental_status_snapshots` (kind = baseline/status, `effective_date`, 056) | idősor | **fogvesztés átadás után** (K8) |
| Parodontális chart | `perio_charts.data` (fogankénti bukkális/orális 3-3 pont: PD, REC, BOP, plakk; mobilitás, furkáció; 055) | fog/pont-szintű | átlag PD, BOP%, CAL (`lib/perio.ts computeCAL`), plakk% |
| Implantátumok | `meglevo_implantatumok` JSONB (fogszám → leírás), `implants` tábla, `nem_ismert_poziciokban_implantatum` | fog-szintű | implantátumszám, pozíció |
| Meglévő pótlás | `felso/also_fogpotlas_van`, `_tipus` (11 típus), `_mikor`, `_keszito`, `_elegedett` (háromállapotú), `_problema` | nominális/bináris | **korábbi pótlás elégedettség** (T0 prediktor) |
| Fog-szintű kezelési igény | `tooth_treatments` (tomes, gyokerkezeles, huzas, implantacio, korona, csiszolas, hid_pillerkezeles, devitalizalas, csonk_felepites, hezagfog, mufog, kapocstarto_korona, kapocstarto_tamfog, rejtett_elhorgonyzas; `status`, `completed_at`) | esemény | pre-protetikai beavatkozások száma → átfutási idő |

### 1.5 Kezelési terv és kezeléstípus (`patient_treatment_plans`, `treatment_types`, `care_pathways`)

| Változó | Forrás | Értékkészlet |
|---|---|---|
| Tervezett pótlás állcsontonként | `kezelesi_terv_felso/_also` JSONB [{`treatmentTypeCode`, `tervezettAtadasDatuma`, `elkeszult`}] | 11 `treatment_types.code`: zarolemez, reszleges_akrilat, teljes_lemez, fedolemezes, kapocselhorgonyzasu_reszleges, kombinalt_kapoccsal, kombinalt_rejtett, rogzitett_fogakon, cementezett_implant, csavarozott_implant, sebeszi_sablon |
| Pótlás-csoport (származtatott) | kód → csoport | *kivehető akrilát* (zarolemez, reszleges_akrilat, teljes_lemez) · *fémlemezes/kombinált* (kapocselhorgonyzasu_reszleges, kombinalt_*) · *fedőlemezes* · *rögzített fogakon* · *implantációs* (cementezett/csavarozott) · *sebészi sablon* |
| Arcot érintő epitézis | `kezelesi_terv_arcot_erinto` [{`tipus`: orr-/fül-/orbita-/középarc-epitézis, `elhorgonyzasEszkoze`: bőrragasztó / mágnes / rúd-lovas / gömbretenció, `elkeszult`}] | nominális |
| Terv jóváhagyása | `patient_episodes.plan_approved_at/_by` (053) | időbélyeg |
| Terv-változások | `episode_work_phase_audit.change_type` (087/090: create, delete, reorder, merge, unmerge, timing_change, template_apply, template_remove, visit_change, scope_change) | eseménynapló → **terv-revíziók száma** |
| Sablon-lépésszám | `care_pathways.work_phases_json` (kezeléstípusonként 2–11 munkafázis; pl. teljes lemez: anatómiai lenyomat → egyéni kanál → funkciós lenyomat → harapásregisztráció → fogpróba → átadás) | egész | tervezett vizitszám |
| Labor-árajánlat | `lab_quote_requests.datuma` | dátum | árajánlat-átfutás |
| Méltányossági kérelem | `kortorteneti_osszefoglalo`, `szakorvosi_velemeny`, dokumentum-tag `technikus_meltanyossagi` | szöveg/dokumentum | finanszírozási út |

### 1.6 Ellátási epizód, stádiumok, munkafázisok, blokkok

| Változó | Forrás | Megjegyzés |
|---|---|---|
| Epizód | `patient_episodes` (`reason`, `status` open/closed/paused, `opened_at`, `closed_at`, `parent_episode_id`, `trigger_type` ∈ {recidiva, fogelvesztes, potlasvesztes, kontrollbol_uj_panasz, egyeb}, `assigned_provider_id`, `treatment_type_id`, `recall_risk_level` low/medium/high (088), `auto_created` (077)) | egy betegnek több epizódja lehet → **újra-kezelés mint kimenet** (K8) |
| Több pathway / állcsont | `episode_pathways` (`care_pathway_id`, `jaw` felso/also, 006) | kétállcsontos esetek |
| Stádium-események | `stage_events` (`stage_code` STAGE_0…STAGE_7, `at`): 0 első konzultációra vár · 1 diagnosztika & dokumentáció · 2 terv & árajánlat · 3 elfogadva / finanszírozás · 4 sebészi fázis · 5 protetikai fázis · 6 **átadás** · 7 gondozás | **időtartam-elemzés gerince**; átadás dátuma = első STAGE_6 (`lib/ohip14-stage.ts getDeliveryDate`) |
| Mérföldkövek | `patient_milestones` (`code`, pl. SURG_IMPLANT_PLACED → virtuális SURG_OSSEOINTEGRATED +183 nap, `milestone_auto_generation`) | implantációs idővonal |
| Munkafázisok | `episode_work_phases` (`work_phase_code`, `pool` consult/work/control, `duration_minutes`, `default_days_offset`, `status` pending/scheduled/completed/skipped, `completed_at`, `visit_id` (089), `tooth_treatment_id`) | tervezett vs teljesült lépések, kihagyott lépések |
| Vizitek („Alkalom”) | `episode_visits` (`seq`, `days_offset`) | vizit-szintű kadencia |
| Klinikai blokkolók | `episode_blocks` (`key` ∈ {WAIT_LAB 14 nap, WAIT_HEALING 30, WAIT_SURGERY 60, PATIENT_DELAY 14, WAIT_OR 60, WAIT_IMPLANT 90, OTHER 14}, `renewal_count`, `expires_at`) | **várakozási okok taxonómiája** |
| Előrejelzés (beépített) | `episode_forecast_cache` (`remaining_visits_p50/p80`, `completion_end_p50/p80`), `care_pathway_analytics` (medián/p80 vizit, kadencia, `no_show_rate`, n ≥ 10 kalibráció) | **validálható predikciós modell** (K3) |
| SLA | `scheduling_slas`, `sla_violations` (`overdue_by_days`) | folyamat-KPI |

### 1.7 Időpontok, próbák, no-show (`appointments`, `available_time_slots`, `slot_intents`)

| Változó | Oszlop | Értékek / származtatás |
|---|---|---|
| Időpont-státusz | `appointment_status` | NULL (várható) · completed · no_show · **unsuccessful** (029) · cancelled_by_doctor · cancelled_by_patient |
| Időpont típusa | `appointment_type` (elso_konzultacio, munkafazis, kontroll, recall, egyeb; 060), `pool`, `step_code`/`work_phase_id` | melyik munkafázis |
| Próba-sorszám | `attempt_number` (029) — csak completed/unsuccessful/no_show számít próbának (`lib/appointment-attempts.ts`) | ≥2 = ismételt próba |
| Sikertelenség oka | `attempt_failed_reason` — 5 kanonikus sablon: *Lenyomat torzult / nem értékelhető*, *Beteg nem tűrte (öklendezés / fájdalom)*, *Anyagprobléma*, *Labor szerint hibás*, *Nem maradt elég idő*; + Egyéb (`lib/unsuccessful-attempt-templates.ts`) | **egyedülálló, strukturált „sikertelen klinikai próba” taxonómia** |
| Késés | `is_late` | bináris |
| Átfutás (lead time) | `start_time − created_at` | napok |
| Napszak, hét napja | `start_time` | óra (7–9 = korai), ISODOW |
| Foglalás módja | `created_via` (worklist, patient_self, admin_override, surgeon_override, migration, google_import) | önfoglalás vs személyzet |
| Megerősítés | `requires_confirmation`, `confirmed_at`, `hold_expires_at` | — |
| Beépített no-show-rizikó | `no_show_risk` (0–1) — szabályalapú: 0,05 alap + 0,15 (≥1 korábbi no-show) + 0,10 (≥2) + 0,05 (átfutás > 21 nap) + 0,05 (7–9 óra) (`lib/no-show-risk.ts`, `no_show_risk_config`) | **validálható/kalibrálható modell** (K4) |
| Kapacitás | `capacity_pool_config` (heti consult/work/control cél), `doctor_capacity_overrides`, `lab_queue_metrics` (WIP, átfutás) | rendszer-szintű zavaró |
| Foglalási szándék | `slot_intents` (`window_start/_end`, `state` open/converted/cancelled/expired, `priority`) | foglalási késés |

### 1.8 OHIP-14 életminőség (`ohip14_responses`)

| Változó | Oszlop | Megjegyzés |
|---|---|---|
| Időpont | `timepoint` T0–T5 (074): T0 protetikai fázis előtt (STAGE_0–4 kapuzott) · T1 átadáskor (0. nap) · T2 +30 nap · T3 +180 nap · T4 +365 nap · T5 +1095 nap (`lib/ohip14-timepoint-stage.ts`) | ablak = megnyílástól a következő megnyílásáig |
| 14 tétel | `q1_functional_limitation … q14_handicap` (0–4: soha … mindig, 3 hónapos visszatekintés) | Likert |
| Összpont, 7 dimenzió | `total_score` 0–56; `functional_limitation_score`, `physical_pain_score`, `psychological_discomfort_score`, `physical_disability_score`, `psychological_disability_score`, `social_disability_score`, `handicap_score` (0–8) | **elsődleges kimenet** |
| Kitöltő | `completed_by_patient` (portál vs személyzet) | mérési mód → zavaró |
| Válaszarány-tölcsér | `lib/ohip14-funnel.ts`: completed / pending_open / missed / not_open; `ohip_reminder_log` (emlékeztetők száma, eszkaláció ≥3) | **lemorzsolódás-modell** (K6) |
| Értelmezési sávok | `lib/ohip14-score-interpretation.ts`: 0–8 minimális, 9–18 enyhe–közepes, 19–28 közepes, 29–42 jelentős, 43–56 nagyon jelentős | kategorizált kimenet |

### 1.9 Konzílium, feladatok, kommunikáció, dokumentumok

| Domain | Forrás | Használható mutató |
|---|---|---|
| Konzílium | `consilium_sessions` (`scheduled_at`, `status`, `attendees`, `invitation_send_count`, `scheduled_at_change_count`), `consilium_session_items` (`discussion_status` pending/in_progress/discussed/deferred, `checklist` pontonként `response`, delegált feladatok), 011/012/031/040 | megbeszélt-e a beteg a terv előtt; halasztások; döntés → feladat átfutás |
| Feladatok | `user_tasks` (`task_type` document_upload/ohip14/manual/meeting_action/staff_registration_review/missing_data, `status`, `due_at`, `completed_at`, `assignee_kind` staff/patient), `episode_tasks` (recall_due, `recall_interval_days`, `source` auto/manual, `appointment_id`) | megoldási idő (medián, `/api/admin/stats/operational`), recall-adherencia |
| Kommunikáció | `communication_logs` (message/phone/in_person/other; irány), betegportál üzenetek (`messages`, kézbesítés/olvasás 042), push-feliratkozás, `outbound_email_log` | kapcsolattartás intenzitása → adherencia |
| Dokumentumok | `patient_documents` (`tags` pl. `op` = OP-röntgen, `arajanlat`, `technikus_meltanyossagi`; `uploaded_at`) | dokumentációs teljesség, késés |
| Beteg-visszajelzés | `feedback` (típus, prioritás 082) | rendszerminőség (K9) |

### 1.10 Adatminőség, hiány-mechanizmus, kutatási regiszter

| Változó | Forrás | Megjegyzés |
|---|---|---|
| Teljességi pontszám | `lib/patient-data-completeness.ts`: súlyozott (identitás/diagnózis 3×, klinikai osztályozás/dokumentum 2×, kontakt/kutatási 1×), `clinicalComplete`, `researchReady`, `publicationReady` (= elemzésre kész **és** nincs plauzibilitási figyelmeztetés) | betegszintű 0–100 |
| Feltételes kutatási mezők | ohipT0, bno, tnmStaging (csak onkológiai), brownFuggoleges/Vizszintes (csak maxilladefektus), kovacsDobak (csak mandibuladefektus), radioterapiaDozis (csak RT), beutaloIndokolas, mutetLeiras/mutetIdeje/szovettan (onkológiai), dohanyzas, alkohol, felso/alsoFogpotlasElegedett | a „nem alkalmazható” nem hiány |
| Hiány-okkód | `patient_field_na.reason_code` (068): nem_alkalmazhato · nem_ismert · **beteg_megtagadta (MNAR-gyanús)** · **meg_nem_kerdeztek (MCAR-közeli)** | **a hiány mechanizmusa kódolt** — ritka egy klinikai regiszterben |
| Napi pillanatkép | `data_completeness_snapshot` (`snapshot_date`, `total`, `avg_score`, `clinical_complete`, `research_ready`, `publication_ready`, `with_warnings`) | **megszakított idősor** alapja (K6) |
| Emlékeztetők | `missing_data_reminder_log` (orvos), `patient_selffill_reminder_log` (beteg), `ohip_reminder_log` | intervenció-időpontok |
| Plauzibilitás | `lib/data-plausibility.ts`: TAJ-ellenőrzőszám, jövőbeli születés, >120 év, halál a születés előtt, státusz nélküli fogbejegyzés | adatminőség-hibák |
| Kapu-felülbírálás | `completeness_gate_override` (061) | hiányos betegek epizódindítása |
| Változásnapló | `patient_changes` (mezőszintű old/new), `patient_snapshots`, `audit_events`, `patient_data_access_log` (071) | adatrögzítési viselkedés |
| Minőségi állapotgép | `entity_quality_state` (DRAFT → LOCAL_REVIEW → CENTER_APPROVED → REGISTRY_APPROVED → LOCKED_FOR_ANALYSIS), `crf_form_versions`/`crf_field_versions` | CRF-verziózás |
| Export | `analysis_exports` (tartalom-hash, manifest-hash, `schema_version` 1.1), `analysis_export_subjects`, `consent_export_manifest` | reprodukálható adatállomány |

### 1.11 Beépített, validálható modellek (a „predikció” már a rendszerben van)

| Modell | Hol | Mit jósol | Publikációs használat |
|---|---|---|---|
| No-show-rizikó | `lib/no-show-risk.ts` | P(no-show) szabályalapú | diszkrimináció (AUC) és kalibráció mérése, együtthatók újrabecslése (K4) |
| Epizód-forecast | `lib/episode-forecast.ts`, `episode-forecast-projection.ts` (kalibrált pathway-analitika → konkrét hátralévő lépések → sablon-heurisztika 0,6/0,9 → alapértelmezés 4/6 vizit; kadencia 14 nap) | hátralévő vizitek P50/P80, befejezési ablak | **előrejelzés-kalibráció**: tényleges átadás a P80 ablakon belül? (K3) |
| Intake-policy | `lib/intake-policy.ts` (busyness ≥150/200 %, backlog ≥200/300 %, WIP P80 >14/28 nap → CAUTION/STOP) | felvehető-e új beteg | kapacitás-dinamika leírása |
| Stádium-javaslat | `stage_transition_rulesets` (R001–R007) | következő stádium | folyamat-konformancia |
| Recall-kadencia | `lib/recall-cadence.ts` (low 180/365 · medium 90/180/365 · high 30/90/180/365) | kontroll-esedékesség | rizikószint prediktív validitása (K8) |
| Gyártási idő becslés | `lib/kezelesi-terv-estimate.ts` (10–28 nap kezeléstípusonként) | legkorábbi elkészülés | labor-átfutás validáció (K3) |
| Osszeointegráció | `milestone_auto_generation` (+183 nap) | virtuális mérföldkő | implantációs idővonal |

### 1.12 Származtatott változók (egy sorban, a Függelék A SQL-jei adják)

Életkor felvételkor · beutalási késés (`mutet_ideje → felvetel_datuma`) · várakozás első konzultációra (`appointments.created_at → start_time`, `/api/admin/stats/medical`) · idő a terv jóváhagyásáig (STAGE_0 → `plan_approved_at`) · **idő az átadásig** (epizód `opened_at` → első STAGE_6) · stádiumonkénti tartózkodási idő · teljesült vizitek száma · vizit-kadencia (medián napok) · blokk-napok okonként · próbák száma munkafázisonként · no-show-arány betegenként · **DMFT harmonizálva** (D+F és M külön!) · maradék fogak száma állcsontonként · implantátumszám · OHIP-delta időpontonként · MCID-responder · utánkövetés-teljesség (T3 megvan-e) · teljességi pontszám · NA-okkód-profil · terv-revíziók száma · konzíliumon megbeszélt-e a terv jóváhagyása előtt.

---

## 2. Publikációs irányok

Jelölés: **V** = változók, **P** = predikció (mérhető, irányított várakozás), **H** = hipotézis („állítás, mert indoklás”). A H-kódok a 3. fejezet regiszterében összesítve.

---

### K1 · Regiszter-profil: a maxillofaciális protetikai rehabilitációra beutalt betegek klinikai fenotípusa etiológia szerint

**Munkacím.** *„Onkológiai, traumás és veleszületett eredetű maxillofaciális defektusok protetikai rehabilitációja: egy hazai regiszter kohorsz-profilja”* (STROBE, keresztmetszeti + felvételi adatok).

**Kérdés.** Miben különbözik a három etiológiai csoport a felvételkor: életkor, nem, defektus-osztály, fogazati/parodontális státusz, korábbi pótlás, adjuváns terápiák, beutalási út és késés, tervezett pótlástípus?

**V (változók).**
- Rétegző: `kezelesre_erkezes_indoka`.
- Leíró: életkor, `nem`, régió; `bno`, `szovettani_diagnozis`, `tnm_staging`, `nyaki_blokkdisszekcio`, `radioterapia`/`radioterapia_dozis_gy`, `chemoterapia`; `brown_*`, `kovacs_dobak_osztaly`, `nyelvmozgasok_akadalyozottak`, `gombocos_beszed`, `nyalmirigy_allapot`; `fabian_fejerdy_*`; harmonizált DMFT, hiányzó fogak száma, implantátumszám; `felso/also_fogpotlas_*` (típus, elégedettség); perio (átlag PD, BOP %); `dohanyzas_szam_ertek`, `alkoholfogyasztas` (kódolva); tervezett pótlás-csoport; epitézis típus és retenció.
- Folyamat: `mutet_ideje → felvetel_datuma` (beutalási késés), `beutalo_intezmeny`, várakozás első konzultációra.

**P (predikciók).**
- P1.1 Az onkológiai csoport idősebb, férfitöbbségű, magasabb hiányzó-fog-számú és nagyobb arányban kap kivehető (obturátoros / teljes lemezes) tervet, mint a traumás és a veleszületett csoport.
- P1.2 A hiposzaliváció aránya az RT-n átesett betegek között többszöröse a nem sugárkezeltekének.
- P1.3 Implantációs (cementezett/csavarozott) terv az RT-s betegeknél ritkább, és a dózissal csökken.
- P1.4 A veleszületett csoport a legfiatalabb, több epizódos, hosszú távú („etapos”) tervvel (a `stage_catalog` külön így címkézi: „Hosszú távú terv + etapok”).
- P1.5 A beutalási késés a külső intézményből érkezőknél hosszabb, mint az intézményen belülről érkezőknél.

**H (hipotézisek).**
- **H1.1** Az onkológiai etiológiájú betegek DMFT-je és hiányzó-fog-száma szignifikánsan magasabb a traumás és veleszületett csoporténál, **mert** a daganatos betegek idősebbek, a reszekció fogakat is eltávolít, a sugárterápia pedig xerostomián keresztül fokozza a cariesaktivitást.
- **H1.2** A sugárkezelt betegek között a hiposzaliváció prevalenciája legalább kétszeres a nem sugárkezeltekhez képest, **mert** a fej-nyaki besugárzás dózisfüggően károsítja a nyálmirigy-parenchimát.
- **H1.3** Sugárkezelt betegnél az implantációs pótlás tervezésének esélye alacsonyabb, és a dózis emelkedésével tovább csökken, **mert** a besugárzott csontban az osszeointegráció kudarcának és az osteoradionekrózisnak a kockázata a dózissal nő, amit a tervező orvos a pótlástípus-választásban figyelembe vesz.
- **H1.4** A nyelvmozgás-akadályozottság és a „gombócos beszéd” gyakoribb a mandibuladefektusos és nyaki blokkdisszekción átesett betegeknél, **mert** a szájfenék/nyelv reszekciója és a nyaki lágyrész-hegesedés közvetlenül korlátozza a nyelv mozgásterét.
- **H1.5** A műtét és a protetikai felvétel közötti késés hosszabb, ha a beutaló intézmény nem az ellátó központ, **mert** az intézményközi beutalás további adminisztratív és várakozási lépcsőket iktat be.

**Elemzési terv.** Leíró statisztika etiológia szerint; χ²/Fisher, Kruskal–Wallis; H1.3: logisztikus regresszió (kimenet: implantációs terv; prediktor: RT és dózis; zavarók: életkor, Fábián–Fejérdy, maradék fogak száma). Hiányzó adat: a `patient_field_na` okkódok mellett jelentendő (nem alkalmazható ≠ hiányzik).

**Mintanagyság.** Már n ≈ 100–150 betegnél publikálható leíró profil; H1.3-hoz ≥10 esemény/prediktor (≈ 40–50 implantációs terv).

**Már megvan a MaxRehab-ban.** `/api/patients/demographics` (korcsoport, etiológia %, DMFT korcsoport és etiológia szerint), `/api/admin/stats/medical` (BNO-eloszlás, beutaló orvosok, DMFT, fogpozíciónkénti D/F/M, implantátum-pozíciók, várakozási idő, pótlástípus szerinti tervsorok).

**Buktatók.** A DMFT „M” komponense itt **nem** caries-eredetű (reszekció) → D+F és M külön jelentendő; a régi (`status`) és az új (`base`) odontogram-modell harmonizálása kötelező (5. fejezet). Az alkohol szabad szöveg → kódolás.

---

### K2 · OHIP-14 életminőség-trajektória a protetikai rehabilitáció után és annak prediktorai

**Munkacím.** *„Szájegészséggel összefüggő életminőség (OHIP-14) változása maxillofaciális defektusok protetikai rehabilitációja után: prospektív regiszter-alapú kohorsz”*.

**Kérdés.** Mekkora és mely dimenziókban jelentkezik az OHIP-14 javulás az átadás után (T0 → T1 → T2 → T3 → T4 → T5), és mely felvételi tényezők jósolják a javulás mértékét?

**V.**
- Kimenet: `total_score` és a 7 dimenzió időpontonként; Δ(T0→Tk); MCID-responder (előre rögzített küszöb, irodalmi ≈5 pont — a protokollban rögzítendő); értelmezési sáv-váltás.
- Prediktorok: etiológia; `brown_fuggoleges_osztaly`, `brown_vizszintes_komponens`, `kovacs_dobak_osztaly`; `radioterapia`, `radioterapia_dozis_gy`, `chemoterapia`, `nyaki_blokkdisszekcio`; `nyalmirigy_allapot`; `nyelvmozgasok_akadalyozottak`, `gombocos_beszed`; `fabian_fejerdy_*`; **átadott** pótlás-csoport (kivehető / kombinált / rögzített / implantációs; `kezelesi_terv_*` `elkeszult = true` + epizód `treatment_type_id`); epitézis-retenció; maradék fogak száma; korábbi pótlás elégedettség (`*_fogpotlas_elegedett`).
- Zavarók: életkor, nem, dohányzás, alkohol, `completed_by_patient` (kitöltési mód), idő a műtét óta, epizód-sorszám (első vs újra-kezelés).
- Folyamat/torzítás: utánkövetés-teljesség (tölcsér), emlékeztetők száma.

**P.**
- P2.1 Az összpont T0→T1 csökken, T3-ra tovább csökken, T4/T5 között plató (nincs további szignifikáns változás).
- P2.2 A legnagyobb effektus a *funkcionális korlátozás*, *fizikai fájdalom* és *fizikai fogyatékosság* dimenziókban, a legkisebb a *hátrány* (handicap) dimenzióban.
- P2.3 Az MCID-responderek aránya T3-nál >60 %; romlás <10 % (a `/api/admin/stats/medical` `t0t3Delta` javulók/változatlanok/romlók mutatója).
- P2.4 Magasabb Brown függőleges osztály → magasabb T0 és kisebb Δ.
- P2.5 RT és hiposzaliváció → kisebb Δ, különösen a fájdalom/fizikai fogyatékosság dimenziókban.
- P2.6 Implantációs/rögzített pótlás → nagyobb Δ, mint kivehető akrilát.
- P2.7 Korábbi pótlással elégedetlen betegek T0-ja magasabb, de Δ-juk nagyobb (regresszió az átlaghoz + valós javulás).

**H.**
- **H2.1** A protetikai rehabilitáció után az OHIP-14 összpontszám T0-hoz képest T3-ra klinikailag jelentős mértékben (≥ MCID) csökken, **mert** a pótlás/obturátor helyreállítja a rágást, nyelést és beszédet, amelyek az OHIP funkcionális és fizikai dimenzióinak fő meghatározói.
- **H2.2** A javulás a T1–T2 időszakban a legmeredekebb, és T3 után platót ér el, **mert** az adaptáció (izomkontroll, nyálkahártya-hozzászokás, beszédkorrekció) az első hetekben-hónapokban zajlik, utána a pótlás elhasználódása és a szöveti változások ellensúlyozzák a további nyereséget.
- **H2.3** A magasabb Brown függőleges osztályú maxilladefektusos betegek T0 OHIP-14 pontszáma magasabb, és az elért javulás kisebb, **mert** a kiterjedtebb (orbitát is érintő) defektus nagyobb obturátort, rosszabb retenciót és több funkcionális (nazális regurgitáció, hipernazális beszéd) maradványtünetet jelent, amit a pótlás csak részben kompenzál.
- **H2.4** Sugárkezelt és hiposzalivációs betegeknél a fizikai fájdalom és fizikai fogyatékosság dimenziókban a javulás kisebb, **mert** a xerostomia és a mucosa sérülékenysége a pótlás viselését fájdalmassá, az étkezést nehézzé teszi, függetlenül a pótlás protetikai minőségétől.
- **H2.5** Implantációs elhorgonyzású pótlást kapó betegek javulása nagyobb, mint a kivehető akrilátlemezes pótlást kapóké, **mert** az implantátumretenció stabilizálja a pótlást, csökkenti a nyomási fájdalmat és növeli a rágóerőt.
- **H2.6** A nyelvmozgás-akadályozottság és a „gombócos beszéd” a beszédhez kötődő tételek (Q1 kiejtés) és a társas dimenziók javulását külön is korlátozza, **mert** ezek a tünetek a nyelv- és lágyrész-funkció zavarából, nem a fogazati hiányból erednek, így a pótlás nem szünteti meg őket.
- **H2.7** A betegportálon önkitöltött és a személyzet által rögzített válaszok között szisztematikus eltérés van (a személyzeti rögzítés alacsonyabb pontszámot ad), **mert** az orvos jelenlétében kitöltött kérdőívnél a társas kívánatosság torzít.

**Elemzési terv.** Lineáris kevert modell (beteg random intercept, időpont faktor, prediktor × időpont interakció; zavarók); dimenziónként külön modell; MCID-responder logisztikus regresszió; érzékenységi elemzés a hiányzó időpontokra (MAR-feltételezés + inverz valószínűségi súlyozás a K6 lemorzsolódás-modelljéből; MNAR érzékenység). Time-window újracímkézés (5. fejezet, 6. pont).

**Mintanagyság.** Kevert modellhez ~60–80 beteg teljes T0+T3 párral már közepes hatás kimutatására elég; interakciókhoz (RT × idő) ≥100.

**Már megvan.** `/api/admin/stats/medical` (időpontonkénti átlag/medián, T0→T3 delta, hisztogram), `/api/admin/stats/ohip-funnel`, értelmezési sávok, portál-kitöltés és emlékeztető-lánc.

**Buktatók.** Az időpont-definíció kétszer változott (T0/T1/T2 → T0–T3 → T0–T5): a régi válaszokat a `completed_at − átadás` napok alapján kell újracímkézni. `episode_id` régi válaszoknál NULL lehet. Lemorzsolódás valószínűleg nem véletlen (K6).

---

### K3 · Rehabilitációs átfutási idő, vizitszám és a halálozás mint versengő kockázat

**Munkacím.** *„Mennyi idő és hány vizit a maxillofaciális protetikai rehabilitáció? Stádium-alapú folyamatelemzés és a rehabilitáció elérésének versengő kockázatai”*.

**Kérdés.** Mi határozza meg az epizód megnyitásától az átadásig (STAGE_6) eltelt időt és a vizitszámot; mely stádiumban „ragadnak be” a betegek; az onkológiai betegek mekkora hányada hal meg az átadás előtt; mennyire pontos a beépített forecast?

**V.**
- Kimenetek: idő az átadásig (esemény: első STAGE_6; cenzor: nyitott/szünetelő epizód, halál mint **versengő esemény**); stádiumonkénti tartózkodási idő; teljesült vizitek száma; „elakadt” munkafázisok (pending/scheduled >45 nap, `/api/admin/stats/pipeline`); forecast-hiba (tényleges átadás − `completion_end_p50/p80`).
- Prediktorok: pótlás-csoport és sablon-lépésszám (2–11), kétállcsontos terv (`episode_pathways.jaw`), `tooth_treatments` száma (pre-protetikai fogászati munka), implantáció (SURG_IMPLANT_PLACED mérföldkő → +183 nap osszeointegráció), RT, etiológia, Brown/Kovács–Dobák, életkor, régió; blokk-napok okonként (`episode_blocks`: WAIT_LAB, WAIT_HEALING, WAIT_SURGERY, PATIENT_DELAY, WAIT_OR, WAIT_IMPLANT) és `renewal_count`; no-show és sikertelen próbák száma; terv-revíziók száma; konzílium; `assigned_provider_id` (klaszter); labor-árajánlat átfutása; beutalási késés; `tnm_staging`; `halal_datum`.
- Rendszer-szintű zavarók: heti kapacitás (`capacity_pool_config`), orvosi kapacitás-felülírások, `lab_queue_metrics`.

**P.**
- P3.1 Az átfutási idő ≈ tervezett munkafázisok × kadencia (a rendszer 14 napos alapértelmezésével számol) + blokk-napok; a variancia legnagyobb részét a PATIENT_DELAY és WAIT_HEALING blokkok, a no-show-k és az ismételt próbák magyarázzák, nem a pótlástípus.
- P3.2 STAGE_2 (terv & árajánlat) és STAGE_3 (finanszírozás) a leghosszabb tartózkodási idejű, nem klinikai stádiumok.
- P3.3 Implantációs terv → átfutás +6 hónap (osszeointegráció).
- P3.4 Az onkológiai betegek egy nem elhanyagolható hányada (előzetes várakozás 5–15 %) az átadás előtt meghal; a halálozás kumulatív incidenciája a beutalási késéssel és a TNM-stádiummal nő.
- P3.5 A forecast P80 ablak a lezárt epizódok ≥80 %-ában tartalmazza a tényleges átadást; a P50 ablak szisztematikusan optimista (a 0,6-os sablon-heurisztika miatt).

**H.**
- **H3.1** Az átadásig eltelt idő varianciájának nagyobb részét a nem klinikai várakozások (finanszírozás, labor, beteg okozta késés, no-show, ismételt próba) magyarázzák, mint a klinikai komplexitás (pótlástípus, defektus-osztály), **mert** a munkafázisok száma sablononként rögzített és kicsi (2–11), míg a várakozási lépcsők hossza nyílt végű és a beteg/rendszer viselkedésétől függ.
- **H3.2** Sugárkezelt betegek átfutási ideje hosszabb, **mert** a gyógyulási várakozások (WAIT_HEALING), a mucosa-érzékenység miatti ismételt lenyomatok és a gyakoribb „beteg nem tűrte” próbák meghosszabbítják a protetikai fázist.
- **H3.3** Az implantációs pótlást tervező epizódok átadásig eltelt ideje legalább fél évvel hosszabb, **mert** az osszeointegrációs várakozás (a rendszerben 183 napos virtuális mérföldkő) a protetikai fázis elé iktatott, nem rövidíthető biológiai idő.
- **H3.4** A műtét és a protetikai felvétel közötti hosszabb késés növeli annak valószínűségét, hogy az onkológiai beteg az átadás előtt meghal vagy az epizód lezáratlan marad, **mert** a késői beutalás a betegség progressziójának és a recidívának az időablakába tolja a rehabilitációt.
- **H3.5** A beépített forecast a hátralévő vizitszámot alulbecsli azoknál az epizódoknál, ahol ismételt próbák és no-show-k vannak, **mert** a projekció a sablon-lépésszámból és egy fix 1,3-as P80 pufferből indul ki, a beteg-specifikus próba-történetet nem használja.
- **H3.6** A konzíliumon a terv jóváhagyása előtt megbeszélt epizódokban kevesebb a terv-revízió és rövidebb a STAGE_2→STAGE_3 idő, **mert** a multidiszciplináris döntés előre feloldja a finanszírozási és sebészi bizonytalanságokat (részletesen K7).

**Elemzési terv.** Kaplan–Meier és Cox-modell (átadás), Fine–Gray versengő kockázat (halál); negatív binomiális regresszió (vizitszám); lineáris/varianciakomponens-modell (átfutás-dekompozíció, orvos random effekt); folyamatbányászat (stage_events + appointments eseménynapló: variánsok, átlagos tartózkodás); forecast-kalibráció: fedési arány, átlagos abszolút hiba, kalibrációs görbe.

**Mintanagyság.** Cox-modellhez ≥10 esemény (átadás)/prediktor → ~80–120 lezárt epizód 8–10 prediktorral; versengő kockázathoz ≥30 halálozási esemény.

**Már megvan.** `/api/admin/stats/pipeline` (epizód-élettartam átlag/medián/kvartilis, munkafázis-mátrix, elakadt fázisok), `episode_forecast_cache`, `care_pathway_analytics` (n ≥ 10 kalibráció, `calibratePathwayAnalytics`), `sla_violations`.

**Buktatók.** A régi `patient_stages` → `stage_events` backfill dátumai durvák lehetnek; `created_via = migration/google_import` időpontok folyamatadata hiányos; a 075-ös migráció a kontroll-lépéseket kivette a sablonokból → a vizitszám definíciója dátumfüggő (átadásig számolni!).

---

### K4 · Sikertelen klinikai próbák és no-show: prediktorok és a beépített kockázati modell validálása

**Munkacím.** *„Miért kell megismételni a lenyomatot? A sikertelen munkafázis-próbák és a meg nem jelenés strukturált nyilvántartása maxillofaciális protetikában”*.

**Kérdés.** Milyen beteg-, defektus- és időpont-tényezők jósolják (a) a sikertelen próbát (`unsuccessful`) és annak okát, (b) a no-show-t; mennyire jó a beépített szabályalapú no-show-rizikó?

**V.**
- Kimenetek: `appointment_status ∈ {unsuccessful, no_show, cancelled_by_patient}`; `attempt_failed_reason` (5 sablon + egyéb); `attempt_number ≥ 2`; `is_late`.
- Időpont-szintű prediktorok: átfutás (napok), óra (7–9), hét napja, `appointment_type`/`pool`, munkafázis-kód (lenyomat vs próba vs átadás), `created_via` (patient_self vs worklist), `requires_confirmation`/`confirmed_at`, `is_chain_reservation`, `no_show_risk` (modell-pont).
- Beteg-szintű: korábbi no-show-k, életkor, nem, régió (távolság-proxy), etiológia, `brown_*`, `kovacs_dobak_osztaly`, `nyalmirigy_allapot`, `nyelvmozgasok_akadalyozottak`, `gombocos_beszed`, RT, dohányzás/alkohol, e-mail/portál-használat, kommunikációs napló-bejegyzések száma, nyitott `user_tasks`.
- Klaszterek: orvos (`attempt_failed_by`, slot `user_id`), munkafázis.

**P.**
- P4.1 A sikertelen próbák a lenyomati fázisokra koncentrálódnak (kódok: `*_lenyomat*`, `*_funkcios_lenyomat`, `*_lenyomati_fejek_sinezese`), és a leggyakoribb ok a „Lenyomat torzult” és a „Beteg nem tűrte”.
- P4.2 „Beteg nem tűrte” gyakoribb magas Brown-osztályú maxilladefektusnál, nyelvmozgás-akadályozottságnál és hiposzalivációnál.
- P4.3 A no-show-arány nő az átfutással (>21 nap), a korai (7–9 h) időpontokkal és a korábbi no-show-számmal (a modell három feltevése) — de az orvos-klaszter és a távolság további független prediktor.
- P4.4 A beteg által önfoglalt (`patient_self`) időpontok no-show-aránya alacsonyabb, mint a személyzet által foglaltaké.
- P4.5 A szabályalapú `no_show_risk` diszkriminációja gyenge–közepes (AUC 0,60–0,70), kalibrációja a 0,2-es megerősítési küszöb körül túlbecsül.

**H.**
- **H4.1** A kiterjedt maxilladefektus (magasabb Brown függőleges osztály) növeli a sikertelen lenyomat valószínűségét, **mert** a nagy, alávájt defektusüreg lenyomatanyaggal való kitöltése nehezebb, torzulásra és a nazális/orbitális tér felé történő anyagbeszorulásra hajlamos.
- **H4.2** A hiposzalivációs és nyelvmozgás-akadályozott betegeknél gyakoribb a „beteg nem tűrte” okú sikertelen próba, **mert** a száraz, sérülékeny nyálkahártya és a csökkent nyelvkontroll fokozza az öklendezést és a fájdalmat a lenyomatvétel alatt.
- **H4.3** A no-show valószínűsége az időpont átfutásával és a korábbi no-show-k számával nő, **mert** a hosszú előretervezés alatt a beteg élethelyzete változik (különösen onkológiai kezelés alatt), a korábbi meg nem jelenés pedig stabil viselkedési hajlamot jelez.
- **H4.4** A beteg által a portálon önfoglalt időpontok no-show-aránya alacsonyabb, **mert** az önfoglalás a beteg saját időbeosztásához igazodik és nagyobb elköteleződést jelent, mint a személyzet által kiosztott időpont.
- **H4.5** A beépített szabályalapú no-show-modell diszkriminációja beteg- és defektus-szintű prediktorok (távolság, etiológia, xerostomia, kommunikációs aktivitás) hozzáadásával javítható, **mert** a jelenlegi modell kizárólag időzítési és előzmény-változókat használ, a meg nem jelenés okai között pedig a betegteher és az elérhetőség is meghatározó.
- **H4.6** A sikertelen próbák aránya orvosonként eltér a beteganyag különbségein túl is, **mert** a lenyomatvételi technika, az anyagválasztás és az időbeosztás (a „nem maradt elég idő” ok) kezelőfüggő.

**Elemzési terv.** Kevert logisztikus regresszió (beteg és orvos random effekt); multinomiális modell a sikertelenségi okokra; a `no_show_risk` értékelése ROC/AUC, kalibrációs görbe, Brier-score; újrabecsült együtthatók visszaírása a `no_show_risk_config` táblába (közvetlen klinikai implementáció); heti trend (`/api/admin/stats/unsuccessful-attempts weeklyTrend`).

**Mintanagyság.** ≥100 sikertelen próba és ≥100 no-show esemény (≈ 1000–2000 időpont) a 8–10 prediktoros modellekhez.

**Már megvan.** `/api/admin/stats/unsuccessful-attempts` (orvos, munkafázis, ok-sablon, heti trend, próbaszám-eloszlás), `no_show_risk_config`, `getPatientNoShowsLast12m`.

**Buktatók.** Az `unsuccessful` státusz a 029-es migrációval született → korábbi sikertelen próbák „completed + újranyitás” vagy lemondás formájában rejtőznek (bal-csonkolás; csak a 029 utáni időszak elemezhető). A 059 előtt a no-show nem szabadította fel a munkafázist (újrafoglalás technikailag akadályozott volt → torzított próbaszám).

---

### K5 · A pótlástípus-választás modellje: defektus- és fogazati tényezők → tervezett és átadott pótlás

**Munkacím.** *„Mi dönti el a pótlástípust maxillofaciális defektusnál? A tervezett és az átadott pótlás prediktorai és egyezése”*.

**Kérdés.** A felvételi változókból mennyire jósolható a tervezett pótlás-csoport; mikor tér el az átadott az eredetileg tervezettől (terv-revíziók)?

**V.**
- Kimenet: pótlás-csoport állcsontonként (kivehető akrilát / fémlemezes-kombinált / fedőlemezes / rögzített / implantációs / sebészi sablon); epitézis-retenció (bőrragasztó / mágnes / rúd-lovas / gömb); terv-változás (template_apply/template_remove, `plan-history`), tervezett vs átadott egyezés.
- Prediktorok: `fabian_fejerdy_*` állcsontonként, maradék fogak száma és eloszlása (odontogram), meglévő implantátumok, `brown_*`/`kovacs_dobak_osztaly`, RT és dózis, `nyalmirigy_allapot`, `nyelvmozgasok_akadalyozottak`, életkor, korábbi pótlás típusa és elégedettség, dohányzás, perio (PD/BOP), méltányossági kérelem/dokumentum (finanszírozás-proxy), konzílium.

**P.**
- P5.1 A Fábián–Fejérdy-osztály a legerősebb prediktor; „T” → teljes lemez/fedőlemezes; 1A–2A → rögzített/kombinált.
- P5.2 Brown 3–4 + RT → kivehető obturátoros megoldás; implantációs terv esélye a dózissal csökken (K1/H1.3 kiterjesztése átadott pótlásra).
- P5.3 Meglévő implantátum → fedőlemezes vagy csavarozott implantációs terv.
- P5.4 A terv-revíziók gyakoribbak sugárkezelt és rossz parodontális státuszú betegeknél.

**H.**
- **H5.1** A pótlástípus-döntést a maradék fogazat támasztási viszonyai (Fábián–Fejérdy-osztály, maradék fogak száma) erősebben határozzák meg, mint a defektus-osztály, **mert** a pótlás elhorgonyzása és stabilitása a pillérfogakon múlik, a defektus a pótlás kialakítását (obturátor-rész) és nem az elhorgonyzás típusát dönti el.
- **H5.2** Sugárkezelt betegnél az eredetileg tervezett pótlástípus gyakrabban módosul az epizód alatt, **mert** a nyálkahártya-tolerancia, a pillérfogak prognózisa és az implantáció kockázata a kezelés során derül ki, ami a tervet a kivehető, kevésbé invazív megoldás felé tolja.
- **H5.3** Rossz parodontális státusz (magas BOP %, mély tasakok, mobilitás) mellett a rögzített/kombinált terv esélye csökken és a terv-revíziók száma nő, **mert** a parodontálisan kompromittált pillérfog nem alkalmas hosszú távú elhorgonyzásra, és a terv a fogak elvesztésével együtt változik.

**Elemzési terv.** Multinomiális logisztikus regresszió / rendezett döntési fa (klinikailag olvasható szabályok); egyezés (Cohen κ) tervezett vs átadott; terv-revíziók Poisson-regressziója.

**Mintanagyság.** Multinomiális 5–6 kimeneti osztályhoz ≥200 tervezett állcsont (egy beteg két állcsontja → kevert modell betegre).

**Már megvan.** Pótlástípus-eloszlás és készültség (`/api/admin/stats/medical treatmentPlans`), `lib/plan-history.ts`, `episode_work_phase_audit`.

---

### K6 · Adathiány-mechanizmus és az adatminőség-intervenciók hatása (módszertani közlemény)

**Munkacím.** *„Nem minden hiány egyforma: hiány-okkódok és emlékeztető-alapú adatminőség-javítás egy klinikai kutatási regiszterben”*.

**Kérdés.** Milyen a hiány szerkezete (mely mezők, mely okkód), MCAR/MAR/MNAR-e az OHIP-utánkövetés lemorzsolódása, és mérhetően javította-e a teljességet az emlékeztető-rendszer bevezetése?

**V.**
- Kimenetek: betegszintű `completenessScore`, `researchReady`, `publicationReady`; mezőnkénti hiány-gyakoriság (`byField`); NA-okkód-eloszlás (`patient_field_na.reason_code`); OHIP tölcsér (T0 kihagyva, T3 missed); plauzibilitási figyelmeztetések; `data_completeness_snapshot` napi idősor.
- Intervenció-időpontok: `missing_data_reminder_log`, `patient_selffill_reminder_log`, `ohip_reminder_log` első bejegyzései; migrációk dátuma (048, 049, 068, 070) mint „bevezetés”.
- Prediktorok a lemorzsolódáshoz: életkor, nincs e-mail, régió, T0 pontszám (magas = rosszabb QoL), etiológia, RT, kezelőorvos, kitöltési mód, epizód-státusz, halálozás.
- Folyamat: `user_tasks` (missing_data) megoldási ideje, `completeness_gate_override` száma, `patient_changes` (ki és mikor tölti a hiányzó mezőt: beutaló orvos vs fogpótlástanász vs beteg).

**P.**
- P6.1 A leggyakoribb hiányzó kutatási mezők a beutaló által pótolható onkológiai adatok (szövettan, műtét ideje, TNM) és az életmód-mezők.
- P6.2 A „beteg_megtagadta” okkód az alkohol/dohányzás mezőkön koncentrálódik → MNAR-gyanú a QoL-zavarókra.
- P6.3 Az OHIP T3 kitöltés valószínűsége alacsonyabb, ha nincs e-mail, idősebb, magasabb T0-pont, távoli régió → a lemorzsolódás **MAR** (megfigyelt változókkal modellezhető), nem MCAR.
- P6.4 Az emlékeztetők bevezetése után a napi `avg_score` és a `research_ready` arány szintje és meredeksége nő (megszakított idősor).
- P6.5 Betegportálos önkitöltés után az életmód-mezők teljessége meredekebben nő, mint az orvos által töltendő mezőké.

**H.**
- **H6.1** A kutatási mezők hiánya nem véletlenszerű, hanem a rögzítésért felelős szerepkör szerint szerveződik (beutaló orvos / fogpótlástanász / beteg), **mert** minden mező egy konkrét munkafolyamat-lépéshez és szereplőhöz kötődik, és a hiány ott keletkezik, ahol a szereplőnek nincs a rögzítésre kényszerítő kapuja.
- **H6.2** Az OHIP-14 utánkövetés lemorzsolódása a felvételi változókkal (életkor, e-mail hiánya, T0 pontszám, etiológia) prediktálható, **mert** az önkitöltéses, e-mail-alapú utánkövetés az elérhetőségtől és a beteg állapotától függ, így a hiány MAR-jellegű és inverz valószínűségi súlyozással korrigálható.
- **H6.3** A magasabb T0 OHIP-pontszámú (rosszabb életminőségű) betegek ritkábban töltik ki a T3-at, **mert** a rosszabb állapotú, tüneteivel küzdő beteg motivációja és kapacitása az önkitöltésre kisebb — ez a kezeletlen lemorzsolódás a javulást felfelé torzítja.
- **H6.4** Az emlékeztető-rendszer (orvosi és betegportálos) bevezetése után a regiszter átlagos teljességi pontszáma mérhetően emelkedik, **mert** a heti, célzott, szerepkörhöz rendelt emlékeztető pontosan azokat éri el, akiknél a hiány keletkezett (H6.1), és a hiány láthatóvá tétele önmagában viselkedést változtat.
- **H6.5** A „beteg megtagadta” okkód aránya az életmód-mezőkön magasabb, mint a klinikai mezőkön, **mert** az alkohol- és dohányzási szokások bevallása stigmatizált, így a hiány itt a valódi értéktől függ (MNAR), amit érzékenységi elemzéssel kell kezelni.

**Elemzési terv.** Leíró hiány-térkép (mező × okkód × szerepkör); logisztikus regresszió a T3-kitöltésre (→ IPW-súlyok a K2-höz); szegmentált regresszió (ITS) a napi snapshot idősoron, bevezetési dátumokkal; Little-féle MCAR-teszt; érzékenységi elemzés delta-módszerrel az MNAR-mezőkre.

**Mintanagyság.** ITS-hez ≥ 8–12 hét bevezetés előtti és utáni napi pont; lemorzsolódás-modellhez ≥ 50 „missed T3” esemény.

**Már megvan.** Teljességi riport (`getPatientDataCompleteness`), napi snapshot, plauzibilitás, tölcsér (időpont és orvos szerint), okkódok, emlékeztető-naplók, `/api/admin/stats/operational` (feladat-megoldási idő).

**Buktatók.** A `publication_ready` a 069 előtti napokra 0; a súlyozás 2026-07-03-tól (PROTOCOL_VERSION) — a pontszám idősora nem homogén, a mezőnkénti nyers hiány-arányokat kell ITS-hez használni.

---

### K7 · A multidiszciplináris konzílium hatása a rehabilitációs folyamatra

**Munkacím.** *„Konzílium előtt vagy után? A multidiszciplináris esetmegbeszélés kapcsolata a terv-stabilitással és az átfutási idővel”*.

**V.** `consilium_session_items` (beteg, `discussion_status`, halasztás), az ülés dátuma vs `stage_events` (a beteg STAGE_2 előtt/után került napirendre), checklist-válaszok és delegált feladatok (létrehozás → teljesítés), `invitation_send_count`, `scheduled_at_change_count`; epizód-kimenetek: `plan_approved_at` ideje, STAGE_2→STAGE_3 tartam, terv-revíziók száma, implantációs/sebészi fázis jelenléte, átfutás; zavarók: defektus-komplexitás (Brown, Kovács–Dobák, RT, TNM).

**P.** P7.1 A konzíliumra kerülő betegek komplexebbek (indikáció szerinti zavarás). P7.2 Komplexitásra igazítva a terv jóváhagyása előtt megbeszélt epizódokban kevesebb a terv-revízió és rövidebb a STAGE_2→3. P7.3 A halasztott (deferred) napirendi pontok epizódjai hosszabbak. P7.4 A konzíliumon delegált feladatok gyorsabban zárulnak, mint az általános kézi feladatok.

**H.**
- **H7.1** A terv jóváhagyása előtt konzíliumon megbeszélt epizódokban kevesebb a későbbi terv-revízió, **mert** a sebészi, onkológiai és protetikai szempontok egyidejű egyeztetése előre feloldja azokat a bizonytalanságokat (implantáció lehetősége, reszekció-szél, sugárdózis), amelyek egyébként a terv menet közbeni módosításához vezetnek.
- **H7.2** A konzíliumon halasztott betegek átfutási ideje hosszabb, **mert** a halasztás hiányzó információt (dokumentum, lelet) jelez, amelynek pótlása a következő ülésig, azaz hetekkel tolja a döntést.
- **H7.3** A konzíliumi döntésből delegált feladatok megoldási ideje rövidebb az általános feladatokénál, **mert** konkrét felelőshöz, határidőhöz és betegdöntéshez kötöttek, így a szervezeti prioritásuk magasabb.

**Elemzési terv.** Indikáció szerinti zavarás kezelése: propensity-score illesztés komplexitásra; időfüggő kovariáns Cox-modellben (konzílium mint időben változó expozíció); feladat-átfutás összehasonlítása (`user_tasks.task_type = meeting_action` vs `manual`).

**Buktatók.** Kis eseményszám valószínű; a konzílium bevezetése (011) utáni időszakra korlátozott.

---

### K8 · Gondozás, recall-adherencia és késői kimenetek (fogvesztés, pótlásvesztés, újra-kezelés)

**Munkacím.** *„Mi történik az átadás után? Recall-adherencia, késői fogvesztés és ismételt rehabilitációs epizódok”* (hosszabb utánkövetés után).

**V.** `episode_tasks` (recall_due, esedékesség vs tényleges kontroll-időpont → adherencia), `recall_risk_level` (klinikus által adott), kontroll-időpontok (`appointment_type = kontroll/recall`), `dental_status_snapshots` idősor (fogvesztés az átadás után, fogszámonként), perio-chart ismétlés (ha lesz), új epizód `trigger_type` (fogelvesztes, potlasvesztes, recidiva, kontrollbol_uj_panasz), OHIP T4/T5, `halal_datum`; prediktorok: RT (sugár-caries), hiposzaliváció, dohányzás, DMFT, pótlástípus, régió, életkor.

**P.** P8.1 A „high” recall-rizikójú epizódokban gyakoribb az új (fog-/pótlásvesztés miatti) epizód → a klinikus által adott rizikószint prediktív. P8.2 Sugárkezelt + hiposzalivációs betegeknél az átadás utáni fogvesztés üteme nagyobb. P8.3 A recall-adherencia a távolsággal és az életkorral csökken; alacsony adherencia → több pótlásvesztés-epizód. P8.4 OHIP T4/T5 stabil marad adherens, romlik nem adherens betegeknél.

**H.**
- **H8.1** A kezelőorvos által epizód-szinten megadott recall-rizikószint előrejelzi az ismételt rehabilitációs epizódot, **mert** a rizikószint a klinikus implicit prognózisát (parodontális állapot, xerostomia, compliance) tömöríti, és a sűrűbb kadencia sem tudja teljesen ellensúlyozni a mögöttes kockázatot.
- **H8.2** Sugárkezelt és hiposzalivációs betegeknél az átadás utáni fogvesztés üteme nagyobb, **mert** a xerostomia és a besugárzott dentin a sugár-caries gyors progresszióját okozza, ami a pillérfogak elvesztéséhez és a pótlás elhorgonyzásának megszűnéséhez vezet.
- **H8.3** A recall-adherencia csökkenésével nő a pótlásvesztés miatti új epizód esélye, **mert** a kontrollon felismerhető korai elváltozások (alábélelés-igény, kapocslazulás, pillérfog-caries) kezeletlenül a pótlás funkcióvesztéséhez vezetnek.

**Elemzési terv.** Ismétlődő események modellje (Andersen–Gill / Prentice–Williams–Peterson) az új epizódokra; fogszintű túlélés (fog mint egység, beteg-klaszter) a snapshot-idősorból; adherencia mint időfüggő kovariáns.

**Buktatók.** 3 éves horizont (T5) — csak a legkorábbi betegeknél lesz adat; a 075-ös migráció után a kontroll a recall-workflow-ban (`episode_tasks`) él, nem a sablonban.

---

### K9 · (Kiegészítő, nem hipotézis-vezérelt) Informatikai/módszertani közlemény

*„Hozzájárulás-kapuzott, álnevesített, determinisztikusan hash-elt kutatási export egy klinikai rendszerből”* — a `research-registry` modul (consent-események, ETT TUKEB kapu, CRF-verziók, minőségi állapotgép, `analysis_exports` tartalom-hash és manifest, forrás-igazság regiszter, függőségi gráf). Ez rendszerleírás (design paper) + a K6 KPI-jaival (teljesség, NA-okkódok, export-reprodukálhatóság) alátámasztva. A hipotézis-formátum itt nem alkalmazható; a többi irány módszertani hátterét adja.

---

## 3. Hipotézis-regiszter

Pre-regisztrációs váz: minden sor egy tesztelhető állítás, a hozzá tartozó elsődleges kimenettel, expozícióval és a MaxRehab-forrással. (Az „állítás, mert indoklás” teljes szövege a 2. fejezetben.)

| Kód | Irány | Állítás (rövid) | Kimenet (tábla.oszlop) | Expozíció / prediktor | Teszt |
|---|---|---|---|---|---|
| H1.1 | K1 | Onkológiai csoport: több hiányzó fog, magasabb D+F | `patient_dental_status.meglevo_fogak` → harmonizált DMFT | `patient_anamnesis.kezelesre_erkezes_indoka` | Kruskal–Wallis, korra igazított regresszió |
| H1.2 | K1 | RT → ≥2× hiposzaliváció | `nyalmirigy_allapot = hiposzaliváció` | `radioterapia`, `radioterapia_dozis_gy` | logisztikus regresszió |
| H1.3 | K1 | RT és dózis → kevesebb implantációs terv | `kezelesi_terv_*.treatmentTypeCode ∈ {cementezett_implant, csavarozott_implant}` | RT, dózis; zavaró: FF-osztály, maradék fogak | logisztikus regresszió |
| H1.4 | K1 | Mandibuladefektus / nyaki disszekció → nyelv- és beszédzavar | `nyelvmozgasok_akadalyozottak`, `gombocos_beszed` | `mandibuladefektus_van`, `nyaki_blokkdisszekcio` | χ², logisztikus |
| H1.5 | K1 | Külső beutaló → hosszabb műtét→felvétel késés | `felvetel_datuma − mutet_ideje` | `beutalo_intezmeny` (belső/külső) | Mann–Whitney, kvantilis-regresszió |
| H2.1 | K2 | T0→T3 OHIP-javulás ≥ MCID | `ohip14_responses.total_score` | idő (timepoint) | kevert modell, responder-arány |
| H2.2 | K2 | Javulás T1–T2-ben meredek, T3 után plató | `total_score` T0–T5 | idő | kevert modell, kontrasztok |
| H2.3 | K2 | Magasabb Brown függőleges → magasabb T0, kisebb Δ | `total_score` | `brown_fuggoleges_osztaly` × idő | interakció kevert modellben |
| H2.4 | K2 | RT / hiposzaliváció → kisebb Δ fájdalom és fizikai fogyatékosság dimenzióban | `physical_pain_score`, `physical_disability_score` | RT, `nyalmirigy_allapot` × idő | dimenziónkénti kevert modell |
| H2.5 | K2 | Implantációs pótlás → nagyobb Δ, mint kivehető akrilát | `total_score` Δ | átadott pótlás-csoport | kevert modell, zavarókkal |
| H2.6 | K2 | Nyelv-/beszédzavar korlátozza a Q1 és társas dimenziók javulását | `q1_functional_limitation`, `social_disability_score` | `nyelvmozgasok_akadalyozottak`, `gombocos_beszed` | ordinális/kevert modell |
| H2.7 | K2 | Személyzeti rögzítés alacsonyabb pontot ad, mint önkitöltés | `total_score` | `completed_by_patient` | kevert modell, mérési mód mint kovariáns |
| H3.1 | K3 | Nem klinikai várakozások magyarázzák az átfutás varianciájának többségét | epizód `opened_at` → első `STAGE_6` | blokk-napok okonként, no-show, próbák vs pótlástípus, defektus | varianciadekompozíció, Cox |
| H3.2 | K3 | RT → hosszabb átfutás | idő átadásig | `radioterapia` | Cox (halál versengő) |
| H3.3 | K3 | Implantációs terv → ≥ +6 hónap | idő átadásig | `patient_milestones.code = SURG_IMPLANT_PLACED` | Cox / AFT |
| H3.4 | K3 | Hosszabb beutalási késés → halál/lezáratlan epizód az átadás előtt | halál mint versengő esemény (`patients.halal_datum`) | `felvetel_datuma − mutet_ideje`, `tnm_staging` | Fine–Gray |
| H3.5 | K3 | A forecast alulbecsül próbákkal/no-show-val terhelt epizódoknál | `episode_forecast_cache.completion_end_p80` vs tényleges STAGE_6 | `attempt_number`, no-show szám | kalibráció, fedési arány |
| H3.6 | K3/K7 | Konzílium a terv előtt → kevesebb revízió, rövidebb STAGE_2→3 | `episode_work_phase_audit` (template_*), stádium-tartam | konzílium időzítése | PS-illesztett összehasonlítás |
| H4.1 | K4 | Magasabb Brown → több sikertelen lenyomat | `appointment_status = unsuccessful` (lenyomati fázisok) | `brown_fuggoleges_osztaly` | kevert logisztikus |
| H4.2 | K4 | Hiposzaliváció / nyelvzavar → „beteg nem tűrte” ok | `attempt_failed_reason` sablon | `nyalmirigy_allapot`, `nyelvmozgasok_akadalyozottak` | multinomiális |
| H4.3 | K4 | Átfutás és korábbi no-show → több no-show | `appointment_status = no_show` | `start_time − created_at`, korábbi no-show | kevert logisztikus |
| H4.4 | K4 | Önfoglalás → kevesebb no-show | `no_show` | `created_via = patient_self` | kevert logisztikus |
| H4.5 | K4 | Bővített modell jobb AUC-t ad, mint a szabályalapú | `no_show` | `no_show_risk` vs bővített prediktorkészlet | AUC-különbség (DeLong), kalibráció |
| H4.6 | K4 | Orvosonként eltérő sikertelenségi arány beteganyagon túl | `unsuccessful` | `attempt_failed_by` random effekt | ICC, kevert modell |
| H5.1 | K5 | FF-osztály és maradék fogak erősebben jósolják a pótlástípust, mint a defektus-osztály | pótlás-csoport | `fabian_fejerdy_*`, fogszám vs `brown_*`/`kovacs_dobak_osztaly` | multinomiális, relatív fontosság |
| H5.2 | K5 | RT → gyakoribb terv-módosítás | `episode_work_phase_audit.change_type` (template_apply/remove), plan-history | `radioterapia` | Poisson / negatív binomiális |
| H5.3 | K5 | Rossz perio → kevesebb rögzített terv, több revízió | pótlás-csoport, revíziók | `perio_charts` (BOP %, PD, mobilitás) | multinomiális, Poisson |
| H6.1 | K6 | Hiány szerepkör szerint szerveződik | mezőnkénti hiány (`byField`) | mező felelőse (beutaló / fogpótlástanász / beteg) | leíró + χ² |
| H6.2 | K6 | T3-lemorzsolódás prediktálható (MAR) | T3 hiánya (tölcsér `missed`) | életkor, e-mail, T0 pont, etiológia | logisztikus (→ IPW) |
| H6.3 | K6 | Magasabb T0 → ritkább T3 kitöltés | T3 hiánya | `total_score` T0 | logisztikus |
| H6.4 | K6 | Emlékeztetők után nő a teljesség | `data_completeness_snapshot.avg_score`, mezőnkénti hiány-arány | bevezetési dátumok (048/070 migrációk, első napló-bejegyzés) | szegmentált regresszió (ITS) |
| H6.5 | K6 | „beteg_megtagadta” az életmód-mezőkön koncentrálódik | `patient_field_na.reason_code` | mezőcsoport | χ² |
| H7.1 | K7 | Konzílium a terv előtt → kevesebb revízió | terv-revíziók száma | konzílium időzítése vs `plan_approved_at` | PS-illesztés, Poisson |
| H7.2 | K7 | Halasztott napirend → hosszabb átfutás | idő átadásig | `discussion_status = deferred` | Cox |
| H7.3 | K7 | Delegált feladat gyorsabban zárul | `user_tasks` létrehozás→teljesítés | `task_type = meeting_action` vs `manual` | túlélés-elemzés |
| H8.1 | K8 | Recall-rizikószint jósolja az új epizódot | új `patient_episodes` (`parent_episode_id`, `trigger_type`) | `recall_risk_level` | ismétlődő események modellje |
| H8.2 | K8 | RT + hiposzaliváció → gyorsabb átadás utáni fogvesztés | `dental_status_snapshots` fog-szintű változás | RT, `nyalmirigy_allapot` | fog-szintű túlélés, beteg-klaszter |
| H8.3 | K8 | Alacsony recall-adherencia → pótlásvesztés-epizód | `trigger_type = potlasvesztes` | recall esedékesség vs tényleges kontroll | időfüggő Cox |

---

## 4. Prioritás és ütemezés

| Sorrend | Irány | Miért most | Mi kell hozzá | Várható n-küszöb |
|---|---|---|---|---|
| 1 | **K1 kohorsz-profil** | felvételi adatokból azonnal írható, ez a regiszter „névjegye”; minden későbbi cikk hivatkozik rá | TUKEB + consent; DMFT-harmonizáció; alkohol/TNM kódolás | ~100–150 beteg |
| 2 | **K6 adatminőség / hiány-mechanizmus** | a folyamat-adat (snapshot, okkódok, emlékeztető-naplók) már gyűlik; nem igényel klinikai utánkövetést; módszertani újdonság (kódolt hiány-ok) | ≥ 8–12 hét snapshot bevezetés előtt/után | betegszám-független (napi idősor) |
| 3 | **K4 sikertelen próbák / no-show** | a 029 óta strukturáltan gyűlik; közvetlen klinikai haszon (lenyomat-protokoll, no-show-modell újrakalibrálása) | 029 utáni időpontok | ≥100 unsuccessful, ≥100 no-show |
| 4 | **K2 OHIP-trajektória** | a fő klinikai kimenet, nemzetközi érdeklődés; de T3 (6 hó) és T4 (1 év) adatot kell megvárni; K6 IPW-súlyai kellenek hozzá | timepoint-újracímkézés; T0+T3 párok | ≥60–80 pár |
| 5 | **K3 átfutás / versengő kockázat** | lezárt epizódok kellenek; halálozási adatok gyűjtése | ≥80 lezárt epizód, ≥30 halálozás | — |
| 6 | K5 pótlástípus-modell | két állcsont → gyorsabban gyűlik; kombinálható K1-gyel | perio-chart gyűjtés | ≥200 tervezett állcsont |
| 7 | K7 konzílium | kis eseményszám, indikáció szerinti zavarás | konzílium-napló érettsége | — |
| 8 | K8 gondozás / késői kimenet | 1–3 éves horizont | snapshot-idősor, recall-workflow | — |

**Javasolt első közlemény:** K1 és K6 összevonva is elképzelhető („kohorsz-profil + adatminőség”) a regiszter bemutatásaként; a második a K4 (egyedi, strukturált „sikertelen próba” adat), a harmadik a K2 (fő kimenet).

---

## 5. Adat-harmonizációs buktatók

Ezeket a kód árulja el; a módszertani fejezetben mind jelentendő.

1. **DMFT két odontogram-modellből.** A `/api/admin/stats/medical` és a `mv_dmft_stats` csak a régi `status ∈ {D,F,M}` értékeket számolja; az új modell (`base` + `caries` + `surfaces`, `lib/tooth-base.ts`) bejegyzései kimaradnak. Harmonizálás: D = `caries = true` vagy `status = D`; F = `status = F` vagy `base ∈ {filled, crown, root_canal, inlay, bridge_abutment}`; M = `status = M` vagy `base ∈ {missing, bridge_pontic, denture_tooth, implant}`. Az M itt **nem caries-eredetű** (reszekció) → D+F és M külön jelentendő (Függelék A2).
2. **Szabad szöveg → szám.** `radioterapia_dozis_gy` és `dohanyzas_szam_ertek` az első számot veszi (tartomány „60–66 Gy” → 60). Az alkoholfogyasztás kódolatlan szöveg → 3–4 kategóriás kódolás kell. TNM szöveg → T, N, M külön.
3. **Háromállapotú booleanek.** `maxilladefektus_van`, `mandibuladefektus_van`, `nyelvmozgasok_akadalyozottak`, `gombocos_beszed`, `*_fogpotlas_van/_elegedett`: a Zod-séma NULL = nincs adat, de a `patients_full` INSTEAD OF trigger `COALESCE(…, false)`-szal ír (005) → a régi rögzítéseknél a „false” lehet „nincs adat”. A `patient_field_na` és a `patient_changes` alapján különíthető el.
4. **Radioterápia `false` alapértelmezés.** Ugyanez: `radioterapia DEFAULT false` → a „nem sugárkezelt” egy része valójában ismeretlen. Onkológiai betegnél a hiány valószínű, ha `radioterapia_dozis` és `radioterapia_datum_intervallum` is üres és nincs NA-jelölés.
5. **Stádium-időbélyegek eredete.** A `patient_stages` → `stage_events` backfill (migration_episode_stage_milestone) a régi stádiumokat durva leképezéssel (uj_beteg → STAGE_0, arajanlatra_var → STAGE_2, fogpotlas_kesz → STAGE_6…) hozta át; a STAGE_1/3/4 a régi adatokban hiányzik. Az átadás dátuma = első STAGE_6, ennek hiányában első STAGE_7 (`getDeliveryDate`).
6. **OHIP időpont-definíció kétszer változott.** migration_ohip14 (T0/T1/T2 = kezelés előtt / rehabilitáció előtt / után) → v2 (T0–T3: +3–8 hét, +5–8 hó, +2,5–4 év) → 074 (T0–T5: 0, 30, 180, 365, 1095 nap). A `timepoint` címkét a `completed_at − átadás` napok alapján kell újraszámolni; a régi válaszoknál `episode_id` NULL lehet.
7. **Sikertelen próba bal-csonkolása.** Az `unsuccessful` státusz és az `attempt_number` a 029-től létezik (backfill: minden korábbi = 1. próba). A 059 előtt a no-show nem szabadította fel a munkafázist. K4 csak a 029/059 utáni időszakra.
8. **Kontroll-lépések a sablonból kikerültek (075).** A „tervezett vizitszám” és a „kész arány” definíciója dátumfüggő → a vizitszámot mindig **az átadásig** számoljuk, a kontrollokat a recall-workflow-ból.
9. **Import-eredetű időpontok.** `created_via ∈ {migration, google_import}` soroknál a `created_at` nem a foglalás ideje → átfutás (lead time) csak `worklist`/`patient_self`/override forrásoknál értelmezhető.
10. **Teljességi pontszám nem homogén idősor.** A súlyozás 2026-07-03-tól, a `publication_ready` a 069-től → ITS-hez mezőnkénti nyers hiány-arányt használjunk, ne a pontszámot.
11. **Elhunyt betegek.** A 080 óta a halál automatikusan lezárja az epizódokat és lejáratja a szándékokat; a korábbi halálozásoknál a `closed_at` utólagos → a versengő kockázat idejét a `halal_datum`-ból, ne a `closed_at`-ból vegyük.
12. **Kezelőorvos-attribúció.** `kezeleoorvos` szöveg vs `kezeleoorvos_user_id` (027, sticky 051) vs epizód `assigned_provider_id` (+ `provider_assignment_events` 092/093): az orvos-klaszter változót az epizód felelőséből, időfüggően kell képezni.
13. **Export-pszeudonimizálás.** A kutatási exportban csak 5 éves korsáv és 2 karakteres irányítószám-előtag van (`research-patient-view.ts`); a finomabb életkor csak a klinikai (nem export) elemzésben használható, ezt a TUKEB-kérelemben rögzíteni kell.

---

## 6. Előfeltételek a MaxRehab-ban

Kapcsolók és adatgyűjtési lépések, amelyek nélkül a fenti közlemények nem készíthetők el:

- [ ] **ETT TUKEB engedély** rögzítése az `ethics_approvals` táblában (`approved_at`, `expires_at`) — enélkül minden export blokkolt (`assertEthicsApprovalActive`).
- [ ] **Kutatási hozzájárulás** gyűjtése: `patient_consent_events` (v2 szöveg, 073), `consent_status = granted`; a `LEGACY_UNVERIFIED` státuszú régi betegek átvezetése (`registry:legacy-backfill`).
- [ ] `RESEARCH_EXPORT_MODE = 'consent_required'` (`lib/research-registry/operational-policy.ts`) és a `research_export_pipeline` feature-flag bekapcsolása (`registry:enable-flags`, sorrend: `PRODUCTION_FLAG_ROLLOUT_ORDER`).
- [ ] **Kódkönyv bővítése**: a `data/research-registry/codebook-registry.json` ma 4 változót ír le; a Függelék B szótárát ide kell felvenni, hogy az export önleíró legyen.
- [ ] **Export-oszlopok bővítése**: a `research_patient_view` jelenleg csak demográfiát és etiológiát ad; a K1–K8-hoz az anamnézis-, defektus-, OHIP-, epizód- és időpont-változók pszeudonimizált exportja kell (a `phi-safety` ellenőrzéssel).
- [ ] **Kódolás**: alkohol (kategóriák), TNM (T/N/M), szövettan (csoportok), beutaló intézmény belső/külső flag (`referral_institutions`).
- [ ] **Perio-chart** rendszeres felvétele (055) — K5/K8 prediktor.
- [ ] **Datált fogazati snapshot** átadáskor (`dental_status_snapshots kind = status`) — K8 alapja.
- [ ] **Halálozás rögzítése** (`halal_datum`) rendszeres egyeztetéssel — K3 versengő kockázat.
- [ ] **OHIP T0 kitöltetése minden új epizódban** (a tölcsér `missingOhipT0` mutatója) — K2 baseline.
- [ ] **Pathway-analitika kalibrálása** (`/api/analytics/calibrate-pathways`, n ≥ 10 lezárt epizód sablononként) — K3 forecast-validáció referenciája.

---

## Függelék A: adatkinyerési SQL-vázlatok

Csak vázlatok a séma-nevekkel; a tényleges futtatás a pszeudonimizált exporton, a kapuk mögött történjen. Postgres 14+. **Ellenőrzés (2026-09-02):** a hét vázlatot a repó migrációiból (`database/schema.sql` → legacy → tracked 001–093) felépített, üres Postgres 16 sémán `EXPLAIN`-nel futtattam; mind a hét feloldódik (tábla-, oszlop-, függvény- és típusnevek egyeznek). Elemszám- és eloszlás-ellenőrzés csak valódi adaton lehetséges.

### A1 · Felvételi (baseline) tábla betegenként

```sql
SELECT
  p.id                                                            AS patient_id,
  p.nem,
  EXTRACT(YEAR FROM AGE(COALESCE(p.felvetel_datuma, p.created_at::date), p.szuletesi_datum))::int
                                                                  AS eletkor_felvetelkor,
  LEFT(p.iranyitoszam, 2)                                         AS regio_elotag,
  p.felvetel_datuma, p.halal_datum, p.intake_status,
  a.kezelesre_erkezes_indoka, a.bno, a.diagnozis, a.tnm_staging,
  a.radioterapia, a.radioterapia_dozis_gy, a.chemoterapia,
  a.maxilladefektus_van, a.brown_fuggoleges_osztaly, a.brown_vizszintes_komponens,
  a.mandibuladefektus_van, a.kovacs_dobak_osztaly,
  a.nyelvmozgasok_akadalyozottak, a.gombocos_beszed, a.nyalmirigy_allapot,
  a.fabian_fejerdy_protetikai_osztaly_felso, a.fabian_fejerdy_protetikai_osztaly_also,
  a.dohanyzas_szam_ertek, a.alkoholfogyasztas,
  a.veleszuletett_rendellenessegek, a.baleset_idopont, a.baleset_etiologiaja,
  r.beutalo_intezmeny, r.beutalo_orvos_user_id, r.nyaki_blokkdisszekcio, r.mutet_ideje,
  (p.felvetel_datuma - r.mutet_ideje)                             AS beutalasi_keses_napok,
  d.felso_fogpotlas_van, d.felso_fogpotlas_tipus, d.felso_fogpotlas_elegedett,
  d.also_fogpotlas_van,  d.also_fogpotlas_tipus,  d.also_fogpotlas_elegedett,
  (SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(d.meglevo_implantatumok, '{}'::jsonb))) AS implantatum_szam,
  na.na_okkodok
FROM patients p
LEFT JOIN patient_anamnesis     a ON a.patient_id = p.id
LEFT JOIN patient_referral      r ON r.patient_id = p.id
LEFT JOIN patient_dental_status d ON d.patient_id = p.id
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(field_key, reason_code) AS na_okkodok
  FROM patient_field_na WHERE patient_id = p.id
) na ON true;
```

### A2 · Harmonizált DMFT (régi `status` + új `base` modell), D+F és M külön

```sql
WITH fog AS (
  SELECT
    d.patient_id,
    t.key::int AS fog_szam,
    CASE WHEN jsonb_typeof(t.value) = 'string' THEN t.value #>> '{}' ELSE t.value->>'status' END AS legacy_status,
    CASE WHEN jsonb_typeof(t.value) = 'object' THEN t.value->>'base' END                        AS base,
    CASE WHEN jsonb_typeof(t.value) = 'object' THEN COALESCE((t.value->>'caries')::boolean, false) ELSE false END AS caries
  FROM patient_dental_status d
  CROSS JOIN LATERAL jsonb_each(COALESCE(d.meglevo_fogak, '{}'::jsonb)) AS t(key, value)
  WHERE t.key ~ '^[1-4][1-8]$'                  -- csak maradó fogak, FDI
)
SELECT
  patient_id,
  COUNT(*) FILTER (WHERE caries OR legacy_status = 'D')                                                        AS d_szam,
  COUNT(*) FILTER (WHERE legacy_status = 'F' OR base IN ('filled','crown','root_canal','inlay','bridge_abutment')) AS f_szam,
  COUNT(*) FILTER (WHERE legacy_status = 'M' OR base IN ('missing','bridge_pontic','denture_tooth','implant'))    AS m_szam,
  COUNT(*) FILTER (WHERE fog_szam BETWEEN 11 AND 28
                     AND NOT (legacy_status = 'M' OR base IN ('missing','bridge_pontic','denture_tooth','implant'))) AS felso_maradek_fog,
  COUNT(*) FILTER (WHERE fog_szam BETWEEN 31 AND 48
                     AND NOT (legacy_status = 'M' OR base IN ('missing','bridge_pontic','denture_tooth','implant'))) AS also_maradek_fog
FROM fog
GROUP BY patient_id;
```

> Megjegyzés: a „nem bejegyzett” fog a régi modellben egészséges jelenlévő fogat jelent (`toStored` a default-tiszta fogat nem tárolja), ezért a maradék fogak számához a 32 − M képlet is használható, ha az odontogram teljesen ki van töltve; a plauzibilitási figyelmeztetés (`fogak_statusz_nelkul`) jelzi a hiányos bejegyzéseket.

### A3 · Epizód-átfutás, stádium-idők, vizitek, blokkok, versengő esemény

```sql
WITH first_stage AS (
  SELECT episode_id, stage_code, MIN(at) AS first_at
  FROM stage_events GROUP BY episode_id, stage_code
),
blokk AS (
  SELECT episode_id, key,
         SUM(EXTRACT(EPOCH FROM (
           CASE WHEN active THEN LEAST(expires_at, NOW()) ELSE LEAST(expires_at, updated_at) END - created_at
         )) / 86400.0) AS napok,
         SUM(renewal_count) AS megujitasok
  FROM episode_blocks GROUP BY episode_id, key
)
SELECT
  pe.id AS episode_id, pe.patient_id, pe.reason, pe.status, pe.trigger_type,
  pe.opened_at, pe.closed_at, pe.plan_approved_at, pe.recall_risk_level,
  s0.first_at AS stage0_at, s2.first_at AS terv_at, s3.first_at AS elfogadva_at,
  s4.first_at AS sebeszi_at, s5.first_at AS protetika_at, s6.first_at AS atadas_at,
  EXTRACT(EPOCH FROM (s6.first_at - pe.opened_at)) / 86400.0            AS napok_atadasig,
  EXTRACT(EPOCH FROM (s3.first_at - s2.first_at)) / 86400.0             AS napok_terv_elfogadas,
  (SELECT COUNT(*) FROM appointments a WHERE a.episode_id = pe.id AND a.appointment_status = 'completed'
     AND (s6.first_at IS NULL OR a.start_time <= s6.first_at))           AS vizitek_atadasig,
  (SELECT COUNT(*) FROM appointments a WHERE a.episode_id = pe.id AND a.appointment_status = 'no_show')      AS no_show_szam,
  (SELECT COUNT(*) FROM appointments a WHERE a.episode_id = pe.id AND a.appointment_status = 'unsuccessful') AS sikertelen_probak,
  (SELECT MAX(attempt_number) FROM appointments a WHERE a.episode_id = pe.id)                                 AS max_probaszam,
  (SELECT COUNT(*) FROM episode_work_phase_audit w WHERE w.episode_id = pe.id
     AND w.change_type IN ('template_apply','template_remove','scope_change'))                               AS terv_reviziok,
  (SELECT COUNT(*) FROM tooth_treatments tt WHERE tt.episode_id = pe.id)                                     AS fogkezelesek,
  EXISTS (SELECT 1 FROM patient_milestones m WHERE m.episode_id = pe.id AND m.code = 'SURG_IMPLANT_PLACED') AS implantacio,
  EXISTS (SELECT 1 FROM episode_pathways ep WHERE ep.episode_id = pe.id AND ep.jaw IS NOT NULL
          GROUP BY ep.episode_id HAVING COUNT(DISTINCT ep.jaw) = 2)                                          AS ketallcsontos,
  COALESCE((SELECT SUM(napok) FROM blokk b WHERE b.episode_id = pe.id AND b.key = 'PATIENT_DELAY'), 0) AS blokk_beteg_napok,
  COALESCE((SELECT SUM(napok) FROM blokk b WHERE b.episode_id = pe.id AND b.key = 'WAIT_HEALING'), 0)  AS blokk_gyogyulas_napok,
  COALESCE((SELECT SUM(napok) FROM blokk b WHERE b.episode_id = pe.id AND b.key = 'WAIT_LAB'), 0)      AS blokk_labor_napok,
  COALESCE((SELECT SUM(napok) FROM blokk b WHERE b.episode_id = pe.id
              AND b.key IN ('WAIT_SURGERY','WAIT_OR','WAIT_IMPLANT')), 0)                               AS blokk_sebeszi_napok,
  fc.completion_end_p50, fc.completion_end_p80, fc.remaining_visits_p50, fc.remaining_visits_p80,
  p.halal_datum,
  -- versengő kockázat: 1 = átadás, 2 = halál átadás előtt, 0 = cenzorált
  CASE WHEN s6.first_at IS NOT NULL THEN 1
       WHEN p.halal_datum IS NOT NULL THEN 2
       ELSE 0 END AS esemeny_tipus
FROM patient_episodes pe
JOIN patients p ON p.id = pe.patient_id
LEFT JOIN first_stage s0 ON s0.episode_id = pe.id AND s0.stage_code = 'STAGE_0'
LEFT JOIN first_stage s2 ON s2.episode_id = pe.id AND s2.stage_code = 'STAGE_2'
LEFT JOIN first_stage s3 ON s3.episode_id = pe.id AND s3.stage_code = 'STAGE_3'
LEFT JOIN first_stage s4 ON s4.episode_id = pe.id AND s4.stage_code = 'STAGE_4'
LEFT JOIN first_stage s5 ON s5.episode_id = pe.id AND s5.stage_code = 'STAGE_5'
LEFT JOIN first_stage s6 ON s6.episode_id = pe.id AND s6.stage_code = 'STAGE_6'
LEFT JOIN episode_forecast_cache fc ON fc.episode_id = pe.id;
```

### A4 · OHIP-14 hosszú formátum, átadáshoz viszonyított nap, újracímkézett időpont

```sql
WITH atadas AS (
  SELECT episode_id,
         COALESCE(MIN(at) FILTER (WHERE stage_code = 'STAGE_6'),
                  MIN(at) FILTER (WHERE stage_code = 'STAGE_7')) AS atadas_at
  FROM stage_events GROUP BY episode_id
)
SELECT
  o.patient_id, o.episode_id, o.timepoint AS rogzitett_timepoint,
  o.completed_at, o.completed_by_patient,
  EXTRACT(EPOCH FROM (o.completed_at - x.atadas_at)) / 86400.0 AS nap_atadas_ota,
  CASE
    WHEN x.atadas_at IS NULL OR o.completed_at < x.atadas_at THEN 'T0'
    WHEN o.completed_at < x.atadas_at + INTERVAL '30 days'   THEN 'T1'
    WHEN o.completed_at < x.atadas_at + INTERVAL '180 days'  THEN 'T2'
    WHEN o.completed_at < x.atadas_at + INTERVAL '365 days'  THEN 'T3'
    WHEN o.completed_at < x.atadas_at + INTERVAL '1095 days' THEN 'T4'
    ELSE 'T5'
  END AS ujracimkezett_timepoint,               -- a 074-es ablakok szerint
  o.total_score,
  o.functional_limitation_score, o.physical_pain_score, o.psychological_discomfort_score,
  o.physical_disability_score, o.psychological_disability_score, o.social_disability_score, o.handicap_score,
  o.q1_functional_limitation, o.q2_functional_limitation, o.q3_physical_pain, o.q4_physical_pain,
  o.q5_psychological_discomfort, o.q6_psychological_discomfort, o.q7_physical_disability, o.q8_physical_disability,
  o.q9_psychological_disability, o.q10_psychological_disability, o.q11_social_disability, o.q12_social_disability,
  o.q13_handicap, o.q14_handicap
FROM ohip14_responses o
LEFT JOIN atadas x ON x.episode_id = o.episode_id;
```

### A5 · Időpont-szintű tábla no-show / sikertelen próba modellekhez (029/059 utáni időszak)

```sql
SELECT
  a.id AS appointment_id, a.patient_id, a.episode_id,
  a.appointment_type, a.pool, COALESCE(ewp.work_phase_code, a.step_code) AS munkafazis,
  a.attempt_number, a.appointment_status, a.is_late, a.attempt_failed_reason, a.attempt_failed_by,
  a.created_via, a.requires_confirmation, (a.confirmed_at IS NOT NULL) AS megerositett,
  a.is_chain_reservation, a.no_show_risk,
  EXTRACT(EPOCH FROM (a.start_time - a.created_at)) / 86400.0                     AS atfutas_napok,
  EXTRACT(HOUR   FROM (a.start_time AT TIME ZONE 'Europe/Budapest'))::int         AS ora,
  EXTRACT(ISODOW FROM (a.start_time AT TIME ZONE 'Europe/Budapest'))::int         AS het_napja,
  (SELECT COUNT(*) FROM appointments b
     WHERE b.patient_id = a.patient_id AND b.appointment_status = 'no_show'
       AND b.start_time < a.start_time)                                            AS korabbi_no_show,
  ats.user_id AS orvos_user_id
FROM appointments a
JOIN available_time_slots ats ON ats.id = a.time_slot_id
LEFT JOIN episode_work_phases ewp ON ewp.id = a.work_phase_id
WHERE a.start_time IS NOT NULL
  AND a.start_time < NOW()
  AND a.created_via IN ('worklist', 'patient_self', 'admin_override', 'surgeon_override');
```

### A6 · OHIP-utánkövetés lemorzsolódása (K6 → IPW a K2-höz)

```sql
WITH atadott AS (
  SELECT se.patient_id, se.episode_id, MIN(se.at) AS atadas_at
  FROM stage_events se WHERE se.stage_code = 'STAGE_6'
  GROUP BY se.patient_id, se.episode_id
)
SELECT
  x.patient_id, x.episode_id, x.atadas_at,
  EXISTS (SELECT 1 FROM ohip14_responses o WHERE o.patient_id = x.patient_id
            AND o.episode_id = x.episode_id AND o.timepoint = 'T0') AS t0_van,
  EXISTS (SELECT 1 FROM ohip14_responses o WHERE o.patient_id = x.patient_id
            AND o.episode_id = x.episode_id AND o.timepoint = 'T3') AS t3_van,
  (SELECT total_score FROM ohip14_responses o WHERE o.patient_id = x.patient_id
     AND o.episode_id = x.episode_id AND o.timepoint = 'T0' LIMIT 1)  AS t0_pont,
  (p.email IS NULL OR p.email = '')                                     AS nincs_email,
  EXTRACT(YEAR FROM AGE(x.atadas_at::date, p.szuletesi_datum))::int    AS eletkor,
  LEFT(p.iranyitoszam, 2)                                               AS regio_elotag,
  (SELECT COUNT(*) FROM ohip_reminder_log l
     WHERE l.patient_id = x.patient_id AND l.timepoint = 'T3'
       AND COALESCE(l.episode_id, x.episode_id) = x.episode_id)         AS t3_emlekeztetok,
  p.halal_datum
FROM atadott x
JOIN patients p ON p.id = x.patient_id
WHERE x.atadas_at < NOW() - INTERVAL '365 days';   -- a T3 ablak (180–365. nap) már lezárult
```

### A7 · Napi teljességi idősor (K6 megszakított idősor)

```sql
SELECT snapshot_date, total, avg_score, clinical_complete, research_ready, publication_ready, with_warnings,
       ROUND(100.0 * research_ready / NULLIF(total, 0), 1) AS research_ready_pct,
       (SELECT MIN(sent_at)::date FROM missing_data_reminder_log)    AS orvosi_emlekezteto_kezdete,
       (SELECT MIN(sent_at)::date FROM patient_selffill_reminder_log) AS beteg_emlekezteto_kezdete
FROM data_completeness_snapshot
ORDER BY snapshot_date;
```

---

## Függelék B: rövid változó-szótár

A kutatási kódkönyvbe (`data/research-registry/codebook-registry.json`) felveendő tételek; a jelenlegi export csak az első négyet tartalmazza.

| Változó (export-név) | Forrás | Típus | Értékkészlet / egység |
|---|---|---|---|
| age_band_start | `patients.szuletesi_datum` | integer | 5 éves sáv kezdete |
| region_prefix | `patients.iranyitoszam` | string | 2 karakter |
| completeness_score | `entity_quality_state` | numeric | 0–100 |
| legacy_compliance_status | `patients` | enum | LEGACY_UNVERIFIED / IMPORTED_LEGACY / VERIFIED |
| sex | `patients.nem` | enum | ferfi / no |
| etiology | `patient_anamnesis.kezelesre_erkezes_indoka` | enum | onkológiai / traumás / veleszületett / nincs beutaló |
| bno_codes | `patient_anamnesis.bno` | string[] | BNO-10 |
| tnm_t, tnm_n, tnm_m | `patient_anamnesis.tnm_staging` (kódolva) | enum | T0–T4, N0–N3, M0–M1 |
| neck_dissection | `patient_referral.nyaki_blokkdisszekcio` | enum | nem volt / egyoldali / kétoldali |
| surgery_to_intake_days | `felvetel_datuma − mutet_ideje` | integer | nap |
| radiotherapy, rt_dose_gy | `patient_anamnesis.radioterapia`, `radioterapia_dozis_gy` | boolean, numeric | Gy |
| chemotherapy | `patient_anamnesis.chemoterapia` | boolean | — |
| smoking_per_day | `patient_anamnesis.dohanyzas_szam_ertek` | numeric | szál/nap |
| alcohol_category | `patient_anamnesis.alkoholfogyasztas` (kódolva) | enum | soha / alkalmi / rendszeres / nagyivó |
| maxilla_defect, brown_vertical, brown_horizontal | `patient_anamnesis` | boolean, ordinal, ordinal | 1–4, a–c |
| mandible_defect, kovacs_dobak | `patient_anamnesis` | boolean, ordinal | 1–5 |
| tongue_restricted, speech_impaired | `nyelvmozgasok_akadalyozottak`, `gombocos_beszed` | boolean | — |
| saliva_status | `nyalmirigy_allapot` | enum | hipo / hiper / normál |
| ff_class_upper, ff_class_lower | `fabian_fejerdy_protetikai_osztaly_felso/_also` | ordinal | 0, 1A, 1B, 2A, 2A/1, 2B, 3, T |
| d_count, f_count, m_count, remaining_teeth_upper/lower | harmonizált odontogram (A2) | integer | fogszám |
| implant_count | `meglevo_implantatumok` | integer | — |
| prior_prosthesis_upper/lower, prior_satisfaction_upper/lower | `patient_dental_status.*_fogpotlas_*` | enum, boolean | 11 típus |
| planned_prosthesis_upper/lower (group) | `kezelesi_terv_*` | enum | 6 csoport |
| epithesis_type, epithesis_retention | `kezelesi_terv_arcot_erinto` | enum | 4 típus, 4 retenció |
| perio_mean_pd, perio_bop_pct, perio_mean_cal | `perio_charts.data` | numeric | mm, % |
| episode_reason, episode_trigger, episode_status | `patient_episodes` | enum | — |
| days_to_delivery, visits_to_delivery, stage_durations | A3 | integer | nap, db |
| block_days_by_reason | `episode_blocks` | numeric | nap okonként |
| unsuccessful_attempts, no_show_count, max_attempt_number | `appointments` | integer | — |
| unsuccessful_reason_template | `attempt_failed_reason` | enum | 5 sablon + egyéb |
| forecast_p50_end, forecast_p80_end | `episode_forecast_cache` | date | — |
| ohip_total_Tk, ohip_dim_*_Tk, ohip_days_since_delivery | A4 | integer | 0–56, 0–8 |
| ohip_completed_by_patient | `ohip14_responses.completed_by_patient` | boolean | — |
| followup_T3_completed | A6 | boolean | — |
| na_reason_<field> | `patient_field_na.reason_code` | enum | 4 okkód |
| consilium_before_plan, consilium_deferred | `consilium_session_items` + `stage_events` | boolean | — |
| recall_risk_level, recall_adherence | `patient_episodes`, `episode_tasks` + `appointments` | enum, numeric | low/medium/high, % |
| death_date, died_before_delivery | `patients.halal_datum` + STAGE_6 | date, boolean | — |
