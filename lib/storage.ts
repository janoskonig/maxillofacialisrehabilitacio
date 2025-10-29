import { Patient } from './types';

// CSV fejléc mezők sorrendje
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

const STORAGE_KEY = 'maxillofacial_patients_csv';

export const savePatient = (patient: Patient): Patient => {
  const now = new Date().toISOString();
  
  const patientToSave = {
    ...patient,
    id: patient.id || generateId(),
    createdAt: patient.createdAt || now,
    updatedAt: now,
  };
  
  // Automatikusan menti CSV fájlba és letölti
  saveAndDownloadCSV(patientToSave);
  
  return patientToSave;
};

export const getAllPatients = (): Patient[] => {
  if (typeof window === 'undefined') return [];
  
  try {
    const csvData = localStorage.getItem(STORAGE_KEY);
    if (!csvData) return [];
    
    return parseCSVToPatients(csvData);
  } catch (error) {
    console.error('Error loading patients:', error);
    return [];
  }
};

export const searchPatients = (query: string): Patient[] => {
  const patients = getAllPatients();
  const lowercaseQuery = query.toLowerCase();
  
  return patients.filter(patient => 
    patient.nev?.toLowerCase().includes(lowercaseQuery) ||
    patient.taj?.toLowerCase().includes(lowercaseQuery) ||
    patient.telefonszam?.includes(query) ||
    patient.email?.toLowerCase().includes(lowercaseQuery) ||
    patient.beutaloIntezmeny?.toLowerCase().includes(lowercaseQuery) ||
    patient.beutaloOrvos?.toLowerCase().includes(lowercaseQuery) ||
    patient.kezeleoorvos?.toLowerCase().includes(lowercaseQuery)
  );
};

// CSV export funkció - teljes adatbázis
export const exportAllPatientsToCSV = (): string => {
  const patients = getAllPatients();
  return convertPatientsToCSV(patients);
};

// CSV import funkció
export const importPatientsFromCSV = (csvContent: string): boolean => {
  try {
    const patients = parseCSVToPatients(csvContent);
    savePatientsToCSV(patients);
    return true;
  } catch (error) {
    console.error('Error importing CSV:', error);
    return false;
  }
};

// Segédfüggvények
const saveAndDownloadCSV = (newPatient: Patient): void => {
  // Betölti a meglévő adatokat
  const existingPatients = getAllPatients();
  
  // Ellenőrzi, hogy ez egy új beteg-e vagy frissítés
  const existingIndex = existingPatients.findIndex(p => p.id === newPatient.id);
  
  let updatedPatients: Patient[];
  if (existingIndex >= 0) {
    // Frissítés
    updatedPatients = [...existingPatients];
    updatedPatients[existingIndex] = newPatient;
  } else {
    // Új beteg hozzáadása
    updatedPatients = [...existingPatients, newPatient];
  }
  
  // Mentés localStorage-ba
  savePatientsToCSV(updatedPatients);
  
  // Automatikus CSV letöltés
  downloadCSVFile(updatedPatients);
};

const savePatientsToCSV = (patients: Patient[]): void => {
  const csvContent = convertPatientsToCSV(patients);
  localStorage.setItem(STORAGE_KEY, csvContent);
};

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