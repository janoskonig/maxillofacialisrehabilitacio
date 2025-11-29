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

// API hívás hibakezelő
async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: `HTTP hiba: ${response.status} ${response.statusText}` };
    }
    // Ha van details mező, azt is hozzáadjuk a hibaüzenethez
    const errorMessage = errorData.details 
      ? `${errorData.error || `HTTP hiba: ${response.status}`}\n${errorData.details}`
      : errorData.error || `HTTP hiba: ${response.status}`;
    throw new Error(errorMessage);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error('Érvénytelen válasz a szervertől');
  }
}

// Fetch wrapper timeout-tal
async function fetchWithTimeout(url: string, options: RequestInit, timeout: number = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('A kérés túl hosszú ideig tartott. Kérjük, próbálja újra.');
    }
    if (error.message && error.message.includes('Failed to fetch')) {
      throw new Error('Nem sikerült csatlakozni a szerverhez. Ellenőrizze az internetkapcsolatot.');
    }
    throw error;
  }
}

// Beteg mentése (új vagy frissítés)
export async function savePatient(patient: Patient): Promise<Patient> {
  try {
    const isUpdate = patient.id;
    const url = isUpdate 
      ? `${API_BASE_URL}/${patient.id}`
      : API_BASE_URL;
    
    const method = isUpdate ? 'PUT' : 'POST';
    
    const response = await fetchWithTimeout(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(patient),
      },
      60000 // 60 másodperc timeout nagy adatokhoz
    );

    const data = await handleApiResponse<{ patient: Patient }>(response);
    return data.patient;
  } catch (error: any) {
    console.error('Hiba a beteg mentésekor:', error);
    // Jobb hibaüzenet a felhasználónak
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Hiba történt a beteg mentésekor. Kérjük, próbálja újra.');
  }
}

// Pagination interface
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PatientsResponse {
  patients: Patient[];
  pagination: PaginationInfo;
}

// Összes beteg lekérdezése (pagination támogatással)
export async function getAllPatients(page: number = 1, limit: number = 50): Promise<PatientsResponse> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}?page=${page}&limit=${limit}`,
      {
        credentials: 'include',
      },
      30000 // 30 másodperc timeout
    );
    const data = await handleApiResponse<PatientsResponse>(response);
    return data;
  } catch (error) {
    console.error('Hiba a betegek lekérdezésekor:', error);
    return {
      patients: [],
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
      },
    };
  }
}

// Beteg keresése (pagination támogatással)
export async function searchPatients(query: string, page: number = 1, limit: number = 50): Promise<PatientsResponse> {
  try {
    if (!query.trim()) {
      return getAllPatients(page, limit);
    }
    
    const response = await fetchWithTimeout(
      `${API_BASE_URL}?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
      {
        credentials: 'include',
      },
      30000 // 30 másodperc timeout
    );
    const data = await handleApiResponse<PatientsResponse>(response);
    return data;
  } catch (error) {
    console.error('Hiba a kereséskor:', error);
    return {
      patients: [],
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
      },
    };
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
  let allPatients: Patient[] = [];
  let currentPage = 1;
  let hasMore = true;
  
  while (hasMore) {
    const response = await getAllPatients(currentPage, 1000); // Use large limit
    allPatients = [...allPatients, ...response.patients];
    hasMore = currentPage < response.pagination.totalPages;
    currentPage++;
  }
  
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