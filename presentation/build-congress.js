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
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(IconComponent, { color, size: String(size) }));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
const shadow = () => ({ type: "outer", color: "000000", blur: 7, offset: 3, angle: 135, opacity: 0.16 });

async function main() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "Maxillofacial Rehabilitation Registry";
  pres.title = "A digital registry for maxillofacial prosthetic rehabilitation";

  const I = {
    toothIce: await icon(fa.FaTooth, "#" + ICE),
    book: await icon(fa.FaBookMedical, "#" + TEAL),
    bullseye: await icon(fa.FaBullseye, "#" + MINT),
    database: await icon(fa.FaDatabase, "#" + TEAL),
    micro: await icon(fa.FaMicroscope, "#" + MINT),
    chart: await icon(fa.FaChartLine, "#" + MINT),
    chartTeal: await icon(fa.FaChartLine, "#" + TEAL),
    route: await icon(fa.FaRoute, "#" + TEAL),
    cal: await icon(fa.FaCalendarCheck, "#" + TEAL),
    userClock: await icon(fa.FaUserClock, "#" + TEAL),
    users: await icon(fa.FaUserFriends, "#" + TEAL),
    notes: await icon(fa.FaNotesMedical, "#" + TEAL),
    radiation: await icon(fa.FaRadiationAlt, "#" + TEAL),
    teeth: await icon(fa.FaTeeth, "#" + TEAL),
    diagram: await icon(fa.FaProjectDiagram, "#" + TEAL),
    diagramIce: await icon(fa.FaProjectDiagram, "#" + ICE),
    warn: await icon(fa.FaExclamationTriangle, "#" + AMBER),
    check: await icon(fa.FaCheckCircle, "#" + MINT),
    shield: await icon(fa.FaShieldAlt, "#" + MINT),
    balance: await icon(fa.FaBalanceScale, "#" + TEAL),
    list: await icon(fa.FaListOl, "#" + ICE),
    stetho: await icon(fa.FaStethoscope, "#" + TEAL),
    sync: await icon(fa.FaSyncAlt, "#" + TEAL),
    comments: await icon(fa.FaComments, "#" + TEAL),
    flask: await icon(fa.FaFlask, "#" + MINT),
  };

  // ---------- helpers ----------
  const kicker = (s, t, c = TEAL) => s.addText(t.toUpperCase(), { x: 0.7, y: 0.42, w: 11.5, h: 0.32, fontFace: BODY, fontSize: 12, color: c, bold: true, charSpacing: 3, margin: 0 });
  const title = (s, t, c = INK, sz = 29) => s.addText(t, { x: 0.7, y: 0.72, w: 12.2, h: 0.9, fontFace: HEAD, fontSize: sz, color: c, bold: true, margin: 0 });
  const lede = (s, t, c = MUTE) => s.addText(t, { x: 0.7, y: 1.55, w: 11.9, h: 0.55, fontFace: BODY, fontSize: 13.5, color: c, margin: 0, lineSpacingMultiple: 1.12 });
  function pageNum(s, n, dark = false) {
    s.addText(String(n).padStart(2, "0"), { x: 12.5, y: 6.95, w: 0.6, h: 0.3, fontFace: BODY, fontSize: 10, color: dark ? ICE : MUTE, align: "right", margin: 0 });
    s.addText("EPA 2026 · Prague · Maxillofacial prosthetic rehabilitation registry", { x: 0.7, y: 6.95, w: 10, h: 0.3, fontFace: BODY, fontSize: 9, color: dark ? "6E8C8C" : MUTE, margin: 0 });
  }
  const darkHead = (s, k, t, kc = MINT) => { s.addText(k.toUpperCase(), { x: 0.7, y: 0.42, w: 11.5, h: 0.32, fontFace: BODY, fontSize: 12, color: kc, bold: true, charSpacing: 3, margin: 0 }); s.addText(t, { x: 0.7, y: 0.72, w: 12.2, h: 0.9, fontFace: HEAD, fontSize: 29, color: WHITE, bold: true, margin: 0 }); };
  // stat tile
  function stat(s, x, y, w, big, label, sub, accent = MINT) {
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 1.5, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.1, h: 1.5, fill: { color: accent }, line: { type: "none" } });
    s.addText(big, { x: x + 0.28, y: y + 0.12, w: w - 0.4, h: 0.62, fontFace: HEAD, fontSize: 30, bold: true, color: TEAL_D, margin: 0 });
    s.addText(label, { x: x + 0.28, y: y + 0.74, w: w - 0.4, h: 0.34, fontFace: BODY, fontSize: 12.5, bold: true, color: INK, margin: 0 });
    if (sub) s.addText(sub, { x: x + 0.28, y: y + 1.06, w: w - 0.4, h: 0.36, fontFace: BODY, fontSize: 10.5, color: MUTE, margin: 0, lineSpacingMultiple: 1.0 });
  }

  // =========================================================
  // 1 — TITLE
  // =========================================================
  let s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape(pres.shapes.OVAL, { x: 9.6, y: -2.2, w: 6.5, h: 6.5, fill: { color: TEAL_D, transparency: 55 }, line: { type: "none" } });
  s.addShape(pres.shapes.OVAL, { x: 10.9, y: -0.9, w: 4, h: 4, fill: { color: TEAL, transparency: 65 }, line: { type: "none" } });
  s.addImage({ data: I.toothIce, x: 11.55, y: 0.55, w: 0.85, h: 0.85 });
  s.addText("EPA 2026 · PRAGUE · 1–3 OCTOBER", { x: 0.9, y: 1.4, w: 10, h: 0.4, fontFace: BODY, fontSize: 13, color: MINT, bold: true, charSpacing: 3, margin: 0 });
  s.addText("A purpose-built digital registry for maxillofacial prosthetic rehabilitation", {
    x: 0.85, y: 1.85, w: 11.4, h: 1.5, fontFace: HEAD, fontSize: 33, color: WHITE, bold: true, margin: 0, lineSpacingMultiple: 1.02,
  });
  s.addText("Design and baseline cohort of 144 patients", { x: 0.9, y: 3.45, w: 11.4, h: 0.6, fontFace: HEAD, fontSize: 21, color: ICE, italic: true, margin: 0 });
  s.addShape(pres.shapes.LINE, { x: 0.92, y: 4.25, w: 2.4, h: 0, line: { color: MINT, width: 2.5 } });
  s.addText([
    { text: "[Author A, Author B, …]", options: { color: WHITE, bold: true, breakLine: true } },
    { text: "[Department / Clinic, City, Hungary]", options: { color: ICE, fontSize: 13 } },
  ], { x: 0.9, y: 4.5, w: 10, h: 0.9, fontFace: BODY, fontSize: 15, margin: 0, lineSpacingMultiple: 1.2 });
  s.addText("Methodology & baseline-cohort presentation · placeholders [in brackets] to be completed", {
    x: 0.9, y: 6.65, w: 11, h: 0.35, fontFace: BODY, fontSize: 11, color: "6E8C8C", italic: true, margin: 0,
  });

  // =========================================================
  // 2 — BACKGROUND
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Background");
  title(s, "Why a dedicated registry?");
  lede(s, "Maxillofacial prosthetic rehabilitation is low-volume, highly heterogeneous and interdisciplinary — conditions under which routine records rarely yield analysable outcome data.");
  const bg = [
    { ic: I.users, t: "Heterogeneous, low-volume", d: "Post-oncologic, congenital and traumatic defects; small numbers per centre limit single-study power." },
    { ic: I.notes, t: "Fragmented documentation", d: "Free-text notes and scattered files make standardised, longitudinal outcome capture impractical." },
    { ic: I.balance, t: "Outcome data is scarce", d: "Patient-reported quality of life (OHIP-14) and treatment-burden metrics are seldom collected systematically." },
    { ic: I.database, t: "Routine care as data source", d: "A structured, classification-driven registry can turn everyday clinical work into research-ready data." },
  ];
  let bx = 0.7, by = 2.35; const bw = 5.85, bh = 1.85, bxg = 0.35, byg = 0.3;
  bg.forEach((g, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = bx + col * (bw + bxg), y = by + row * (bh + byg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: bw, h: bh, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.32, y: y + 0.45, w: 0.95, h: 0.95, fill: { color: WHITE }, line: { color: TEAL, width: 1.4 } });
    s.addImage({ data: g.ic, x: x + 0.55, y: y + 0.68, w: 0.49, h: 0.49 });
    s.addText(g.t, { x: x + 1.5, y: y + 0.32, w: bw - 1.7, h: 0.5, fontFace: HEAD, fontSize: 16.5, bold: true, color: INK, margin: 0, valign: "middle" });
    s.addText(g.d, { x: x + 1.5, y: y + 0.85, w: bw - 1.75, h: 0.9, fontFace: BODY, fontSize: 12, color: MUTE, margin: 0, lineSpacingMultiple: 1.15 });
  });
  pageNum(s, 2);

  // =========================================================
  // 3 — AIM (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  darkHead(s, "Aim", "Objective of this work");
  s.addImage({ data: I.bullseye, x: 0.95, y: 2.5, w: 1.1, h: 1.1 });
  s.addText("To describe the design of a purpose-built digital registry for maxillofacial prosthetic rehabilitation, and to report the baseline characteristics of the enrolled cohort.", {
    x: 2.4, y: 2.4, w: 9.9, h: 1.5, fontFace: HEAD, fontSize: 23, color: WHITE, margin: 0, lineSpacingMultiple: 1.18,
  });
  s.addShape(pres.shapes.LINE, { x: 2.42, y: 4.05, w: 9.6, h: 0, line: { color: TEAL, width: 1 } });
  s.addText([
    { text: "Secondary: ", options: { bold: true, color: MINT } },
    { text: "to pre-specify the longitudinal hypotheses and statistical models the registry is designed to support, once follow-up has accrued.", options: { color: ICE } },
  ], { x: 2.4, y: 4.25, w: 9.9, h: 1.0, fontFace: BODY, fontSize: 15, margin: 0, lineSpacingMultiple: 1.2 });
  pageNum(s, 3, true);

  // =========================================================
  // 4 — METHODS: registry design
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Methods · 1");
  title(s, "Registry design: structured, classification-driven");
  lede(s, "Single-centre tertiary unit. Data captured prospectively during routine care, on a PostgreSQL-backed platform, using standardised clinical classifications.");
  const md = [
    { ic: I.notes, t: "Standardised intake", d: "Demographics, referral, oncologic history, adjuvant therapy (radiotherapy dose, chemotherapy)." },
    { ic: I.radiation, t: "Defect classifications", d: "Maxilla — Brown; mandible — Kovács-Dobák; prosthetic status — Fábián-Fejérdy; TNM staging." },
    { ic: I.teeth, t: "Dental & prosthetic status", d: "Existing teeth (Zsigmondy), implants and prostheses captured as structured records." },
    { ic: I.micro, t: "Outcome instrument", d: "OHIP-14 patient-reported quality of life, staged at fixed timepoints (T0–T3)." },
  ];
  let mx = 0.7, my = 2.35; const mw = 5.85, mh = 1.85, mxg = 0.35, myg = 0.3;
  md.forEach((g, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = mx + col * (mw + mxg), y = my + row * (mh + myg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: mw, h: mh, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.32, y: y + 0.45, w: 0.95, h: 0.95, fill: { color: WHITE }, line: { color: TEAL, width: 1.4 } });
    s.addImage({ data: g.ic, x: x + 0.55, y: y + 0.68, w: 0.49, h: 0.49 });
    s.addText(g.t, { x: x + 1.5, y: y + 0.32, w: mw - 1.7, h: 0.5, fontFace: HEAD, fontSize: 16, bold: true, color: INK, margin: 0, valign: "middle" });
    s.addText(g.d, { x: x + 1.5, y: y + 0.85, w: mw - 1.75, h: 0.9, fontFace: BODY, fontSize: 12, color: MUTE, margin: 0, lineSpacingMultiple: 1.15 });
  });
  pageNum(s, 4);

  // =========================================================
  // 5 — METHODS: automation & care coordination (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  darkHead(s, "Methods · 2", "Care coordination & automated data capture");
  s.addText("The same platform runs the clinic — so data quality is a by-product of routine workflow, not an extra task.", {
    x: 0.7, y: 1.55, w: 11.9, h: 0.5, fontFace: BODY, fontSize: 13.5, color: ICE, italic: true, margin: 0,
  });
  const au = [
    { ic: I.cal, t: "Deterministic scheduling", d: "Care-pathway templates drive booking; a built-in no-show risk model flags high-risk visits." },
    { ic: I.route, t: "Treatment-plan engine", d: "Next-step computation and visit-count forecasting (P50/P80) per treatment episode." },
    { ic: I.comments, t: "Multidisciplinary consilium", d: "Structured case conferences with invitations, decisions and delegated tasks — audit-tracked." },
    { ic: I.sync, t: "Automated reminders", d: "Scheduled jobs for OHIP-14 follow-up, recall tasks and missing-data escalation." },
  ];
  let ax = 0.7, ay = 2.45; const aw = 5.85, ah = 1.85, axg = 0.35, ayg = 0.3;
  au.forEach((g, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = ax + col * (aw + axg), y = ay + row * (ah + ayg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: aw, h: ah, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.OVAL, { x: x + 0.32, y: y + 0.45, w: 0.95, h: 0.95, fill: { color: NAVY }, line: { color: MINT, width: 1.4 } });
    s.addImage({ data: g.ic === I.route ? I.diagramIce : g.ic, x: x + 0.55, y: y + 0.68, w: 0.49, h: 0.49 });
    s.addText(g.t, { x: x + 1.5, y: y + 0.32, w: aw - 1.7, h: 0.5, fontFace: HEAD, fontSize: 16, bold: true, color: WHITE, margin: 0, valign: "middle" });
    s.addText(g.d, { x: x + 1.5, y: y + 0.85, w: aw - 1.75, h: 0.9, fontFace: BODY, fontSize: 12, color: ICE, margin: 0, lineSpacingMultiple: 1.15 });
  });
  pageNum(s, 5, true);

  // =========================================================
  // 6 — RESULTS: baseline cohort
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Results · 1", MINT);
  title(s, "Baseline cohort");
  // stat tiles
  stat(s, 0.7, 1.7, 2.75, "144", "patients enrolled", "142 living · 2 deceased", MINT);
  stat(s, 3.62, 1.7, 2.75, "86", "treatment episodes", "78 open · 8 closed", TEAL);
  stat(s, 0.7, 3.35, 2.75, "63", "median age (years)", "54% female (of known sex)", AMBER);
  stat(s, 3.62, 3.35, 2.75, "275", "clinical documents", "across 82 patients", TEAL);

  // etiology doughnut
  s.addText("Etiology of treatment episodes", { x: 7.0, y: 1.7, w: 5.6, h: 0.4, fontFace: HEAD, fontSize: 15, bold: true, color: TEAL_D, margin: 0 });
  s.addChart(pres.charts.DOUGHNUT, [{ name: "Etiology", labels: ["Post-oncologic", "Congenital", "Traumatic"], values: [65, 18, 3] }], {
    x: 7.0, y: 2.05, w: 5.6, h: 4.0, holeSize: 55,
    chartColors: [TEAL, MINT, AMBER],
    showLegend: true, legendPos: "b", legendFontSize: 12, legendColor: INK,
    showValue: false, showPercent: true, dataLabelColor: WHITE, dataLabelFontSize: 12, dataLabelFontBold: true,
    chartArea: { fill: { color: WHITE } },
  });
  s.addText("Post-oncologic defects predominate (≈76%).", { x: 0.7, y: 5.25, w: 5.7, h: 0.5, fontFace: BODY, fontSize: 12.5, italic: true, color: MUTE, margin: 0 });
  pageNum(s, 6);

  // =========================================================
  // 7 — RESULTS: oncologic & defect profile
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Results · 2", MINT);
  title(s, "Oncologic burden & defect profile");
  const prof = [
    { big: "31", l: "radiotherapy", sub: "mean dose 53.3 Gy", c: TEAL },
    { big: "28", l: "TNM-staged", sub: "oncologic cases", c: TEAL },
    { big: "9", l: "chemotherapy", sub: "documented", c: TEAL },
    { big: "19", l: "maxillary defects", sub: "Brown-classified: 13", c: AMBER },
    { big: "24", l: "mandibular defects", sub: "Kovács-Dobák: 10", c: AMBER },
    { big: "44", l: "Fábián-Fejérdy", sub: "prosthetic class recorded", c: MINT },
  ];
  let px2 = 0.7, py2 = 1.95; const pw2 = 3.85, ph2 = 1.5, pxg = 0.32, pyg = 0.3;
  prof.forEach((g, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = px2 + col * (pw2 + pxg), y = py2 + row * (ph2 + pyg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: pw2, h: ph2, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.1, h: ph2, fill: { color: g.c }, line: { type: "none" } });
    s.addText(g.big, { x: x + 0.3, y: y + 0.12, w: 1.4, h: 1.25, fontFace: HEAD, fontSize: 40, bold: true, color: TEAL_D, margin: 0, valign: "middle" });
    s.addText([
      { text: g.l, options: { bold: true, color: INK, fontSize: 14, breakLine: true } },
      { text: g.sub, options: { color: MUTE, fontSize: 11.5 } },
    ], { x: x + 1.7, y: y + 0.12, w: pw2 - 1.9, h: 1.25, fontFace: BODY, margin: 0, valign: "middle", lineSpacingMultiple: 1.1 });
  });
  s.addText("Predominantly post-oncologic, irradiated, adult cohort — the population in which prosthetic rehabilitation is most demanding.", {
    x: 0.7, y: 5.95, w: 11.9, h: 0.5, fontFace: BODY, fontSize: 12.5, italic: true, color: MUTE, margin: 0,
  });
  pageNum(s, 7);

  // =========================================================
  // 8 — RESULTS: care delivery & data capture
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Results · 3", MINT);
  title(s, "Care delivery & data capture");

  // appointments bar
  s.addText("Appointment outcomes (realised visits)", { x: 0.7, y: 1.75, w: 5.8, h: 0.4, fontFace: HEAD, fontSize: 15, bold: true, color: TEAL_D, margin: 0 });
  s.addChart(pres.charts.BAR, [{ name: "Visits", labels: ["Completed", "No-show", "Cancelled", "Unsuccessful"], values: [150, 7, 11, 2] }], {
    x: 0.55, y: 2.15, w: 6.0, h: 3.6, barDir: "col",
    chartColors: [MINT, RED, AMBER, MUTE],
    showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFontSize: 12, dataLabelFontBold: true,
    catAxisLabelColor: "64748B", catAxisLabelFontSize: 11, valAxisHidden: true, valGridLine: { style: "none" },
    showLegend: false, chartArea: { fill: { color: WHITE } }, barGapWidthPct: 60,
  });

  // right stat tiles
  stat(s, 7.0, 1.95, 5.6, "329", "appointments scheduled", "across 101 patients", TEAL);
  s.addShape(pres.shapes.RECTANGLE, { x: 7.0, y: 3.6, w: 5.6, h: 1.5, fill: { color: PANEL2 }, line: { type: "none" } });
  s.addShape(pres.shapes.RECTANGLE, { x: 7.0, y: 3.6, w: 0.1, h: 1.5, fill: { color: MINT }, line: { type: "none" } });
  s.addText("4.4%", { x: 7.28, y: 3.7, w: 2.4, h: 0.62, fontFace: HEAD, fontSize: 30, bold: true, color: TEAL_D, margin: 0 });
  s.addText([
    { text: "observed no-show rate", options: { bold: true, color: INK, fontSize: 12.5, breakLine: true } },
    { text: "vs. model-predicted mean risk 0.044 — well-calibrated", options: { color: MUTE, fontSize: 11 } },
  ], { x: 7.28, y: 4.32, w: 5.1, h: 0.7, fontFace: BODY, margin: 0, lineSpacingMultiple: 1.05 });
  s.addText([
    { text: "6 ", options: { bold: true, color: TEAL_D } }, { text: "consilium sessions · ", options: { color: INK } },
    { text: "26 ", options: { bold: true, color: TEAL_D } }, { text: "cases discussed · ", options: { color: INK } },
    { text: "14 ", options: { bold: true, color: TEAL_D } }, { text: "care-pathway templates", options: { color: INK } },
  ], { x: 7.0, y: 5.3, w: 5.6, h: 0.5, fontFace: BODY, fontSize: 12.5, margin: 0 });
  s.addText("OHIP-14 baseline (T0) captured in 30 patients — mean 25.4 (SD 12.6); follow-up accrual ongoing.", {
    x: 0.7, y: 5.95, w: 11.9, h: 0.5, fontFace: BODY, fontSize: 12.5, italic: true, color: MUTE, margin: 0,
  });
  pageNum(s, 8);

  // =========================================================
  // 9 — PLANNED ANALYSES (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  darkHead(s, "Planned analyses", "What the registry is built to answer", AMBER);
  s.addText("Pre-specified once longitudinal follow-up matures — the data structure already supports these designs.", {
    x: 0.7, y: 1.55, w: 11.9, h: 0.5, fontFace: BODY, fontSize: 13.5, color: ICE, italic: true, margin: 0,
  });
  const plan = [
    { h: "OHIP-14 trajectories", d: "QoL change after prosthetic rehabilitation (T0→T3) by defect severity — linear mixed-effects models." },
    { h: "Treatment burden", d: "Time-to-delivery and visit count vs. defect class and radiotherapy — survival & count regression." },
    { h: "Implant vs. conventional", d: "Differential OHIP-14 gain, adjusted for defect class and irradiation." },
    { h: "No-show prediction", d: "External validation of the built-in risk model — logistic regression, calibration." },
  ];
  let qx = 0.7, qy = 2.45; const qw = 5.85, qh = 1.7, qxg = 0.35, qyg = 0.28;
  plan.forEach((g, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = qx + col * (qw + qxg), y = qy + row * (qh + qyg);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: qw, h: qh, fill: { color: TEAL_D }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.32, w: 0.6, h: 0.6, fill: { color: AMBER }, line: { type: "none" } });
    s.addText("H" + (i + 1), { x: x + 0.3, y: y + 0.32, w: 0.6, h: 0.6, fontFace: HEAD, fontSize: 14, bold: true, color: NAVY, align: "center", valign: "middle", margin: 0 });
    s.addText(g.h, { x: x + 1.05, y: y + 0.25, w: qw - 1.3, h: 0.45, fontFace: HEAD, fontSize: 16, bold: true, color: WHITE, margin: 0 });
    s.addText(g.d, { x: x + 1.05, y: y + 0.72, w: qw - 1.3, h: 0.85, fontFace: BODY, fontSize: 11.8, color: ICE, margin: 0, lineSpacingMultiple: 1.12 });
  });
  pageNum(s, 9, true);

  // =========================================================
  // 10 — LIMITATIONS
  // =========================================================
  s = pres.addSlide();
  s.background = { color: WHITE };
  kicker(s, "Limitations", AMBER);
  title(s, "Limitations & current status");
  lede(s, "Reported transparently — this is a baseline-and-methods report, not an outcome study.");
  const lim = [
    "Single-centre cohort; findings are descriptive and not yet generalisable.",
    "Longitudinal OHIP-14 not yet mature — currently 1 patient with ≥2 timepoints; no paired T0→T2 yet.",
    "Some classification fields incomplete; ongoing data curation and quality scoring.",
    "Research consent and ethics (ETT TUKEB) approval pending — export-based analyses are future work.",
  ];
  let lx = 0.7, ly2 = 2.45;
  lim.forEach((t) => {
    s.addShape(pres.shapes.RECTANGLE, { x: lx, y: ly2, w: 11.9, h: 0.92, fill: { color: SAND }, line: { type: "none" } });
    s.addImage({ data: I.warn, x: lx + 0.28, y: ly2 + 0.27, w: 0.4, h: 0.4 });
    s.addText(t, { x: lx + 0.95, y: ly2, w: 10.7, h: 0.92, fontFace: BODY, fontSize: 13.5, color: INK, margin: 0, valign: "middle", lineSpacingMultiple: 1.05 });
    ly2 += 1.04;
  });
  pageNum(s, 10);

  // =========================================================
  // 11 — CONCLUSION (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape(pres.shapes.OVAL, { x: -2.2, y: 3.8, w: 6.5, h: 6.5, fill: { color: TEAL_D, transparency: 55 }, line: { type: "none" } });
  s.addShape(pres.shapes.OVAL, { x: -0.9, y: 5.1, w: 4, h: 4, fill: { color: TEAL, transparency: 65 }, line: { type: "none" } });
  s.addText("CONCLUSION", { x: 0.9, y: 1.0, w: 9, h: 0.4, fontFace: BODY, fontSize: 13, color: MINT, bold: true, charSpacing: 4, margin: 0 });
  s.addText("Routine care, captured as research-ready data", { x: 0.85, y: 1.45, w: 11.6, h: 0.9, fontFace: HEAD, fontSize: 30, color: WHITE, bold: true, margin: 0 });
  const tk = [
    { ic: I.database, t: "A working registry", d: "144 patients, 86 episodes and 329 visits captured prospectively in routine care." },
    { ic: I.check, t: "Standardised & structured", d: "Defect classifications and OHIP-14 baseline make the cohort analysable." },
    { ic: I.chart, t: "Built for outcomes research", d: "Pre-specified longitudinal designs await follow-up accrual." },
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
  s.addText("Thank you — [author] · [institution] · [e-mail]", { x: 0.9, y: 5.9, w: 11.5, h: 0.5, fontFace: HEAD, fontSize: 16, color: ICE, italic: true, margin: 0 });

  await pres.writeFile({ fileName: "/Users/janoskonig/maxillofacialisrehabilitacio/presentation/EPA2026_Maxillofacial_Registry.pptx" });
  console.log("written");
}
main().catch((e) => { console.error(e); process.exit(1); });
