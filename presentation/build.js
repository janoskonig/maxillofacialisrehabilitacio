const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");

// ---------- palette ----------
const NAVY = "0B2A3A";
const TEAL = "0F6E6E";
const TEAL_D = "0B4F4F";
const MINT = "12B886";
const AMBER = "E8A33D";
const RED = "C0492F";
const INK = "1E2B30";
const MUTE = "6B7C82";
const PANEL = "F1F6F6";
const PANEL2 = "E3EFEF";
const WHITE = "FFFFFF";
const ICE = "CFE6E6";
const SAND = "FDF4E5";

const HEAD = "Georgia";
const BODY = "Calibri";

async function icon(IconComponent, color = "#FFFFFF", size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
const shadow = () => ({ type: "outer", color: "000000", blur: 7, offset: 3, angle: 135, opacity: 0.16 });

async function main() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
  pres.author = "Maxillofaciális Rehabilitáció";
  pres.title = "Betegregiszter, ellátáskoordináció és kutatás";

  const I = {
    toothIce: await icon(fa.FaTooth, "#" + ICE),
    database: await icon(fa.FaDatabase, "#" + MINT),
    idcard: await icon(fa.FaIdCard, "#" + TEAL),
    notes: await icon(fa.FaNotesMedical, "#" + TEAL),
    diagnoses: await icon(fa.FaDiagnoses, "#" + TEAL),
    tooth: await icon(fa.FaTooth, "#" + TEAL),
    smile: await icon(fa.FaSmile, "#" + TEAL),
    calCheck: await icon(fa.FaCalendarCheck, "#" + MINT),
    hourglass: await icon(fa.FaHourglassHalf, "#" + AMBER),
    layers: await icon(fa.FaLayerGroup, "#" + TEAL),
    userClock: await icon(fa.FaUserClock, "#" + RED),
    userClockT: await icon(fa.FaUserClock, "#" + TEAL),
    route: await icon(fa.FaRoute, "#" + ICE),
    routeT: await icon(fa.FaRoute, "#" + TEAL),
    diagram: await icon(fa.FaProjectDiagram, "#" + ICE),
    chart: await icon(fa.FaChartLine, "#" + MINT),
    chartTeal: await icon(fa.FaChartLine, "#" + TEAL),
    users: await icon(fa.FaUserFriends, "#" + TEAL),
    comments: await icon(fa.FaComments, "#" + TEAL),
    share: await icon(fa.FaShareAlt, "#" + TEAL),
    tasks: await icon(fa.FaTasks, "#" + TEAL),
    sync: await icon(fa.FaSyncAlt, "#" + MINT),
    percent: await icon(fa.FaPercent, "#" + TEAL),
    levelUp: await icon(fa.FaLevelUpAlt, "#" + RED),
    sqrt: await icon(fa.FaSquareRootAlt, "#" + TEAL),
    wave: await icon(fa.FaWaveSquare, "#" + TEAL),
    shield: await icon(fa.FaShieldAlt, "#" + MINT),
    balance: await icon(fa.FaBalanceScale, "#" + MINT),
    userMd: await icon(fa.FaUserMd, "#" + TEAL),
    heart: await icon(fa.FaHeartbeat, "#" + TEAL),
    heartIce: await icon(fa.FaHeartbeat, "#" + MINT),
    lock: await icon(fa.FaLock, "#" + MINT),
  };

  // ---------- helpers ----------
  function kicker(s, text, color = TEAL) {
    s.addText(text.toUpperCase(), { x: 0.7, y: 0.42, w: 11.5, h: 0.32, fontFace: BODY, fontSize: 12, color, bold: true, charSpacing: 3, margin: 0 });
  }
  function title(s, text, color = INK, size = 30) {
    s.addText(text, { x: 0.7, y: 0.72, w: 12.2, h: 0.85, fontFace: HEAD, fontSize: size, color, bold: true, margin: 0 });
  }
  function lede(s, text, color = MUTE) {
    s.addText(text, { x: 0.7, y: 1.52, w: 11.9, h: 0.55, fontFace: BODY, fontSize: 14, color, margin: 0, lineSpacingMultiple: 1.12 });
  }
  function pageNum(s, n, dark = false) {
    s.addText(String(n).padStart(2, "0"), { x: 12.5, y: 6.95, w: 0.6, h: 0.3, fontFace: BODY, fontSize: 10, color: dark ? ICE : MUTE, align: "right", margin: 0 });
    s.addText("Maxillofaciális rehabilitáció · klinikai-kutatási áttekintés", { x: 0.7, y: 6.95, w: 9, h: 0.3, fontFace: BODY, fontSize: 9, color: dark ? "6E8C8C" : MUTE, margin: 0 });
  }
  function darkKickerTitle(s, kick, ttl, kickColor = MINT) {
    s.addText(kick.toUpperCase(), { x: 0.7, y: 0.42, w: 11.5, h: 0.32, fontFace: BODY, fontSize: 12, color: kickColor, bold: true, charSpacing: 3, margin: 0 });
    s.addText(ttl, { x: 0.7, y: 0.72, w: 12.2, h: 0.85, fontFace: HEAD, fontSize: 30, color: WHITE, bold: true, margin: 0 });
  }

  // =========================================================
  // 1 — TITLE
  // =========================================================
  let s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape(pres.shapes.OVAL, { x: 9.6, y: -2.2, w: 6.5, h: 6.5, fill: { color: TEAL_D, transparency: 55 }, line: { type: "none" } });
  s.addShape(pres.shapes.OVAL, { x: 10.9, y: -0.9, w: 4, h: 4, fill: { color: TEAL, transparency: 65 }, line: { type: "none" } });
  s.addImage({ data: I.toothIce, x: 11.55, y: 0.55, w: 0.85, h: 0.85 });
  s.addText("KLINIKAI-KUTATÁSI ÁTTEKINTÉS", { x: 0.9, y: 1.65, w: 9, h: 0.4, fontFace: BODY, fontSize: 14, color: MINT, bold: true, charSpacing: 4, margin: 0 });
  s.addText("Maxillofaciális rehabilitáció", { x: 0.85, y: 2.1, w: 11.4, h: 0.95, fontFace: HEAD, fontSize: 44, color: WHITE, bold: true, margin: 0 });
  s.addText("Betegregiszter, ellátáskoordináció és kutatás", { x: 0.9, y: 3.1, w: 11.4, h: 0.7, fontFace: HEAD, fontSize: 25, color: ICE, italic: true, margin: 0 });
  s.addShape(pres.shapes.LINE, { x: 0.92, y: 4.1, w: 2.4, h: 0, line: { color: MINT, width: 2.5 } });
  s.addText("Egyetlen rendszer a napi klinikai munkára és a strukturált, kutatásra kész betegregiszterre — ugyanabból az adatból.", {
    x: 0.9, y: 4.4, w: 9.0, h: 1.0, fontFace: BODY, fontSize: 15, color: ICE, lineSpacingMultiple: 1.2, margin: 0,
  });
  s.addText("2026 · belső bemutató", { x: 0.9, y: 6.7, w: 6, h: 0.35, fontFace: BODY, fontSize: 12, color: "6E8C8C", margin: 0 });

  // =========================================================
  // 2 — OVERVIEW (three layers)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Áttekintés");
  title(s, "Egy adat — három haszon");
  lede(s, "A klinikai munka során rögzített adat egyúttal strukturált betegregisztert épít, amelyből kutatás végezhető — párhuzamos adatbevitel és külön „kutatási adatlap” nélkül.");
  const layers = [
    { ic: I.userMd, t: "Operatív klinikai munka", d: "Időpontok, kezelési tervek, konzíliumok és feladatok egy helyen, valós időben.", c: TEAL },
    { ic: I.database, t: "Strukturált betegregiszter", d: "Longitudinális, szabványosított adat minden páciensről — egyetlen hiteles forrás.", c: MINT },
    { ic: I.chartTeal, t: "Kutatás & elemzés", d: "Hipotézis-tesztelés és statisztikai modellezés a felhalmozott regiszteradaton.", c: AMBER },
  ];
  let px = 0.7; const pw = 3.85, pgap = 0.32;
  for (const p of layers) {
    s.addShape(pres.shapes.RECTANGLE, { x: px, y: 2.35, w: pw, h: 3.9, fill: { color: PANEL }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: px, y: 2.35, w: pw, h: 0.13, fill: { color: p.c }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: px + 0.35, y: 2.8, w: 1.05, h: 1.05, fill: { color: WHITE }, line: { color: p.c, width: 1.5 } });
    s.addImage({ data: p.ic, x: px + 0.61, y: 3.06, w: 0.53, h: 0.53 });
    s.addText(p.t, { x: px + 0.35, y: 4.0, w: pw - 0.7, h: 0.6, fontFace: HEAD, fontSize: 18, bold: true, color: INK, margin: 0, lineSpacingMultiple: 0.95 });
    s.addText(p.d, { x: px + 0.35, y: 4.62, w: pw - 0.7, h: 1.5, fontFace: BODY, fontSize: 13, color: MUTE, margin: 0, lineSpacingMultiple: 1.18 });
    px += pw + pgap;
  }
  pageNum(s, 2);

  // =========================================================
  // 3 — A BETEGREGISZTER: MIRE VALÓ (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  darkKickerTitle(s, "A betegregiszter", "Mire való a betegregiszter?");
  s.addText("Nem statikus lista, hanem élő, longitudinális kohorsz — minden páciens útja a beutalótól a protézis átadásáig és a kontrollokig követhető.", {
    x: 0.7, y: 1.55, w: 11.9, h: 0.6, fontFace: BODY, fontSize: 14, color: ICE, italic: true, margin: 0, lineSpacingMultiple: 1.15,
  });
  const regUses = [
    { ic: I.database, t: "Egyetlen hiteles forrás", d: "Minden klinikai adat egy helyen, szabványosított mezőkkel — nincs széttagolt papír vagy táblázat." },
    { ic: I.heartIce, t: "Longitudinális követés", d: "Defektustól a rehabilitációig: műtét, terápia, protézis és életminőség idősorként." },
    { ic: I.chart, t: "Kutatásra kész adat", d: "Egységes klasszifikációk (Brown, Kovács-Dobák, Fábián-Fejérdy) elemezhető formában." },
    { ic: I.shield, t: "Minőség & kohorsz-kiválasztás", d: "Teljességi pontszám és megfelelőségi státusz alapján szűrhető, megbízható alcsoportok." },
  ];
  let rx = 0.7, ry = 2.5; const rw = 5.85, rh = 1.85, rxg = 0.35, ryg = 0.3;
  regUses.forEach((g, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = rx + col * (rw + rxg), y = ry + row * (rh + ryg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: rw, h: rh, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.OVAL, { x: x + 0.32, y: y + 0.45, w: 0.95, h: 0.95, fill: { color: NAVY }, line: { color: MINT, width: 1.4 } });
    s.addImage({ data: g.ic, x: x + 0.56, y: y + 0.69, w: 0.47, h: 0.47 });
    s.addText(g.t, { x: x + 1.5, y: y + 0.32, w: rw - 1.7, h: 0.5, fontFace: HEAD, fontSize: 16.5, bold: true, color: WHITE, margin: 0, valign: "middle" });
    s.addText(g.d, { x: x + 1.5, y: y + 0.85, w: rw - 1.75, h: 0.9, fontFace: BODY, fontSize: 12, color: ICE, margin: 0, lineSpacingMultiple: 1.15 });
  });
  pageNum(s, 3, true);

  // =========================================================
  // 4 — MILYEN ADATOKAT GYŰJTÜNK
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Adatkör");
  title(s, "Milyen adatokat gyűjtünk a betegekről");
  lede(s, "Strukturált, klasszifikáció-alapú adat minden szakaszban — a demográfiától az életminőség-kimenetig.");
  const dgroups = [
    { ic: I.idcard, t: "Demográfia & azonosítás", d: "Kor, nem, TAJ, elérhetőség; törvényes képviselő kiskorúnál; kezelőorvos." },
    { ic: I.notes, t: "Beutaló & onkológia", d: "Beutaló orvos/intézmény, műtét ideje, szövettani diagnózis, TNM, nyaki blokkdisszekció." },
    { ic: I.heart, t: "Adjuváns terápia", d: "Sugárterápia (dózis, Gy), kemoterápia; életmód: alkohol, dohányzás." },
    { ic: I.diagnoses, t: "Defektus-klasszifikáció", d: "Maxilla: Brown (1–4 / a–c); mandibula: Kovács-Dobák (1–5); Fábián-Fejérdy protetikai osztály." },
    { ic: I.tooth, t: "Fogászati státusz", d: "Meglévő fogak (Zsigmondy), implantátumok, protézisek típusa és állapota — JSON-ban." },
    { ic: I.smile, t: "Kezelési terv & kimenet", d: "Felső/alsó protetikai terv, epitézis-terv; beszéd/nyelés; OHIP-14 életminőség." },
  ];
  let gx = 0.7, gy = 2.15; const cw = 3.85, ch = 1.95, cxg = 0.32, cyg = 0.28;
  dgroups.forEach((f, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = gx + col * (cw + cxg), y = gy + row * (ch + cyg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.32, w: 0.82, h: 0.82, fill: { color: WHITE }, line: { color: TEAL, width: 1.3 } });
    s.addImage({ data: f.ic, x: x + 0.5, y: y + 0.52, w: 0.42, h: 0.42 });
    s.addText(f.t, { x: x + 1.3, y: y + 0.3, w: cw - 1.45, h: 0.55, fontFace: HEAD, fontSize: 15, bold: true, color: INK, margin: 0, valign: "middle", lineSpacingMultiple: 0.95 });
    s.addText(f.d, { x: x + 0.3, y: y + 1.2, w: cw - 0.6, h: 0.7, fontFace: BODY, fontSize: 11, color: MUTE, margin: 0, lineSpacingMultiple: 1.1 });
  });
  pageNum(s, 4);

  // =========================================================
  // 5 — IDŐPONTKEZELÉS
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Időpontkezelés");
  title(s, "Mire jó az időpontkezelés");
  lede(s, "A determinisztikus, többfeltételes foglalási motor a kezelési tervből vezeti le, mikor mi következik — és megvédi a páciensutat a túlfoglalástól.");

  s.addText("A foglalás életciklusa", { x: 0.7, y: 2.15, w: 5.2, h: 0.4, fontFace: HEAD, fontSize: 15, bold: true, color: TEAL_D, margin: 0 });
  const life = [
    { t: "Slot-szándék", d: "a terv kivetíti a jövőbeli igényt" },
    { t: "Foglalás / hold", d: "ideiglenes lefoglalás, lejárattal" },
    { t: "Lánc-foglalás", d: "összefüggő lépések együtt" },
    { t: "Időpont", d: "véglegesített, naptárba írt" },
  ];
  let ly = 2.65;
  life.forEach((st, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: ly, w: 5.55, h: 0.78, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: 0.88, y: ly + 0.16, w: 0.46, h: 0.46, fill: { color: MINT }, line: { type: "none" } });
    s.addText(String(i + 1), { x: 0.88, y: ly + 0.16, w: 0.46, h: 0.46, fontFace: HEAD, fontSize: 16, bold: true, color: NAVY, align: "center", valign: "middle", margin: 0 });
    s.addText([
      { text: st.t + "  ", options: { bold: true, color: INK, fontSize: 13.5 } },
      { text: "— " + st.d, options: { color: MUTE, fontSize: 12 } },
    ], { x: 1.5, y: ly, w: 4.6, h: 0.78, fontFace: BODY, valign: "middle", margin: 0 });
    ly += 0.92;
  });

  const sched = [
    { ic: I.layers, t: "Pool-ok & kapacitás", d: "Konzultáció / munka / kontroll külön kvótával; az első 3 kontroll szűkös „munka” erőforrás." },
    { ic: I.userClock, t: "No-show kockázat", d: "Előjegyzési táv, óra és a páciens 12 havi elmaradási aránya alapján becsült kockázat." },
    { ic: I.calCheck, t: "„Egy kemény következő”", d: "Epizódonként max. 1 jövőbeli munka-időpont — nincs túlfoglalás, tiszta sorrend." },
    { ic: I.hourglass, t: "Automatikus lejárat", d: "A lefoglalt, fel nem használt slot 5–10 percenként futó worker által felszabadul." },
  ];
  let hy = 2.15;
  sched.forEach((g) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 6.6, y: hy, w: 6.0, h: 1.02, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: 6.85, y: hy + 0.26, w: 0.55, h: 0.55, fill: { color: WHITE }, line: { color: TEAL, width: 1.3 } });
    s.addImage({ data: g.ic, x: 6.98, y: hy + 0.39, w: 0.29, h: 0.29 });
    s.addText(g.t, { x: 7.6, y: hy + 0.12, w: 4.85, h: 0.36, fontFace: HEAD, fontSize: 14, bold: true, color: INK, margin: 0 });
    s.addText(g.d, { x: 7.6, y: hy + 0.46, w: 4.85, h: 0.5, fontFace: BODY, fontSize: 11, color: MUTE, margin: 0, lineSpacingMultiple: 1.08 });
    hy += 1.12;
  });
  pageNum(s, 5);

  // =========================================================
  // 6 — KEZELÉSI TERVEK (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  darkKickerTitle(s, "Kezelési tervek", "Hogyan menedzselhetők a kezelési tervek");
  s.addText("A kezelési terv nem szabad szöveg, hanem ellátási útvonal (care pathway): sorba rendezett munkafázisok, amelyekből a rendszer kiszámolja a következő lépést és a várható befejezést.", {
    x: 0.7, y: 1.55, w: 11.9, h: 0.6, fontFace: BODY, fontSize: 14, color: ICE, italic: true, margin: 0, lineSpacingMultiple: 1.15,
  });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 2.45, w: 5.85, h: 3.75, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
  s.addImage({ data: I.diagram, x: 1.05, y: 2.8, w: 0.6, h: 0.6 });
  s.addText("Ahogy a terv felépül", { x: 1.8, y: 2.82, w: 4.6, h: 0.55, fontFace: HEAD, fontSize: 17, bold: true, color: WHITE, valign: "middle", margin: 0 });
  s.addText([
    { text: "Útvonal-sablon → epizód munkafázisai", options: { bullet: true, breakLine: true, bold: true } },
    { text: "Minden fázis: kód, pool, időtartam, eltolás-nap, kockázati kapu", options: { bullet: true, breakLine: true } },
    { text: "Több útvonal egyesített sorrendbe fésülve (seq)", options: { bullet: true, breakLine: true } },
    { text: "Státusz fázisonként: függő / ütemezett / kész / kihagyott", options: { bullet: true, breakLine: true } },
    { text: "Átállás folyamatban a normalizált terv-tételekre (episode_plan_items)", options: { bullet: true, italic: true, color: ICE } },
  ], { x: 1.05, y: 3.6, w: 5.3, h: 2.5, fontFace: BODY, fontSize: 12.5, color: WHITE, margin: 0, paraSpaceAfter: 7 });

  s.addShape(pres.shapes.RECTANGLE, { x: 6.75, y: 2.45, w: 5.85, h: 1.75, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
  s.addImage({ data: I.route, x: 7.1, y: 2.78, w: 0.55, h: 0.55 });
  s.addText("„Következő lépés” motor", { x: 7.8, y: 2.78, w: 4.6, h: 0.55, fontFace: HEAD, fontSize: 16, bold: true, color: WHITE, valign: "middle", margin: 0 });
  s.addText("Megadja a soron következő munkafázist és az időablakát — vagy jelzi, mi blokkolja (pl. hiányzó implantátum-terv, labor-árajánlat).", {
    x: 7.1, y: 3.4, w: 5.25, h: 0.85, fontFace: BODY, fontSize: 12, color: ICE, margin: 0, lineSpacingMultiple: 1.15,
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 6.75, y: 4.45, w: 5.85, h: 1.75, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
  s.addImage({ data: I.chart, x: 7.1, y: 4.78, w: 0.55, h: 0.55 });
  s.addText("Előrejelzés (forecast)", { x: 7.8, y: 4.78, w: 4.6, h: 0.55, fontFace: HEAD, fontSize: 16, bold: true, color: WHITE, valign: "middle", margin: 0 });
  s.addText([
    { text: "Hátralévő látogatások P50 / P80", options: { bold: true, color: MINT } },
    { text: "  és a várható befejezési ablak — útvonal-analitikából, determinisztikus gyorsítótárral.", options: { color: ICE } },
  ], { x: 7.1, y: 5.4, w: 5.25, h: 0.8, fontFace: BODY, fontSize: 12, margin: 0, lineSpacingMultiple: 1.15 });
  pageNum(s, 6, true);

  // =========================================================
  // 7 — KONZÍLIUMOK
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Konzíliumok");
  title(s, "Multidiszciplináris konzíliumok");
  lede(s, "A komplex maxillofaciális esetek közös döntéshozatala végigvezetve: előkészítés, meghívás, megbeszélés, döntés és delegálás — auditálható nyommal.");

  const cs = ["Vázlat", "Aktív ülés", "Lezárt"];
  let cx = 0.7;
  cs.forEach((t, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: 2.15, w: 2.35, h: 0.6, fill: { color: i === 2 ? TEAL : PANEL2 }, line: { type: "none" } });
    s.addText(t, { x: cx, y: 2.15, w: 2.35, h: 0.6, fontFace: HEAD, fontSize: 14, bold: true, color: i === 2 ? WHITE : TEAL_D, align: "center", valign: "middle", margin: 0 });
    if (i < 2) s.addText("→", { x: cx + 2.35, y: 2.15, w: 0.45, h: 0.6, fontFace: BODY, fontSize: 20, bold: true, color: TEAL, align: "center", valign: "middle", margin: 0 });
    cx += 2.8;
  });

  const conf = [
    { ic: I.users, t: "Meghívók & visszajelzés", d: "Résztvevők meghívása, RSVP (megyek / késem / új időpont) javasolt időponttal és megjegyzéssel." },
    { ic: I.share, t: "Előkészítő megosztó link", d: "Hashelt, lejáró token (alap 14 nap) — külső kolléga bejelentkezés nélkül megtekintheti az eset-előkészítést." },
    { ic: I.comments, t: "Napirend & döntés", d: "Esetenként ellenőrzőlista, strukturált döntésszöveg, előkészítő hozzászólások — időbélyeggel, szerzővel." },
    { ic: I.tasks, t: "Delegált feladatok", d: "A döntésből közvetlenül feladat keletkezik (felelős, határidő) az érintett munkatárs listájában." },
  ];
  let kx = 0.7, ky = 3.05; const kw = 5.85, kh = 1.5, kxg = 0.35, kyg = 0.28;
  conf.forEach((g, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = kx + col * (kw + kxg), y = ky + row * (kh + kyg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: kw, h: kh, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.32, w: 0.85, h: 0.85, fill: { color: WHITE }, line: { color: TEAL, width: 1.3 } });
    s.addImage({ data: g.ic, x: x + 0.51, y: y + 0.53, w: 0.43, h: 0.43 });
    s.addText(g.t, { x: x + 1.32, y: y + 0.25, w: kw - 1.5, h: 0.45, fontFace: HEAD, fontSize: 15, bold: true, color: INK, margin: 0, valign: "middle" });
    s.addText(g.d, { x: x + 1.32, y: y + 0.68, w: kw - 1.55, h: 0.75, fontFace: BODY, fontSize: 11.5, color: MUTE, margin: 0, lineSpacingMultiple: 1.12 });
  });
  s.addText("Prezentációs mód: a teljes ülés vetíthető a tárgyalóban; lezárás után az adatok rögzülnek.", {
    x: 0.7, y: 6.35, w: 11.9, h: 0.35, fontFace: BODY, fontSize: 12, color: TEAL_D, italic: true, margin: 0,
  });
  pageNum(s, 7);

  // =========================================================
  // 8 — AUTOMATIZÁLT FOLYAMATOK
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Automatizálás", MINT);
  title(s, "Automatizált folyamatok a háttérben");
  lede(s, "Ütemezett feladatok tartják karban az ellátást és az adatminőséget — emberi felügyelet nélkül, idempotens módon.");

  const hcell = (t) => ({ text: t, options: { bold: true, color: WHITE, fill: { color: TEAL }, fontFace: BODY, fontSize: 12.5, valign: "middle", align: "left", margin: [4, 8, 4, 8] } });
  const cell = (t, alt, opts = {}) => ({ text: t, options: Object.assign({ color: INK, fill: { color: alt ? PANEL2 : PANEL }, fontFace: BODY, fontSize: 12, valign: "middle", margin: [4, 8, 4, 8] }, opts) });
  const autoRows = [
    [hcell("Folyamat"), hcell("Mit csinál"), hcell("Kiváltó / gyakoriság")],
    [cell("OHIP-14 emlékeztetők", false, { bold: true }), cell("E-mail a páciensnek a nyitott életminőség-időpontról, portál-linkkel", false), cell("napi · 7 napos cooldown", false, { color: TEAL_D, bold: true })],
    [cell("Recall feladatok", true, { bold: true }), cell("Kontroll-feladatok generálása az átadáskor (STAGE_6)", true), cell("180 és 365 nap az átadástól", true, { color: TEAL_D, bold: true })],
    [cell("Feladat-emlékeztetők", false, { bold: true }), cell("Push és e-mail értesítés a saját és delegált feladatokról", false), cell("határidő előtt", false, { color: TEAL_D, bold: true })],
    [cell("Hiányzó-adat eszkaláció", true, { bold: true }), cell("Hiányzó kötelező mezők jelzése, fokozódó emlékeztetőkkel", true), cell("napi · eszkalációs létra", true, { color: TEAL_D, bold: true })],
    [cell("Hold / intent lejárat", false, { bold: true }), cell("Lefoglalt, fel nem használt slotok felszabadítása", false), cell("5–10 perc / ~6 óra", false, { color: TEAL_D, bold: true })],
  ];
  s.addTable(autoRows, {
    x: 0.7, y: 2.3, w: 11.9, colW: [3.1, 5.6, 3.2],
    rowH: [0.5, 0.66, 0.66, 0.66, 0.66, 0.66],
    border: { type: "solid", pt: 1.5, color: WHITE },
    valign: "middle",
  });
  pageNum(s, 8);

  // =========================================================
  // 9 — HIÁNYZÓ ADATOK / ADATMINŐSÉG
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Adatminőség");
  title(s, "Hiányzó adatok menedzselése");
  lede(s, "A teljesség mérhető és követhető — így a regiszter megbízható, a kutatható kohorsz pedig jól körülhatárolt.");

  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 2.15, w: 5.85, h: 4.05, fill: { color: PANEL }, line: { type: "none" } });
  s.addImage({ data: I.percent, x: 1.0, y: 2.42, w: 0.5, h: 0.5 });
  s.addText("Hogyan mérjük", { x: 1.62, y: 2.42, w: 4.5, h: 0.5, fontFace: HEAD, fontSize: 17, bold: true, color: TEAL_D, valign: "middle", margin: 0 });
  s.addText([
    { text: "Teljességi pontszám 0–100", options: { bold: true, color: INK, breakLine: true } },
    { text: "(alkalmazható − hiányzó) / alkalmazható × 100", options: { italic: true, color: MUTE, fontSize: 11.5 } },
  ], { x: 1.0, y: 3.05, w: 5.35, h: 0.75, fontFace: BODY, fontSize: 13, margin: 0, lineSpacingMultiple: 1.1 });
  s.addText([
    { text: "Kötelező mezők (NEAK-minimum): név, nem, születés, TAJ, e-mail, kezelés oka, diagnózis, fogazat", options: { bullet: true, breakLine: true } },
    { text: "Kötelező dokumentum: min. 1 OP panoráma röntgen", options: { bullet: true, breakLine: true } },
    { text: "Feltételes mezők csak ha relevánsak: TNM (onkológia), Brown (maxilla), Kovács-Dobák (mandibula), RT-dózis", options: { bullet: true, breakLine: true } },
    { text: "Plauzibilitás: TAJ-formátum, dátumlogika", options: { bullet: true } },
  ], { x: 1.0, y: 3.9, w: 5.4, h: 2.25, fontFace: BODY, fontSize: 11.5, color: INK, margin: 0, paraSpaceAfter: 6, lineSpacingMultiple: 1.1 });

  s.addShape(pres.shapes.RECTANGLE, { x: 6.75, y: 2.15, w: 5.85, h: 4.05, fill: { color: SAND }, line: { type: "none" } });
  s.addImage({ data: I.levelUp, x: 7.05, y: 2.42, w: 0.5, h: 0.5 });
  s.addText("Hogyan jelezzük & eszkaláljuk", { x: 7.67, y: 2.42, w: 4.85, h: 0.5, fontFace: HEAD, fontSize: 17, bold: true, color: "9A6A1A", valign: "middle", margin: 0 });
  s.addText([
    { text: "Napi pillanatkép & trend", options: { bullet: true, breakLine: true, bold: true } },
    { text: "Átlagos pontszám, klinikailag teljes, kutatásra kész, figyelmeztetéses — időben követve", options: { indentLevel: 1, breakLine: true, fontSize: 11.5, color: "6b5a3a" } },
    { text: "Orvosonkénti kohorsz-bontás", options: { bullet: true, breakLine: true, bold: true } },
    { text: "Ki melyik páciensénél mit hiányol — célzott pótlás", options: { indentLevel: 1, breakLine: true, fontSize: 11.5, color: "6b5a3a" } },
    { text: "Eszkalációs létra", options: { bullet: true, breakLine: true, bold: true } },
    { text: "A hiányzó adatra fokozódó emlékeztetők, amíg pótolják", options: { indentLevel: 1, fontSize: 11.5, color: "6b5a3a" } },
  ], { x: 7.05, y: 3.05, w: 5.4, h: 3.1, fontFace: BODY, fontSize: 12.5, color: INK, margin: 0, paraSpaceAfter: 5, lineSpacingMultiple: 1.08 });
  pageNum(s, 9);

  // =========================================================
  // 10 — HIPOTÉZISEK (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  darkKickerTitle(s, "Kutatás", "Milyen hipotézisek tesztelhetők", AMBER);
  s.addText("A strukturált klasszifikációk, az életminőség-idősorok és a kezelési metrikák konkrét klinikai kérdéseket nyitnak meg.", {
    x: 0.7, y: 1.55, w: 11.9, h: 0.5, fontFace: BODY, fontSize: 14, color: ICE, italic: true, margin: 0,
  });
  const hyps = [
    "A protetikai rehabilitáció javítja az OHIP-14 életminőséget (T0→T2); a hatás nagysága függ a defektus súlyosságától.",
    "A maxilla-defektus kiterjedése (Brown 1–4) előrejelzi az átadásig szükséges munkafázis-látogatások számát.",
    "A sugárterápiás dózis hosszabb kezelési idővel és kisebb életminőség-javulással jár.",
    "Az implantátum-megtámasztott protézis nagyobb OHIP-javulást ad, mint a konvencionális — a defektus-osztályra korrigálva.",
    "A no-show kockázati tényezők (előjegyzési táv, óra, korábbi elmaradás) valóban előrejelzik a meg nem jelenést.",
    "A nyálállapot (hypo-/hyperszaliváció) módosítja a beszéd- és nyelésfunkció kimenetét.",
  ];
  const colW = 5.85;
  hyps.forEach((t, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.7 + col * (colW + 0.35), y = 2.35 + row * 1.4;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: colW, h: 1.22, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.OVAL, { x: x + 0.25, y: y + 0.33, w: 0.56, h: 0.56, fill: { color: AMBER }, line: { type: "none" } });
    s.addText("H" + (i + 1), { x: x + 0.25, y: y + 0.33, w: 0.56, h: 0.56, fontFace: HEAD, fontSize: 14, bold: true, color: NAVY, align: "center", valign: "middle", margin: 0 });
    s.addText(t, { x: x + 1.0, y: y + 0.12, w: colW - 1.2, h: 1.0, fontFace: BODY, fontSize: 11.8, color: WHITE, margin: 0, valign: "middle", lineSpacingMultiple: 1.1 });
  });
  pageNum(s, 10, true);

  // =========================================================
  // 11 — STATISZTIKAI MODELLEZÉS
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Kutatás");
  title(s, "Milyen statisztikai modellezés végezhető");
  lede(s, "A regiszter adatszerkezete közvetlenül illeszkedik a standard biostatisztikai módszerekhez.");
  const stats = [
    { ic: I.wave, t: "Lineáris kevert modellek", d: "Ismételt OHIP-14 mérések (T0–T3); egyéni életminőség-trajektóriák random hatásokkal." },
    { ic: I.sqrt, t: "Túlélés-analízis", d: "Idő a protézis átadásáig / befejezésig — Kaplan–Meier, Cox-regresszió." },
    { ic: I.chartTeal, t: "Számlálás-regresszió", d: "Munkafázis-látogatások száma — Poisson / negatív binomiális modell." },
    { ic: I.userClockT, t: "Logisztikus regresszió", d: "No-show és sikertelen időpont előrejelzése, a beépített kockázati jellemzőkből." },
    { ic: I.routeT, t: "Korrekció & mediáció", d: "Konfounderek (kor, RT-dózis, defektus) kiszűrése; defektus → komplexitás → életminőség út." },
    { ic: I.users, t: "Alcsoport-elemzés", d: "Onkológiai vs. trauma vs. veleszületett esetek kimeneteinek összevetése." },
  ];
  let sx2 = 0.7, sy2 = 2.15; const sw2 = 3.85, sh2 = 1.95, sxg = 0.32, syg = 0.28;
  stats.forEach((f, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = sx2 + col * (sw2 + sxg), y = sy2 + row * (sh2 + syg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: sw2, h: sh2, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.3, w: 0.82, h: 0.82, fill: { color: WHITE }, line: { color: MINT, width: 1.4 } });
    s.addImage({ data: f.ic, x: x + 0.5, y: y + 0.5, w: 0.42, h: 0.42 });
    s.addText(f.t, { x: x + 1.3, y: y + 0.28, w: sw2 - 1.45, h: 0.6, fontFace: HEAD, fontSize: 14.5, bold: true, color: INK, margin: 0, valign: "middle", lineSpacingMultiple: 0.95 });
    s.addText(f.d, { x: x + 0.3, y: y + 1.18, w: sw2 - 0.6, h: 0.72, fontFace: BODY, fontSize: 11, color: MUTE, margin: 0, lineSpacingMultiple: 1.1 });
  });
  pageNum(s, 11);

  // =========================================================
  // 12 — HOZZÁJÁRULÁS & ETIKA (condensed)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Megfelelőség", AMBER);
  title(s, "Hozzájárulás és etikai keret — röviden");
  lede(s, "A kutatási felhasználás jogilag tiszta alapokon áll; a regiszter klinikai adatként mindig rendelkezésre áll, kutatási exportként szigorúan kapuzva.");
  const comp = [
    { ic: I.balance, t: "Kétpilléres hozzájárulás", d: "Adatvédelmi tájékoztató tudomásulvétele (klinikai adat) külön a kutatási hozzájárulástól (önkéntes, visszavonható)." },
    { ic: I.lock, t: "De-identifikált export", d: "Korsáv és régió-előtag pontos adat helyett; személyazonosító (név, TAJ, e-mail) soha nem kerül exportba." },
    { ic: I.shield, t: "Etikai kapu", d: "Export csak érvényes etikai engedéllyel (ETT TUKEB); addig szándékosan tiltva — a klinikai működést ez nem érinti." },
  ];
  let mx = 0.7; const mw = 3.85, mgap = 0.32;
  comp.forEach((p) => {
    s.addShape(pres.shapes.RECTANGLE, { x: mx, y: 2.35, w: mw, h: 3.5, fill: { color: PANEL }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.OVAL, { x: mx + 0.35, y: 2.75, w: 1.0, h: 1.0, fill: { color: WHITE }, line: { color: MINT, width: 1.5 } });
    s.addImage({ data: p.ic, x: mx + 0.6, y: 3.0, w: 0.5, h: 0.5 });
    s.addText(p.t, { x: mx + 0.35, y: 3.95, w: mw - 0.7, h: 0.6, fontFace: HEAD, fontSize: 16, bold: true, color: INK, margin: 0, lineSpacingMultiple: 0.95 });
    s.addText(p.d, { x: mx + 0.35, y: 4.55, w: mw - 0.7, h: 1.25, fontFace: BODY, fontSize: 12, color: MUTE, margin: 0, lineSpacingMultiple: 1.15 });
    mx += mw + mgap;
  });
  s.addText("Megjegyzés: a jogi keret a megismert GDPR / 1997. évi CLIV. tv. elvárások szerint épült, szakmai (DPO) jóváhagyásra vár — nem jogi tanács.", {
    x: 0.7, y: 6.1, w: 11.9, h: 0.4, fontFace: BODY, fontSize: 10.5, color: MUTE, italic: true, margin: 0,
  });
  pageNum(s, 12);

  // =========================================================
  // 13 — ÖSSZEFOGLALÓ / ZÁRÓ (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape(pres.shapes.OVAL, { x: -2.2, y: 3.8, w: 6.5, h: 6.5, fill: { color: TEAL_D, transparency: 55 }, line: { type: "none" } });
  s.addShape(pres.shapes.OVAL, { x: -0.9, y: 5.1, w: 4, h: 4, fill: { color: TEAL, transparency: 65 }, line: { type: "none" } });
  s.addText("ÖSSZEFOGLALÓ", { x: 0.9, y: 1.0, w: 9, h: 0.4, fontFace: BODY, fontSize: 13, color: MINT, bold: true, charSpacing: 4, margin: 0 });
  s.addText("A klinikai munka kutatási tőkévé válik", { x: 0.85, y: 1.45, w: 11.6, h: 0.9, fontFace: HEAD, fontSize: 32, color: WHITE, bold: true, margin: 0 });
  const tk = [
    { ic: I.database, t: "Élő betegregiszter", d: "Longitudinális, szabványosított adat — egyetlen hiteles forrásból." },
    { ic: I.sync, t: "Automatizált működés", d: "Időpont, recall, OHIP, feladat és hiányzó-adat — felügyelet nélkül." },
    { ic: I.chart, t: "Kutatható kimenet", d: "Konkrét hipotézisek és standard statisztikai modellek a regiszteren." },
  ];
  let tx = 0.9, ty = 2.75; const tw = 3.75, tgap = 0.3;
  tk.forEach((t) => {
    s.addShape(pres.shapes.RECTANGLE, { x: tx, y: ty, w: tw, h: 2.7, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.OVAL, { x: tx + 0.35, y: ty + 0.35, w: 0.95, h: 0.95, fill: { color: NAVY }, line: { color: MINT, width: 1.5 } });
    s.addImage({ data: t.ic, x: tx + 0.58, y: ty + 0.58, w: 0.5, h: 0.5 });
    s.addText(t.t, { x: tx + 0.35, y: ty + 1.45, w: tw - 0.6, h: 0.55, fontFace: HEAD, fontSize: 16, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 0.95 });
    s.addText(t.d, { x: tx + 0.35, y: ty + 2.0, w: tw - 0.6, h: 0.65, fontFace: BODY, fontSize: 11.5, color: ICE, margin: 0, lineSpacingMultiple: 1.12 });
    tx += tw + tgap;
  });
  s.addText("Köszönöm a figyelmet — kérdések, észrevételek?", { x: 0.9, y: 5.85, w: 11.5, h: 0.6, fontFace: HEAD, fontSize: 18, color: ICE, italic: true, margin: 0 });

  await pres.writeFile({ fileName: "/Users/janoskonig/maxillofacialisrehabilitacio/presentation/Kutatas_Regiszter_App.pptx" });
  console.log("written");
}

main().catch((e) => { console.error(e); process.exit(1); });
