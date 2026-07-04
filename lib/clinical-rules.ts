/**
 * Clinical rules and protocol definitions
 * Centralized location for required fields, document tags, and checklist logic
 * 
 * This is the single source of truth for NEAK/klinikai minimum protocol.
 * All components (PatientForm, ClinicalChecklist, W2 saved views, W1 export) use this.
 */

import { Patient } from './types';
import { PatientDocument } from './types';

// Protocol version (for tracking changes)
// 2026-07-03: tétel-súlyok bevezetése (a completeness score súlyozott).
export const PROTOCOL_VERSION = '2026-07-03';

/**
 * Tétel-súlyok a completeness score-hoz. Nem minden hiány egyenértékű:
 * az identitás/diagnózis (3×) nélkül a rekord kutatásra alkalmatlan; a
 * klinikai osztályozás/dokumentum (2×) az elemzés gerince; a kontakt és a
 * kutatási kiegészítők (1×) pótolhatók.
 */
export const WEIGHT_IDENTITY = 3;
export const WEIGHT_CLINICAL = 2;
export const WEIGHT_SUPPLEMENTARY = 1;

/** A feltételes kutatási mezők egységes súlya a score-ban. */
export const RESEARCH_FIELD_WEIGHT = WEIGHT_SUPPLEMENTARY;

// Required field definitions for clinical protocol
// Each field has: key (Patient object key), label (display name), severity (error/warning)
export interface RequiredField {
  key: keyof Patient;
  label: string;
  severity?: 'error' | 'warning';
  /** Súly a completeness score-ban (WEIGHT_* konstansok). */
  weight: number;
}

// NEAK/Klinikai minimum protokoll - kötelező mezők
// These are hard-required (severity: "error") - everything else is optional
export const REQUIRED_FIELDS: RequiredField[] = [
  { key: 'nev', label: 'Név', severity: 'error', weight: WEIGHT_IDENTITY },
  { key: 'nem', label: 'Nem', severity: 'error', weight: WEIGHT_CLINICAL },
  { key: 'szuletesiDatum', label: 'Születési idő', severity: 'error', weight: WEIGHT_IDENTITY },
  { key: 'taj', label: 'TAJ', severity: 'error', weight: WEIGHT_IDENTITY },
  { key: 'email', label: 'Email', severity: 'error', weight: WEIGHT_SUPPLEMENTARY },
  { key: 'kezelesreErkezesIndoka', label: 'Kezelésre érkezés indoka', severity: 'error', weight: WEIGHT_IDENTITY },
  { key: 'diagnozis', label: 'Diagnózis', severity: 'error', weight: WEIGHT_IDENTITY },
  { key: 'meglevoFogak', label: 'Fogazati státusz', severity: 'error', weight: WEIGHT_CLINICAL },
] as const;

// Required document rules (tag-based with minimum count)
export interface RequiredDocRule {
  tag: string;
  label: string;
  minCount: number;
  /** Súly a completeness score-ban. */
  weight: number;
}

// NEAK/Klinikai minimum protokoll - kötelező dokumentumok
// Only OP röntgenfelvétel is required (1 db minimum)
// Note: If your OP tag is different (e.g., "rtg_op" or "panorama"), update this
export const REQUIRED_DOC_RULES: RequiredDocRule[] = [
  { tag: 'op', label: 'OP röntgenfelvétel', minCount: 1, weight: WEIGHT_CLINICAL },
] as const;

// Backward compatibility: Extract tag list from REQUIRED_DOC_RULES
// This is used by W2 saved views and W1 export
export const REQUIRED_DOC_TAGS = REQUIRED_DOC_RULES.map((rule) => rule.tag) as readonly string[];

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
 * Get missing required document rules for a patient
 * Checks both tag presence and minimum count requirements
 * @param documents - Array of patient documents
 * @returns Array of missing required document rules (with label for display)
 */
export interface MissingDocRule {
  tag: string;
  label: string;
  minCount: number;
  actualCount: number;
}

export function getMissingRequiredDocRules(documents: PatientDocument[]): MissingDocRule[] {
  if (!documents || documents.length === 0) {
    // All rules are missing if no documents
    return REQUIRED_DOC_RULES.map((rule) => ({
      tag: rule.tag,
      label: rule.label,
      minCount: rule.minCount,
      actualCount: 0,
    }));
  }

  // Count documents per tag (case-insensitive)
  const tagCounts = new Map<string, number>();
  documents.forEach((doc) => {
    if (doc.tags && Array.isArray(doc.tags)) {
      doc.tags.forEach((tag) => {
        if (typeof tag === 'string') {
          const lowerTag = tag.toLowerCase();
          tagCounts.set(lowerTag, (tagCounts.get(lowerTag) || 0) + 1);
        }
      });
    }
  });

  // Check each required rule
  const missingRules: MissingDocRule[] = [];
  REQUIRED_DOC_RULES.forEach((rule) => {
    const lowerTag = rule.tag.toLowerCase();
    const actualCount = tagCounts.get(lowerTag) || 0;
    
    if (actualCount < rule.minCount) {
      missingRules.push({
        tag: rule.tag,
        label: rule.label,
        minCount: rule.minCount,
        actualCount,
      });
    }
  });

  return missingRules;
}

/**
 * Get missing required document tags (backward compatibility)
 * @param documents - Array of patient documents
 * @returns Array of missing required tag names
 * @deprecated Use getMissingRequiredDocRules() for more detailed information
 */
export function getMissingRequiredDocTags(documents: PatientDocument[]): string[] {
  const missingRules = getMissingRequiredDocRules(documents);
  return missingRules.map((rule) => rule.tag);
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
  missingDocs: MissingDocRule[]; // Changed to include count details
  hasErrors: boolean; // true if any missing field has severity 'error'
  hasWarnings: boolean; // true if any missing field has severity 'warning'
  /** Protocol version this result was evaluated against — for traceability when rules change. */
  protocolVersion: string;
}

export function getChecklistStatus(
  patient: Patient | null | undefined,
  documents: PatientDocument[] = []
): ChecklistStatus {
  const missingFields = getMissingRequiredFields(patient);
  const missingDocs = getMissingRequiredDocRules(documents);
  
  const hasErrors = missingFields.some((field) => field.severity === 'error');
  const hasWarnings = missingFields.some((field) => field.severity === 'warning');
  
  const isComplete = missingFields.length === 0 && missingDocs.length === 0;

  return {
    isComplete,
    missingFields,
    missingDocs,
    hasErrors,
    hasWarnings,
    protocolVersion: PROTOCOL_VERSION,
  };
}
