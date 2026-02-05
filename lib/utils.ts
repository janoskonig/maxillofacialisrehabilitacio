/**
 * Monogram generálása névből
 * Visszaadja a vezetéknév első betűjét és a keresztnév első betűjét
 */
export function getMonogram(name: string | null | undefined): string {
  if (!name) return '?';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  
  const firstInitial = parts[0][0]?.toUpperCase() || '';
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : '';
  
  return (firstInitial + lastInitial) || '?';
}

/**
 * Vezetéknév kinyerése teljes névből
 */
export function getLastName(name: string | null | undefined): string {
  if (!name) return '';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  
  return parts[parts.length - 1] || '';
}

/**
 * Tag normalizálás - ékezet + kötőjel + whitespace kezelés
 * Több tag kezelése (tömb vagy vesszővel elválasztott string)
 */
export function normalizeTags(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === "string")
    : typeof input === "string"
      ? [input]
      : [];

  return raw
    .flatMap(s => s.split(","))
    .map(s => s.trim())
    .filter(Boolean)
    .map(s =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\s_-]+/g, "")
        .trim()
    )
    .filter(Boolean);
}

/**
 * Biztonságos fájlnév generálás (determinisztikus, OS-független)
 */
export function safeFilename(name: string): string {
  return (name || "file")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

/**
 * AI-generált anamnézis összefoglaló validálása
 * Ellenőrzi, hogy megfelel-e a séma-kényszernek (8-12 bullet, disclaimer)
 */
export function isValidAnamnesisSummary(text: string): boolean {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => l.startsWith("•"));
  const hasDisclaimer = text.includes("AI-generált összefoglaló — ellenőrzendő");
  return bullets.length >= 8 && bullets.length <= 12 && hasDisclaimer;
}

/**
 * Segédfüggvény: számolja a truthy értékeket
 */
function countTruthy(...vals: Array<unknown>): number {
  return vals.filter(v => typeof v === "string" ? v.trim().length > 0 : Boolean(v)).length;
}

/**
 * Döntés: hívjuk-e az AI-t az anamnézis összefoglalóhoz
 * Csak akkor, ha van elég releváns adat vagy van kézi összefoglaló
 */
export function shouldCallAI(patient: {
  kezelesreErkezesIndoka?: string | null;
  balesetIdopont?: string | null;
  balesetEtiologiaja?: string | null;
  primerMutetLeirasa?: string | null;
  bno?: string | null;
  szovettaniDiagnozis?: string | null;
  tnmStaging?: string | null;
  radioterapia?: boolean | string | null;
  chemoterapia?: boolean | string | null;
  dohanyzasSzam?: string | null;
  alkoholfogyasztas?: string | null;
  kortortenetiOsszefoglalo?: string | null;
}): boolean {
  // Ha van kézi összefoglaló, mindig hívjuk az AI-t (javíthatja/kiegészítheti)
  if (patient.kortortenetiOsszefoglalo?.trim()) return true;

  // Számoljuk a releváns mezőket
  const score = countTruthy(
    patient.kezelesreErkezesIndoka,
    patient.balesetIdopont,
    patient.balesetEtiologiaja,
    patient.primerMutetLeirasa,
    patient.bno,
    patient.szovettaniDiagnozis,
    patient.tnmStaging,
    patient.radioterapia, // boolean vagy string
    patient.chemoterapia, // boolean vagy string
    patient.dohanyzasSzam,
    patient.alkoholfogyasztas
  );

  // Minimum 3 releváns mező kell
  return score >= 3;
}

/**
 * Export limit kezelő osztály
 * Determinista limit enforcement ZIP generálásnál
 */
export type ExportLimits = {
  maxDocs: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export class ExportLimiter {
  totalBytes = 0;
  docCount = 0;

  constructor(private limits: ExportLimits) {}

  addFile(bytes: number): void {
    // Validate input
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new Error(`Invalid file size: ${bytes}`);
    }
    
    if (bytes > this.limits.maxFileBytes) {
      throw new Error(`FILE_TOO_LARGE:${bytes}`);
    }
    
    const newTotal = this.totalBytes + bytes;
    if (newTotal > this.limits.maxTotalBytes) {
      // Debug: log the values before throwing
      if (process.env.NODE_ENV === 'development') {
        console.error(`[ExportLimiter] ZIP_TOO_LARGE: current=${this.totalBytes}, adding=${bytes}, newTotal=${newTotal}, limit=${this.limits.maxTotalBytes}`);
      }
      throw new Error(`ZIP_TOO_LARGE:${newTotal}`);
    }
    this.totalBytes = newTotal;
  }

  addDoc(): void {
    this.docCount += 1;
    if (this.docCount > this.limits.maxDocs) {
      throw new Error(`TOO_MANY_DOCS:${this.docCount}`);
    }
  }

  /**
   * User-friendly hibaüzenet generálása
   */
  static formatError(error: Error): string {
    const message = error.message;
    if (message.startsWith("FILE_TOO_LARGE:")) {
      const bytesStr = message.split(":")[1];
      const bytes = Number(bytesStr);
      if (isNaN(bytes)) {
        return `A fájl mérete meghaladja a maximumot (50 MB).`;
      }
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      return `A fájl mérete (${mb} MB) meghaladja a maximumot (50 MB).`;
    }
    if (message.startsWith("ZIP_TOO_LARGE:")) {
      const bytesStr = message.split(":")[1];
      const bytes = Number(bytesStr);
      if (isNaN(bytes)) {
        return `Az export csomag mérete meghaladja a maximumot (200 MB).`;
      }
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      return `Az export csomag mérete (${mb} MB) meghaladja a maximumot (200 MB).`;
    }
    if (message.startsWith("TOO_MANY_DOCS:")) {
      const countStr = message.split(":")[1];
      const count = Number(countStr);
      if (isNaN(count)) {
        return `A dokumentumok száma meghaladja a maximumot (200 db).`;
      }
      return `A dokumentumok száma (${count}) meghaladja a maximumot (200 db).`;
    }
    return error.message;
  }
}

