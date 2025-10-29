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
  'mutetRovidLeirasa',
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
    const errorData = await response.json().catch(() => ({ error: 'Ismeretlen hiba' }));
    throw new Error(errorData.error || `HTTP hiba: ${response.status}`);
  }
  return response.json();
}

// Beteg mentése (új vagy frissítés)
export async function savePatient(patient: Patient): Promise<Patient> {
  try {
    const isUpdate = patient.id;
    const url = isUpdate 
      ? `${API_BASE_URL}/${patient.id}`
      : API_BASE_URL;
    
    const method = isUpdate ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patient),
    });

    const data = await handleApiResponse<{ patient: Patient }>(response);
    return data.patient;
  } catch (error) {
    console.error('Hiba a beteg mentésekor:', error);
    throw error;
  }
}

// Összes beteg lekérdezése
export async function getAllPatients(): Promise<Patient[]> {
  try {
    const response = await fetch(API_BASE_URL);
    const data = await handleApiResponse<{ patients: Patient[] }>(response);
    return data.patients;
  } catch (error) {
    console.error('Hiba a betegek lekérdezésekor:', error);
    return [];
  }
}

// Beteg keresése
export async function searchPatients(query: string): Promise<Patient[]> {
  try {
    if (!query.trim()) {
      return getAllPatients();
    }
    
    const response = await fetch(`${API_BASE_URL}?q=${encodeURIComponent(query)}`);
    const data = await handleApiResponse<{ patients: Patient[] }>(response);
    return data.patients;
  } catch (error) {
    console.error('Hiba a kereséskor:', error);
    return [];
  }
}

// Beteg törlése
export async function deletePatient(id: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/${id}`, {
      method: 'DELETE',
    });
    await handleApiResponse(response);
  } catch (error) {
    console.error('Hiba a beteg törlésekor:', error);
    throw error;
  }
}

// CSV export funkció - teljes adatbázis
export async function exportAllPatientsToCSV(): Promise<string> {
  const patients = await getAllPatients();
  return convertPatientsToCSV(patients);
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
        let value = values[index] || '';
        
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