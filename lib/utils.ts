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

