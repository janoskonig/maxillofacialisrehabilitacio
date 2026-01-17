/**
 * Clinical rules and protocol definitions
 * Centralized location for required fields, document tags, and checklist logic
 */

import { Patient } from './types';
import { PatientDocument } from './types';

// Required document tags for clinical workflow
export const REQUIRED_DOC_TAGS = ['neak', 'op', 'foto'] as const;

// Required field definitions for clinical protocol
// Each field has: key (Patient object key), label (display name), severity (error/warning)
export interface RequiredField {
  key: keyof Patient;
  label: string;
  severity?: 'error' | 'warning';
}

// MVP: 5-10 kötelező mező (amit tényleg használtok)
const REQUIRED_FIELDS: RequiredField[] = [
  { key: 'nev', label: 'Név', severity: 'error' },
  { key: 'taj', label: 'TAJ szám', severity: 'error' },
  { key: 'diagnozis', label: 'Diagnózis', severity: 'error' },
  { key: 'szuletesiDatum', label: 'Születési dátum', severity: 'warning' },
  { key: 'nem', label: 'Nem', severity: 'warning' },
  { key: 'kezelesreErkezesIndoka', label: 'Kezelésre érkezés indoka', severity: 'warning' },
  { key: 'kezeleoorvos', label: 'Kezelőorvos', severity: 'warning' },
];

/**
 * Get missing required fields for a patient
 * @param patient - Patient object to check
 * @returns Array of missing required fields
 */
export function getMissingRequiredFields(patient: Patient | null | undefined): RequiredField[] {
  if (!patient) {
    return REQUIRED_FIELDS;
  }

  return REQUIRED_FIELDS.filter((field) => {
    const value = patient[field.key];
    
    // Check if value is missing (null, undefined, empty string, or empty array)
    if (value === null || value === undefined) {
      return true;
    }
    
    if (typeof value === 'string') {
      return value.trim() === '';
    }
    
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    
    if (typeof value === 'boolean') {
      // Boolean fields are considered present if they have a value (true or false)
      return false;
    }
    
    return false;
  });
}

/**
 * Get missing required document tags for a patient
 * @param documents - Array of patient documents
 * @returns Array of missing required tag names
 */
export function getMissingRequiredDocTags(documents: PatientDocument[]): string[] {
  if (!documents || documents.length === 0) {
    return [...REQUIRED_DOC_TAGS];
  }

  // Extract all tags from documents (case-insensitive)
  const existingTags = new Set<string>();
  documents.forEach((doc) => {
    if (doc.tags && Array.isArray(doc.tags)) {
      doc.tags.forEach((tag) => {
        if (typeof tag === 'string') {
          existingTags.add(tag.toLowerCase());
        }
      });
    }
  });

  // Find missing tags (case-insensitive comparison)
  const missingTags: string[] = [];
  REQUIRED_DOC_TAGS.forEach((requiredTag) => {
    const lowerRequired = requiredTag.toLowerCase();
    if (!existingTags.has(lowerRequired)) {
      missingTags.push(requiredTag);
    }
  });

  return missingTags;
}

/**
 * Checklist status for a patient
 * @param patient - Patient object
 * @param documents - Array of patient documents
 * @returns Checklist status with missing fields and documents
 */
export interface ChecklistStatus {
  isComplete: boolean;
  missingFields: RequiredField[];
  missingDocs: string[];
  hasErrors: boolean; // true if any missing field has severity 'error'
  hasWarnings: boolean; // true if any missing field has severity 'warning'
}

export function getChecklistStatus(
  patient: Patient | null | undefined,
  documents: PatientDocument[] = []
): ChecklistStatus {
  const missingFields = getMissingRequiredFields(patient);
  const missingDocs = getMissingRequiredDocTags(documents);
  
  const hasErrors = missingFields.some((field) => field.severity === 'error');
  const hasWarnings = missingFields.some((field) => field.severity === 'warning');
  
  const isComplete = missingFields.length === 0 && missingDocs.length === 0;

  return {
    isComplete,
    missingFields,
    missingDocs,
    hasErrors,
    hasWarnings,
  };
}
