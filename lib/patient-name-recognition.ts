/**
 * Automatikus beteg-felismerés chat üzenetekben.
 *
 * A klinikusok ritkán használják az `@vezeteknev+keresztnev` szintaxist — a
 * beteg nevét egyszerűen beleírják a mondatba ("Megbeszéltem Kovács Jánossal a
 * kontrollt"). Ez a modul a szabad szövegből ismeri fel a betegeket **teljes
 * név** (vezetéknév + keresztnév) és **TAJ-szám** alapján, ékezet-érzéketlenül
 * és a magyar toldalékokat (pl. „Jánossal") tűrve.
 *
 * Tisztán (DB nélkül) tesztelhető: a beteg-névsort paraméterként kapja.
 */

/** A felismeréshez szükséges minimális beteg-mező halmaz. */
export interface PatientRosterEntry {
  id: string;
  nev: string;
  taj?: string | null;
}

/**
 * Egy felismert szakasz a szövegben. `candidates` általában egyetlen beteg;
 * azonos nevű betegeknél több is lehet (`ambiguous: true`) — ilyenkor a TAJ
 * vagy a felhasználói megerősítés oldja fel.
 */
export interface PatientDetection {
  /** A felismert szövegrész (az eredeti szövegből kivágva). */
  matchedText: string;
  /** Karakter-offszet az eredeti szövegben (highlight-hoz). */
  start: number;
  end: number;
  /** Név- vagy TAJ-alapú találat. */
  kind: 'name' | 'taj';
  /** A szóba jövő betegek (TAJ-nál mindig 0 vagy 1). */
  candidates: PatientRosterEntry[];
  /** Több, azonos nevű beteg → egyértelműsítés szükséges. */
  ambiguous: boolean;
}

interface Token {
  /** Ékezet nélküli, kisbetűs alak. */
  norm: string;
  start: number;
  end: number;
}

/** Kisbetűsít és eltávolítja az ékezeteket (NFD + combining mark strip). */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Csak a számjegyeket tartja meg (TAJ-összevetéshez). */
function normalizeTaj(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * A beteg nevéből a legacy mention-slug (`@vezeteknev+keresztnev`). Szándékosan
 * megegyezik a `lib/mention-parser.normalizeToMentionFormat` logikájával, de itt
 * inline, hogy a modul tisztán (DB nélkül) maradjon és kliensen is fusson.
 */
function mentionSlug(nev: string): string {
  const slug = normalizeName(nev)
    .replace(/\s+/g, '+')
    .replace(/[^a-z0-9+]/g, '');
  return slug ? `@${slug}` : '';
}

/** Szó-tokenek offszettel. A `norm` ékezet nélküli; az offszetek az eredetire mutatnak. */
// Szó-token = betűk (latin + magyar ékezetes) és számjegyek futama. Szándékosan
// nem `\p{L}` / `u` flag, mert a tsconfig `target: es5`. Az À-ÿ tartomány lefedi
// a latin-1 ékezeteseket; a magyar ő/ű (U+0150–U+0171) külön szerepel.
const WORD_TOKEN_RE = /[0-9A-Za-zÀ-ÿŐőŰű]+/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = new RegExp(WORD_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({
      norm: normalizeName(m[0]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

/** A beteg `nev` mezőjéből ékezet nélküli token-tömb. */
function nameTokens(nev: string): string[] {
  return normalizeName(nev).split(/\s+/).filter(Boolean);
}

/**
 * Felismeri a teljes neveket és TAJ-számokat a szövegben.
 *
 * Név: a beteg minden névtokenje előfordul összefüggő szó-sorozatként; az utolsó
 * token prefix-egyezést is elfogad (toldalék-tűrés, pl. „Jánossal" → „janos").
 * Csak ≥2 tokenes (vezeték+kereszt) nevek számítanak, hogy egy puszta keresztnév
 * ne adjon téves találatot.
 */
export function recognizePatientsInText(
  text: string,
  roster: PatientRosterEntry[],
): PatientDetection[] {
  return dedupeDetections(collectDetections(text, roster));
}

/** Minden nyers találat (offszettel, dedupe nélkül) — a rendereléshez is ez kell. */
function collectDetections(
  text: string,
  roster: PatientRosterEntry[],
): PatientDetection[] {
  if (!text || roster.length === 0) return [];

  // Index: első névtoken → betegek, hogy ne kelljen minden beteget végignézni.
  const byFirstToken = new Map<string, Array<{ entry: PatientRosterEntry; tokens: string[] }>>();
  for (const entry of roster) {
    if (!entry.nev || !entry.nev.trim()) continue;
    const tokens = nameTokens(entry.nev);
    if (tokens.length < 2) continue; // teljes név kell
    const list = byFirstToken.get(tokens[0]) ?? [];
    list.push({ entry, tokens });
    byFirstToken.set(tokens[0], list);
  }

  const tokens = tokenize(text);
  const detections: PatientDetection[] = [];

  // ── Név-találatok ───────────────────────────────────────────────────
  for (let i = 0; i < tokens.length; i++) {
    const candidatesHere = byFirstToken.get(tokens[i].norm);
    if (!candidatesHere) continue;

    // A leghosszabb teljes egyezést keressük ezen a pozíción.
    let bestLen = 0;
    let matched: PatientRosterEntry[] = [];
    for (const { entry, tokens: nameToks } of candidatesHere) {
      if (i + nameToks.length > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < nameToks.length; k++) {
        const msgTok = tokens[i + k].norm;
        const nameTok = nameToks[k];
        // Az utolsó token prefix-egyezést is enged (magyar toldalék).
        const isLast = k === nameToks.length - 1;
        if (isLast ? !msgTok.startsWith(nameTok) : msgTok !== nameTok) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (nameToks.length > bestLen) {
        bestLen = nameToks.length;
        matched = [entry];
      } else if (nameToks.length === bestLen) {
        matched.push(entry);
      }
    }

    if (bestLen > 0) {
      const start = tokens[i].start;
      const end = tokens[i + bestLen - 1].end;
      detections.push({
        matchedText: text.slice(start, end),
        start,
        end,
        kind: 'name',
        candidates: dedupeById(matched),
        ambiguous: dedupeById(matched).length > 1,
      });
      i += bestLen - 1; // ne ismerjük fel újra ugyanazokat a tokeneket
    }
  }

  // ── TAJ-találatok ───────────────────────────────────────────────────
  const tajByValue = new Map<string, PatientRosterEntry[]>();
  for (const entry of roster) {
    if (!entry.taj) continue;
    const norm = normalizeTaj(entry.taj);
    if (norm.length !== 9) continue;
    const list = tajByValue.get(norm) ?? [];
    list.push(entry);
    tajByValue.set(norm, list);
  }

  if (tajByValue.size > 0) {
    // 9 számjegy, opcionálisan szóköz/kötőjel csoportosítással.
    const tajRe = /(?<!\d)(\d[\s-]?){8}\d(?!\d)/g;
    let m: RegExpExecArray | null;
    while ((m = tajRe.exec(text)) !== null) {
      const raw = m[0];
      const digits = normalizeTaj(raw);
      const entries = tajByValue.get(digits);
      if (!entries) continue;
      detections.push({
        matchedText: raw,
        start: m.index,
        end: m.index + raw.length,
        kind: 'taj',
        candidates: dedupeById(entries),
        ambiguous: dedupeById(entries).length > 1,
      });
    }
  }

  return detections.sort((a, b) => a.start - b.start);
}

/** Egy küldéskor feloldatlanul maradó, kétértelmű említés nyers (DB) alakja. */
export interface UnresolvedMentionRaw {
  matchedText: string;
  candidateIds: string[];
}

/**
 * Küldéskori szétválasztás: a felismert találatokból eldönti, melyik beteg
 * kerüljön automatikusan az üzenethez (`autoMentioned`), és melyik kétértelmű
 * említés marad feloldatlan (`unresolved`).
 *
 *  - Egyértelmű (egy jelölt) → automatikusan hivatkozott.
 *  - Kétértelmű (több azonos nevű): ha a feladó a composerben már kiválasztott
 *    egy jelöltet (`confirmedIds`), az feloldottnak számít; különben feloldatlan
 *    marad (sosem tippelünk beteget a klinikai adat miatt).
 *
 * Tisztán (DB nélkül) tesztelhető.
 */
export function splitDetectionsForSend(
  detections: PatientDetection[],
  confirmedIds: Set<string>,
): { autoMentioned: string[]; unresolved: UnresolvedMentionRaw[] } {
  const autoMentioned: string[] = [];
  const unresolved: UnresolvedMentionRaw[] = [];
  for (const d of detections) {
    if (!d.ambiguous) {
      if (d.candidates[0]) autoMentioned.push(d.candidates[0].id);
      continue;
    }
    const picked = d.candidates.find((c) => confirmedIds.has(c.id));
    if (picked) {
      autoMentioned.push(picked.id);
    } else {
      unresolved.push({
        matchedText: d.matchedText,
        candidateIds: d.candidates.map((c) => c.id),
      });
    }
  }
  return { autoMentioned, unresolved };
}

function dedupeById(entries: PatientRosterEntry[]): PatientRosterEntry[] {
  const seen = new Set<string>();
  const out: PatientRosterEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * Egy beteg-halmaz csak egyszer jelenjen meg a megerősítő sávban: az azonos
 * jelölt-készletű (és típusú) találatokat összevonjuk, az első előfordulást
 * tartva meg.
 */
function dedupeDetections(detections: PatientDetection[]): PatientDetection[] {
  const seen = new Set<string>();
  const out: PatientDetection[] = [];
  for (const d of detections.sort((a, b) => a.start - b.start)) {
    const key = `${d.kind}:${d.candidates.map((c) => c.id).sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

// ── Renderelés ────────────────────────────────────────────────────────────

/** Egy renderelhető szakasz: sima szöveg vagy beteg-profilra mutató link. */
export interface MentionSegment {
  type: 'text' | 'link';
  content: string;
  patientId?: string;
}

interface Span {
  start: number;
  end: number;
  patientId: string;
}

/**
 * Az üzenet szövegét szakaszokra bontja, beteg-profilra mutató linkekkel. A
 * `roster` az adott üzenethez **már hozzárendelt** betegek (id + nev), így a
 * felismerés egyértelmű és nem kell futásidőben név→ID lekérés (szemben a
 * legacy `MentionLink` per-pill fetch-ével).
 *
 * Linkesít minden előfordulást: (1) a beteg teljes nevét a szabad szövegben,
 * (2) a TAJ-számát, és (3) a legacy `@vezeteknev+keresztnev` jelölést.
 */
export function buildMentionSegments(
  text: string,
  roster: PatientRosterEntry[],
): MentionSegment[] {
  if (!text) return [];

  const spans: Span[] = [];

  // Név + TAJ előfordulások (nyers, nem deduplikált).
  for (const d of collectDetections(text, roster)) {
    if (d.candidates.length > 0) {
      spans.push({ start: d.start, end: d.end, patientId: d.candidates[0].id });
    }
  }

  // Legacy `@vezeteknev+keresztnev` jelölések — a roster nevéből számolt
  // slug-gal párosítva (nincs hálózati hívás).
  const slugToId = new Map<string, string>();
  for (const entry of roster) {
    const slug = mentionSlug(entry.nev).toLowerCase();
    if (slug) slugToId.set(slug, entry.id);
  }
  if (slugToId.size > 0) {
    const slugRe = /@([a-z0-9+]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = slugRe.exec(text)) !== null) {
      const id = slugToId.get(m[0].toLowerCase());
      if (id) spans.push({ start: m.index, end: m.index + m[0].length, patientId: id });
    }
  }

  if (spans.length === 0) {
    return [{ type: 'text', content: text }];
  }

  // Átfedés-mentesítés: korábbi kezdet, majd hosszabb szakasz nyer.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // átfedő találat kihagyása
    if (span.start > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, span.start) });
    }
    segments.push({
      type: 'link',
      content: text.slice(span.start, span.end),
      patientId: span.patientId,
    });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) });
  }
  return segments;
}
