# MaxRehab hipotézis-lánc

> **Lánc.** tudományos hipotézis → egymással versengő predikciók → változók → H0/H1 statisztikai hipotézisek → statisztikai próba. Nyolc irány (K1–K8), mindegyik ezt a láncot követi. A rivális magyarázatok azért szerepelnek, hogy a predikciók *diszkrimináljanak*, ne csak megerősítsenek: minden H0/H1 sornál ott áll, melyik riválist dönti el.
>
> **Elemzési alapelvek.** Pre-regisztráció; α = 0,05, kétoldali próba (az irány a hatásbecslés előjeléből olvasható); irányonként egy elsődleges H, a többi másodlagos, Holm-korrekcióval; ≥ 10 esemény/prediktor; beteg és orvos random effekt, ahol ismétlődés van; hiányzó adat: inverz valószínűségi súlyozás (IPW) a K6 lemorzsolódás-modelljéből, MNAR-érzékenység a „beteg megtagadta” mezőkre.
>
> **Háttér.** Változó-leltár tábla.oszlop szinten, 13 adat-harmonizációs buktató, sémán ellenőrzött SQL-vázlatok és a jogi kapu (TUKEB, hozzájárulás, export-mód): [háttéranyag](./maxrehab-hipotezisek-hatteranyag.md).

---

## Definíciók

- **OHIP-14:** 0–56, kisebb = jobb. **Δ** = Tk − T0, a javulás negatív. **MCID** előre rögzített (irodalmi ≈ 5 pont). Időpont a `completed_at − átadás` napokból újracímkézve (0 / 30 / 180 / 365 / 1095).
- **Átadás:** az epizód első `STAGE_6` eseménye (`stage_events.at`); ennek hiányában első `STAGE_7`.
- **Átfutás:** `patient_episodes.opened_at` → átadás, napokban; versengő esemény: halál (`patients.halal_datum`).
- **Harmonizált D / F / M:** régi `status` és új `base` odontogram-modell együtt (háttéranyag A2); M nem caries-eredetű, külön jelentendő.
- **Sikertelen próba:** `appointment_status = 'unsuccessful'` (029 után); **próba** = completed + unsuccessful + no_show.
- **Blokk-napok:** `episode_blocks` aktív ideje kulcsonként (WAIT_LAB, WAIT_HEALING, WAIT_SURGERY, PATIENT_DELAY, WAIT_OR, WAIT_IMPLANT).
- **Recall-adherencia:** teljesült kontroll az esedékesség ± 30 napjában / esedékes recall-sorok (`episode_tasks`).

## Áttekintés

| Irány | Tudományos hipotézis egy mondatban | Elsődleges H0 | Próba | Mikor |
|---|---|---|---|---|
| K1 | Az etiológia három külön klinikai fenotípus | korra igazítva az M-szám azonos etiológiák között | negatív binomiális regresszió | most |
| K2 | A QoL-javulást a szöveti deficit korlátozza, nem a pótlástípus | β(RT × idő) = 0 | lineáris kevert modell | T3-adattal |
| K3 | Az átfutást a rendszer-várakozás uralja, nem a klinikai komplexitás | várakozás-blokk magyarázott varianciája ≤ klinikai blokké | variancia-dekompozíció, Cox, Fine–Gray | ≥ 80 lezárt epizód |
| K4 | A sikertelen lenyomat beteg/defektus-függő, nem kezelő-függő; a no-show hajlam + időzítés | OR(defektus, tolerancia) = 1; ΔAUC = 0 | kevert logisztikus, DeLong | ≥ 100 esemény |
| K5 | A pótlástípust a támasztási viszonyok döntik el, nem a defektus | FF-blokk elhagyása nem rontja a modellt | egymásba ágyazott multinomiális, LR | ≥ 200 állcsont |
| K6 | A hiány szerepkör- és állapotfüggő (MAR), a megtagadás MNAR; az emlékeztető ok-okozati | hiány független a szerepkörtől; ITS szint/meredekség = 0 | χ², logisztikus, szegmentált regresszió | most |
| K7 | A konzílium előre feloldja a bizonytalanságot | IRR(revíziók) = 1 PS-igazítva | PS-illesztett negatív binomiális | konzílium-napló érettségével |
| K8 | A késői fogvesztés sugár/nyálmirigy-eredetű, a recall csak részben véd | HR(RT → fogvesztés) = 1 adherenciára igazítva | fog-szintű Cox, Andersen–Gill | 1–3 év |

---

## K1 · Etiológiai fenotípusok (kohorsz-profil)

**Tudományos hipotézis (TH1).** A három etiológia (onkológiai, traumás, veleszületett) három különböző klinikai fenotípus, nem csak beutalási címke, **mert** a szövetkárosodás mechanizmusa (reszekció + besugárzás, lokalizált trauma, fejlődési hiány) és időbelisége meghatározza a fogazat, a nyálmirigy-funkció és a szükséges pótlás jellegét.

**Versengő predikciók.**

| Megfigyelés | Ha TH1 igaz | Rivális A: életkor-hipotézis (a kor magyaráz) | Rivális B: sugár-hipotézis (csak az RT-alcsoport tér el) |
|---|---|---|---|
| Hiányzó fogak (M) és D+F etiológia szerint | korra igazítva is eltér; onkológiai a legmagasabb | korra igazítva a különbség eltűnik | nem sugárkezelt onkológiai ≈ traumás |
| Hiposzaliváció | onkológiai ≫ traumás ≈ veleszületett | egyenletes | csak az RT-s alcsoportban |
| Tervezett pótlás-csoport | onkológiai: kivehető/obturátor; traumás: rögzített/implantációs; veleszületett: etapos, több epizód | a kor és a fogszám magyarázza | RT nélküli onkológiai = traumás megoszlás |

**Változók.** Rétegző: `patient_anamnesis.kezelesre_erkezes_indoka`. Kimenetek: harmonizált D, F, M (`patient_dental_status.meglevo_fogak`), `nyalmirigy_allapot`, tervezett pótlás-csoport (`patient_treatment_plans.kezelesi_terv_felso/_also`). Zavarók: életkor, `nem`, `radioterapia`, `dohanyzas_szam_ertek`.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 1.1 (elsődleges) | korra és nemre igazítva az M-szám várható értéke azonos a három etiológiában | legalább egy eltér (onkológiai > traumás) | negatív binomiális regresszió, LR-teszt; Rivális A elvetve, ha az igazított hatás megmarad |
| 1.2 | P(hiposzaliváció) azonos etiológiák között RT-re igazítva | onkológiai magasabb RT-n túl is | logisztikus regresszió; Rivális B elvetve, ha a nem sugárkezelt onkológiai alcsoport is eltér |
| 1.3 | a pótlás-csoport független az etiológiától (kor, fogszám mellett) | függ | multinomiális logisztikus, LR-teszt |

Minimum: 100–150 beteg; 1.3-hoz ≥ 200 tervezett állcsont.

---

## K2 · OHIP-14 életminőség-trajektória

**Tudományos hipotézis (TH2).** A protetikai rehabilitáció javítja az életminőséget, de a javulás felső korlátját a reszekció és a sugárkezelés okozta szöveti-funkcionális deficit szabja meg, nem a pótlás típusa, **mert** az OHIP-14 tételek többsége (rágás, fájdalom, ízérzés, beszéd) a lágyrész- és nyálmirigy-funkción múlik, amit a pótlás nem állít helyre.

**Versengő predikciók.**

| Megfigyelés | Ha TH2 igaz (szöveti korlát) | Rivális A: protetikai hipotézis (a pótlás minősége dönt) | Rivális B: regresszió az átlaghoz, mérési hatás |
|---|---|---|---|
| Δ(T0→T3) összpont | RT és hiposzaliváció mellett kisebb javulás, pótlástípustól függetlenül | implantációs/rögzített > kivehető, RT-től függetlenül | Δ a T0-val arányos; T0-ra igazítva egyik prediktor sem hat |
| Dimenzió-mintázat | fájdalom és fizikai fogyatékosság javul legkevésbé RT mellett | funkcionális korlátozás javul legjobban implantációnál | minden dimenzió egyformán |
| Időprofil T1–T5 | plató T3 után; RT mellett korai plató | folyamatos javulás T4-ig (adaptáció) | T1 után visszacsúszás |
| Kitöltési mód | nincs különbség | nincs különbség | személyzeti rögzítés alacsonyabb pont (társas kívánatosság) |

<!-- fig:ohip -->

**Változók.** Kimenet: `ohip14_responses.total_score` és 7 dimenzió, T0–T5. Expozíció: `radioterapia`, `radioterapia_dozis_gy`, `nyalmirigy_allapot`, `brown_fuggoleges_osztaly`, `kovacs_dobak_osztaly`, átadott pótlás-csoport (`treatment_types.code`). Zavarók: életkor, nem, etiológia, dohányzás, `completed_by_patient`, T0-pont, epizód-sorszám. Lemorzsolódás: K6 IPW.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 2.1 (elsődleges) | E[Δ(T0→T3)] = 0 | E[Δ] ≤ −MCID | lineáris kevert modell (beteg random intercept, időpont fix); responder-arány 95 % CI |
| 2.2 | β(RT × idő) = 0 | β > 0 (RT mellett kisebb csökkenés) | kevert modell, LR-teszt az interakcióra; TH2 vs Rivális A: mindkét interakció egy modellben, dominancia-elemzés |
| 2.3 | β(pótlás-csoport × idő) = 0 | β < 0 (implantációs nagyobb csökkenés) | ugyanaz |
| 2.4 | az RT-hatás dimenziónként egyenlő | fájdalom és fizikai fogyatékosság > többi | multivariáns kevert modell, Holm |
| 2.5 | Δ(T3→T4) ≠ 0 | ekvivalens 0-val (±MCID/2) | TOST |
| 2.6 | β(completed_by_patient) = 0 | ≠ 0 | kevert modell; ha ≠ 0, minden modell mérési módra igazítva (Rivális B) |

Minimum: 60–80 beteg teljes T0+T3 párral; interakciókhoz ≥ 100.

---

## K3 · Átfutási idő, vizitszám, halálozás mint versengő kockázat

**Tudományos hipotézis (TH3).** A rehabilitáció időtartamát a rendszer várakozási lépcsői (finanszírozás, labor, beteg okozta késés, ismételt próba) uralják, nem a klinikai komplexitás, **mert** a munkafázisok száma sablononként rögzített és kicsi (2–11), a várakozások viszont nyílt végűek.

**Tudományos hipotézis (TH3b).** A késői beutalás csökkenti a rehabilitáció elérésének esélyét, **mert** a betegség progressziója és a halálozás versengő eseményként elviszi a beteget az átadás előtt.

**Versengő predikciók.**

| Megfigyelés | Ha TH3 igaz (rendszer-várakozás) | Rivális A: klinikai komplexitás | Rivális B: kapacitás-hipotézis |
|---|---|---|---|
| Az átfutás varianciájának forrása | blokk-napok + no-show + próbák > lépésszám + defektus + RT | lépésszám, RT, implantáció dominál; a blokkok csak közvetítenek | a heti kihasználtság magyaráz, egyéni tényezők nem |
| Leghosszabb stádium | STAGE_2–3 (terv, finanszírozás) | STAGE_5 (protetikai fázis) | a kapacitással ingadozik |
| Implantáció | +183 nap fix eltolás, egyéb változatlan | +183 nap és további protetikai lassulás | — |
| TH3b | a halál kumulatív incidenciája nő a beutalási késéssel, TNM-re igazítva | csak a TNM magyaráz | — |

**Változók.** Kimenet: átfutás; esemény: átadás / halál / cenzor. Prediktorok: `episode_blocks` (kulcs, napok, `renewal_count`), no-show és sikertelen próbák száma, sablon-lépésszám, `episode_pathways.jaw`, `patient_milestones.code = SURG_IMPLANT_PLACED`, RT, Brown, Kovács–Dobák, `felvetel_datuma − mutet_ideje`, `tnm_staging`; kapacitás: `capacity_pool_config`; klaszter: `assigned_provider_id`. Forecast: `episode_forecast_cache.completion_end_p50/p80`.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 3.1 (elsődleges) | a várakozás-változók magyarázott-variancia hányada ≤ a klinikai változóké | > | log-átfutás lineáris modell, LMG/Shapley-dekompozíció bootstrap CI-vel; Cox HR-ek |
| 3.2 | HR(RT → átadás) = 1 | < 1 (lassabb) | cause-specific Cox |
| 3.3 | időarány(implantáció) = 1 | ≥ 1,5 | AFT (log-normál) |
| 3.4 (TH3b) | sHR(beutalási késés → halál átadás előtt) = 1 | > 1 | Fine–Gray, TNM-re és korra igazítva |
| 3.5 | P(tényleges átadás a P80-ablakban) = 0,8 | < 0,8 | egymintás binomiális; kalibrációs görbe |

Minimum: ≥ 80 lezárt epizód; ≥ 30 halálozás.

---

## K4 · Sikertelen próbák és no-show

**Tudományos hipotézis (TH4a).** A lenyomat sikertelenségét a defektus anatómiája és a beteg szöveti toleranciája (xerostomia, nyelvfunkció) határozza meg, nem a kezelő, **mert** a nagy, alávájt üreg és a száraz, sérülékeny nyálkahártya a lenyomatvétel fizikai feltételeit rontja.

**Tudományos hipotézis (TH4b).** A meg nem jelenés stabil viselkedési hajlam és időzítés kérdése, amit a betegteher módosít, **mert** a hosszú előretervezés alatt az élethelyzet változik, a korábbi meg nem jelenés pedig tartós hajlamot jelez.

**Versengő predikciók.**

| Megfigyelés | Ha TH4a igaz (beteg/defektus) | Rivális: kezelő-hipotézis | Rivális: véletlen |
|---|---|---|---|
| A sikertelen próba varianciája | beteg-szintű prediktorok (Brown, hiposzaliváció, nyelv) szignifikánsak, orvos-ICC ≈ 0 | orvos-ICC magas, „nem maradt elég idő” gyakori | egyik sem; próbaszám Poisson-eloszlású |
| Ok-mintázat | „beteg nem tűrte” ↔ hiposzaliváció/nyelv; „lenyomat torzult” ↔ Brown | az okok orvosonként klasztereződnek | egyenletes |

| Megfigyelés | Ha TH4b igaz (hajlam + időzítés) | Rivális: betegteher-hipotézis |
|---|---|---|
| No-show prediktorok | korábbi no-show, átfutás > 21 nap, 7–9 h a legerősebbek; önfoglalás véd | etiológia, távolság, T0 OHIP, életkor javítja az AUC-t a szabályalapú modellhez képest |

**Változók.** `appointments.appointment_status`, `attempt_failed_reason` (5 sablon), `attempt_number`, `start_time − created_at`, óra, `created_via`, `no_show_risk`; beteg: `brown_fuggoleges_osztaly`, `nyalmirigy_allapot`, `nyelvmozgasok_akadalyozottak`, régió-előtag, etiológia, OHIP T0; orvos: `attempt_failed_by`, slot `user_id`. Csak a 029/059 utáni időszak.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 4.1 (elsődleges) | OR(Brown, hiposzaliváció, nyelv → sikertelen) = 1 | > 1 | kevert logisztikus (beteg + orvos random) |
| 4.2 | orvos-ICC = 0 | > 0 | random-effekt LR-teszt; TH4a vs kezelő: melyik variancia-komponens nagyobb |
| 4.3 | az ok-eloszlás független a beteg-tényezőktől | „beteg nem tűrte” ↔ hiposzaliváció/nyelv | multinomiális logisztikus |
| 4.4 | OR(korábbi no-show, átfutás, korai óra) = 1 | > 1; OR(patient_self) < 1 | kevert logisztikus |
| 4.5 | AUC(bővített) − AUC(szabályalapú) = 0 | > 0 | DeLong; Brier, kalibrációs meredekség; újrakalibrált együtthatók → `no_show_risk_config` (Rivális betegteher) |

Minimum: ≥ 100 sikertelen próba, ≥ 100 no-show.

---

## K5 · Pótlástípus-választás

**Tudományos hipotézis (TH5).** A pótlástípust a maradék fogazat támasztási viszonyai döntik el, a defektus csak a kialakítást, **mert** az elhorgonyzás és a stabilitás a pillérfogakon múlik.

**Versengő predikciók.**

| Megfigyelés | Ha TH5 igaz | Rivális A: defektus-hipotézis | Rivális B: sugár-hipotézis |
|---|---|---|---|
| Relatív fontosság a modellben | FF-osztály + fogszám > Brown/KD > RT | Brown/KD > FF | RT > FF ≈ Brown |
| Terv-revíziók hajtóereje | parodontális státusz, fogvesztés | defektus-progresszió | RT |

**Változók.** `fabian_fejerdy_protetikai_osztaly_felso/_also`, maradék fogak (A2), `brown_*`, `kovacs_dobak_osztaly`, RT, perio (BOP %, PD); kimenet: pótlás-csoport állcsontonként; revíziók: `episode_work_phase_audit.change_type`.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 5.1 (elsődleges) | a FF-osztály + fogszám blokk elhagyása nem rontja a modellt | rontja, jobban, mint a defektus-blokk elhagyása | egymásba ágyazott multinomiális modellek, LR-teszt; dominancia-elemzés |
| 5.2 | IRR(RT → revíziók) = 1 | > 1 | negatív binomiális (Rivális B) |
| 5.3 | OR(BOP % → rögzített terv) = 1 | < 1 | multinomiális |

Minimum: ≥ 200 tervezett állcsont.

---

## K6 · Adathiány-mechanizmus és emlékeztetők

**Tudományos hipotézis (TH6).** A hiány nem véletlen: munkafolyamat-szervezett (a rögzítésért felelős szerepkör szerint) és beteg-állapot függő (MAR), a megtagadás pedig MNAR, **mert** minden mező egy szereplőhöz és lépéshez kötődik, a beteg önkitöltése pedig az elérhetőségtől és az állapottól függ.

**Tudományos hipotézis (TH6b).** A célzott emlékeztetők ok-okozatilag növelik a teljességet, **mert** pontosan a hiányért felelős szereplőt érik el.

**Versengő predikciók.**

| Megfigyelés | Ha TH6 igaz | Rivális: MCAR | Rivális: rögzítő-szorgalom (orvos-hatás) |
|---|---|---|---|
| Hiány mező × szerepkör | erős szerepkör-mintázat (beutaló-mezők, beteg-mezők) | egyenletes | orvosonként klasztereződik, mezőtől függetlenül |
| T3-kitöltés | prediktálható (kor, e-mail hiánya, T0-pont) | nem prediktálható | csak az orvos prediktál |
| Okkódok | „beteg megtagadta” az életmód-mezőkön | — | — |

| Megfigyelés | Ha TH6b igaz | Rivális: szekuláris trend, tanulási görbe |
|---|---|---|
| Napi teljesség idősor | szint- és/vagy meredekség-ugrás a bevezetéskor | folyamatos trend, törés nélkül |

**Változók.** Mezőnkénti hiány (`patient-data-completeness`), `patient_field_na.reason_code`, OHIP tölcsér (T3 missed), `data_completeness_snapshot`, az emlékeztető-naplók első dátuma, `kezeleoorvos_user_id`.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 6.1 (elsődleges) | a hiány független a szerepkörtől | függ | χ², log-lineáris modell; orvos-ICC a rivális ellen |
| 6.2 | a T3-kitöltés független a felvételi változóktól (MCAR) | függ (MAR) | logisztikus regresszió; Little-teszt; → IPW |
| 6.3 | OR(T0-pont → T3 kitöltés) = 1 | < 1 | logisztikus |
| 6.4 (TH6b) | szintváltozás = 0 és meredekség-változás = 0 | legalább az egyik > 0 | szegmentált regresszió (ITS), Newey–West SE |
| 6.5 | a „beteg megtagadta” arány azonos mezőcsoportonként | életmód-mezőkön magasabb | χ² |

Minimum: ITS ≥ 8–12 hét bevezetés előtt és után; ≥ 50 kihagyott T3.

---

## K7 · Konzílium

**Tudományos hipotézis (TH7).** A konzílium előre feloldja a döntési bizonytalanságot, ezért kevesebb terv-revízió és rövidebb terv→elfogadás idő, **mert** a sebészi, onkológiai és protetikai szempontok egy időben egyeztetődnek.

**Versengő predikciók.**

| Megfigyelés | Ha TH7 igaz | Rivális: indikáció-szelekció (a komplex eset megy konzíliumra) |
|---|---|---|
| Nyers összehasonlítás | kevesebb revízió, rövidebb STAGE_2→3 | több revízió, hosszabb (a komplexitás miatt) |
| Komplexitásra igazítva (propensity score) | a hatás megmarad | a hatás eltűnik vagy megfordul |

**Változók.** `consilium_session_items` (időzítés a `plan_approved_at` előtt, `discussion_status`), revíziók, STAGE_2→3 tartam; komplexitás: Brown, Kovács–Dobák, RT, TNM, implantáció.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 7.1 (elsődleges) | IRR(konzílium → revíziók) = 1 PS-igazítva | < 1 | PS-illesztett negatív binomiális |
| 7.2 | HR(STAGE_2→3) = 1 | > 1 (gyorsabb) | időfüggő Cox |
| 7.3 | HR(deferred → átadás) = 1 | < 1 | Cox |

---

## K8 · Gondozás és késői kimenetek

**Tudományos hipotézis (TH8).** A késői fog- és pótlásvesztés elsősorban a sugár- és nyálmirigy-károsodás következménye, amit a recall csak részben ellensúlyoz, **mert** a sugár-caries és a xerostomia a pillérfogakat a kontroll-gyakoriságtól függetlenül pusztítja.

**Versengő predikciók.**

| Megfigyelés | Ha TH8 igaz | Rivális: adherencia-hipotézis | Rivális: rizikó-címke (a klinikus szintje mindent összefoglal) |
|---|---|---|---|
| Fogvesztés átadás után | az RT/hiposzaliváció hatás adherenciára igazítva megmarad | az adherencia-hatás RT-re igazítva megmarad, az RT eltűnik | `recall_risk_level` mellett egyik sem ad többletet |
| Új epizód (pótlásvesztés) | RT-s betegeknél gyakoribb | nem adherenseknél gyakoribb | a rizikószint prediktál |

**Változók.** `dental_status_snapshots` fog-szintű változás, új `patient_episodes` (`trigger_type`), recall-adherencia (`episode_tasks` + `appointments`), `recall_risk_level`, RT, `nyalmirigy_allapot`.

**Statisztikai hipotézisek és próbák.**

| # | H0 | H1 | Próba |
|---|---|---|---|
| 8.1 (elsődleges) | HR(RT → fogvesztés) = 1 adherenciára igazítva | > 1 | fog-szintű Cox, beteg-klaszter (robusztus SE) |
| 8.2 | HR(adherencia → pótlásvesztés-epizód) = 1 | < 1 | Andersen–Gill, időfüggő adherencia |
| 8.3 | a rizikószint hozzáadása nem javítja a modellt | javítja | LR-teszt, C-index különbség |

Horizont: 1–3 év (T4/T5).
