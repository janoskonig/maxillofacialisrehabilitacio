import { Patient } from './types';

// CSV fejléc mezők sorrendje (CSV export/import funkcióhoz)
const CSV_HEADERS = [
  'id',
  'nev',
  'taj',
  'telefonszam',
  'beutaloIntezmeny',
  'szuletesiDatum',
  'nem',
  'email',
  'cim',
  'varos',
  'iranyitoszam',
  'beutaloOrvos',
  'beutaloIndokolas',
  'mutetIdeje',
  'szovettaniDiagnozis',
  'nyakiBlokkdisszekcio',
  // Anamnézis és betegvizsgálat
  'alkoholfogyasztas',
  'dohanyzasSzam',
  'maxilladefektusVan',
  'brownFuggolegesOsztaly',
  'brownVizszintesKomponens',
  'mandibuladefektusVan',
  'kovacsDobakOsztaly',
  'nyelvmozgásokAkadályozottak',
  'gombocosBeszed',
  'nyalmirigyAllapot',
  'radioterapia',
  'radioterapiaDozis',
  'radioterapiaDatumIntervallum',
  'chemoterapia',
  'chemoterapiaLeiras',
  'fabianFejerdyProtetikaiOsztaly',
  'kezeleoorvos',
  'kezeleoorvosIntezete',
  'felvetelDatuma',
  'meglevoImplantatumok',
  'nemIsmertPoziciokbanImplantatum',
  'nemIsmertPoziciokbanImplantatumRészletek',
  'createdAt',
  'updatedAt'
];

const API_BASE_URL = '/api/patients';

// TimeoutError osztály - külön error típus timeout esetén
export class TimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * ApiError osztály - strukturált hiba kezeléshez
 * Constructor pattern: name mező ne legyen duplikálva (Error.name már létezik)
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  correlationId?: string;

  constructor(args: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
    correlationId?: string;
    name?: string;
  }) {
    super(args.message);
    this.name = args.name ?? 'ApiError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.correlationId = args.correlationId;
  }
}

// API hívás hibakezelő
// Strukturált ApiError-t dob, fallback text parsing-sel
async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // CorrelationId kinyerése header-ből
    const correlationId = response.headers.get('x-correlation-id') || undefined;
    
    let errorData: any;
    let errorMessage = `HTTP hiba: ${response.status} ${response.statusText}`;
    
    // Próbáljuk JSON parse-olni
    try {
      errorData = await response.json();
    } catch {
      // Fallback: próbáljuk text()-ként olvasni (max 200 chars)
      try {
        const text = await response.text();
        const snippet = text.length > 200 ? text.substring(0, 200) + '...' : text;
        errorData = { error: snippet || errorMessage };
      } catch {
        // Ha text() is fail, akkor csak a status alapú üzenet
        errorData = { error: errorMessage };
      }
    }
    
    // Strukturált error response ellenőrzése
    if (errorData?.error && typeof errorData.error === 'object') {
      const structuredError = errorData.error;
      // CorrelationId prioritás: header elsődleges, body fallback
      const finalCorrelationId = correlationId || structuredError.correlationId;
      throw new ApiError({
        message: structuredError.message || errorMessage,
        status: structuredError.status || response.status,
        code: structuredError.code,
        details: structuredError.details,
        correlationId: finalCorrelationId,
        name: structuredError.name || 'ApiError',
      });
    }
    
    // Fallback: régi formátum (backward compatibility)
    errorMessage = errorData.details
      ? `${errorData.error || errorMessage}\n${errorData.details}`
      : errorData.error || errorMessage;
    
    throw new ApiError({
      message: errorMessage,
      status: response.status,
      correlationId,
    });
  }
  
  try {
    return await response.json();
  } catch (error) {
    throw new ApiError({
      message: 'Érvénytelen válasz a szervertől',
      status: 500,
    });
  }
}

// Fetch wrapper timeout-tal - korrekt signal forwarding és timeout error jelölés
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = 30000,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;
  let didTimeout = false;

  // Cleanup helper - egy helyen
  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (abortListener && externalSignal) {
      externalSignal.removeEventListener("abort", abortListener);
      abortListener = null;
    }
  };

  // Timeout -> abort + didTimeout flag
  timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeout);

  // External abort forwarding
  if (externalSignal) {
    if (externalSignal.aborted) {
      cleanup();
      const e = new Error("Aborted");
      (e as any).name = "AbortError";
      throw e;
    }

    abortListener = () => {
      controller.abort();
    };
    externalSignal.addEventListener("abort", abortListener, { once: true });
  }

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    cleanup();
    return res;
  } catch (err: any) {
    cleanup();

    // Abort can be timeout OR user abort
    if (err?.name === "AbortError") {
      if (didTimeout) {
        throw new TimeoutError("A kérés időtúllépés miatt megszakadt.");
      }
      throw err; // user abort
    }

    // Network error normalization
    if (err instanceof TypeError) {
      throw new Error("Nem sikerült csatlakozni a szerverhez. Ellenőrizze az internetkapcsolatot.");
    }

    throw err;
  }
}

// Beteg mentése (új vagy frissítés) - támogatja a cancellation-t és konfliktuskezelést
export async function savePatient(
  patient: Patient,
  options?: { signal?: AbortSignal; source?: "auto" | "manual" }
): Promise<Patient> {
  const isUpdate = !!patient.id;
  const url = isUpdate ? `${API_BASE_URL}/${patient.id}` : API_BASE_URL;
  const method = isUpdate ? "PUT" : "POST";

  // Headers összeállítása
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // If-Match header: updatedAt értéke (konfliktuskezelés)
  // Normalizálás ISO stringgé (biztos, hogy nem Date objektum vagy más formátum)
  if (isUpdate && patient.updatedAt) {
    const updatedAtValue: unknown = patient.updatedAt;
    // Ha Date objektum, konvertáljuk ISO stringgé
    if (updatedAtValue instanceof Date) {
      headers["if-match"] = updatedAtValue.toISOString();
    } else if (typeof updatedAtValue === 'string') {
      // Ha string, ellenőrizzük, hogy érvényes ISO string-e
      const date = new Date(updatedAtValue);
      if (!isNaN(date.getTime())) {
        headers["if-match"] = date.toISOString();
      } else {
        // Invalid date string - skip if-match (backward compat)
        console.warn('Invalid updatedAt format, skipping if-match header:', updatedAtValue);
      }
    } else {
      // Egyéb típus - skip (nem várható)
      console.warn('Unexpected updatedAt type, skipping if-match header:', typeof updatedAtValue);
    }
  }

  // X-Save-Source header: auto|manual (jövőbeli snapshot használathoz)
  if (options?.source) {
    headers["x-save-source"] = options.source;
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method,
        headers,
        credentials: "include",
        body: JSON.stringify(patient),
      },
      60000,
      options?.signal
    );

    const data = await handleApiResponse<{ patient: Patient }>(response);

    if (!data?.patient) {
      throw new Error("Érvénytelen válasz a szervertől: hiányzó beteg adatok");
    }

    return data.patient;
  } catch (error: any) {
    // AbortError és TimeoutError: ne logoljunk, csak propagáljuk
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw error;
    }
    console.error("Hiba a beteg mentésekor:", error);
    throw error instanceof Error
      ? error
      : new Error("Hiba történt a beteg mentésekor. Kérjük, próbálja újra.");
  }
}

// Összes beteg lekérdezése (pagination nélkül)
export async function getAllPatients(): Promise<Patient[]> {
  try {
    const response = await fetchWithTimeout(
      API_BASE_URL,
      {
        credentials: 'include',
      },
      30000 // 30 másodperc timeout
    );
    const data = await handleApiResponse<{ patients: Patient[] }>(response);
    return data.patients;
  } catch (error) {
    console.error('Hiba a betegek lekérdezésekor:', error);
    return [];
  }
}

// Beteg keresése (pagination nélkül)
export async function searchPatients(query: string): Promise<Patient[]> {
  try {
    if (!query.trim()) {
      return getAllPatients();
    }
    
    const response = await fetchWithTimeout(
      `${API_BASE_URL}?q=${encodeURIComponent(query)}`,
      {
        credentials: 'include',
      },
      30000 // 30 másodperc timeout
    );
    const data = await handleApiResponse<{ patients: Patient[] }>(response);
    return data.patients;
  } catch (error) {
    console.error('Hiba a kereséskor:', error);
    return [];
  }
}

// Beteg lekérdezése ID alapján (friss adatok az adatbázisból)
export async function getPatientById(id: string): Promise<Patient> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/${id}`,
      {
        credentials: 'include',
      },
      30000 // 30 másodperc timeout
    );
    const data = await handleApiResponse<{ patient: Patient }>(response);
    return data.patient;
  } catch (error: any) {
    console.error('Hiba a beteg lekérdezésekor:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Hiba történt a beteg lekérdezésekor. Kérjük, próbálja újra.');
  }
}

// Beteg törlése
export async function deletePatient(id: string): Promise<void> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/${id}`,
      {
        method: 'DELETE',
        credentials: 'include',
      },
      30000 // 30 másodperc timeout
    );
    await handleApiResponse(response);
  } catch (error: any) {
    console.error('Hiba a beteg törlésekor:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Hiba történt a beteg törlésekor. Kérjük, próbálja újra.');
  }
}

// CSV export funkció - teljes adatbázis
export async function exportAllPatientsToCSV(): Promise<string> {
  // Fetch all patients without pagination for CSV export
  const allPatients = await getAllPatients();
  return convertPatientsToCSV(allPatients);
}

// CSV import funkció (batch mentés)
export async function importPatientsFromCSV(csvContent: string): Promise<boolean> {
  try {
    const patients = parseCSVToPatients(csvContent);
    
    // Mentjük az összes beteget az adatbázisba
    for (const patient of patients) {
      await savePatient(patient);
    }
    
    return true;
  } catch (error) {
    console.error('Hiba a CSV importálásakor:', error);
    return false;
  }
}

const downloadCSVFile = (patients: Patient[]): void => {
  const csvContent = convertPatientsToCSV(patients);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `maxillofacial_patients.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const convertPatientsToCSV = (patients: Patient[]): string => {
  const csvRows = [CSV_HEADERS.join(',')];
  
  patients.forEach(patient => {
    const row = CSV_HEADERS.map(header => {
      let value = patient[header as keyof Patient];
      
      // Handle object values (like meglevoImplantatumok)
      if (header === 'meglevoImplantatumok' && value && typeof value === 'object') {
        value = JSON.stringify(value);
      }
      
      // Handle boolean values
      if (typeof value === 'boolean') {
        value = value ? 'true' : 'false';
      }
      
      // Convert to string
      const stringValue = (value || '').toString();
      
      // Escape commas and quotes in CSV
      if (stringValue.includes(',') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    csvRows.push(row.join(','));
  });
  
  return csvRows.join('\n');
};

const parseCSVToPatients = (csvContent: string): Patient[] => {
  const lines = csvContent.split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',');
  const patients: Patient[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      const values = parseCSVLine(lines[i]);
      const patient: any = {};
      
      headers.forEach((header, index) => {
        let value: any = values[index] || '';
        
        // Parse JSON strings back to objects
        if (header === 'meglevoImplantatumok' && value) {
          try {
            value = JSON.parse(value);
          } catch (e) {
            value = {};
          }
        }
        
        // Parse boolean values
        const booleanFields = [
          'radioterapia', 
          'chemoterapia', 
          'nemIsmertPoziciokbanImplantatum',
          'maxilladefektusVan',
          'mandibuladefektusVan',
          'nyelvmozgásokAkadályozottak',
          'gombocosBeszed'
        ];
        if (booleanFields.includes(header) && value === 'true') {
          value = true;
        } else if (booleanFields.includes(header) && value === 'false') {
          value = false;
        }
        
        patient[header] = value;
      });
      
      patients.push(patient as Patient);
    }
  }
  
  return patients;
};

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
};

const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};