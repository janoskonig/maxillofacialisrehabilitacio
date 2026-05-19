/**
 * De-identification layer for research exports.
 */

import { createHash } from 'crypto';

export interface DeidentifiedPatientRow {
  patientId: string;
  anonymizedSubjectKey: string;
  ageBandStart: number | null;
  regionPrefix: string | null;
  nem: string | null;
  kezelesreErkezesIndoka: string | null;
  domainRevision: number;
  legacyComplianceStatus: string | null;
}

export function computeAgeBand(birthDate: Date | string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const age = Math.floor(
    (Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
  return Math.floor(age / 5) * 5;
}

export function regionPrefixFromPostal(postal: string | null | undefined): string | null {
  if (!postal?.trim()) return null;
  return postal.trim().slice(0, 2) || null;
}

export function anonymizedSubjectKey(patientId: string, salt = ''): string {
  return createHash('sha256')
    .update(`${patientId}:${salt}:tmk_research`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/** Strip PHI fields from a patient record for research projection. */
export function deidentifyPatientRow(
  row: Record<string, unknown>,
  salt = ''
): DeidentifiedPatientRow {
  const patientId = String(row.id ?? row.patient_id ?? '');
  return {
    patientId,
    anonymizedSubjectKey: anonymizedSubjectKey(patientId, salt),
    ageBandStart: computeAgeBand(row.szuletesi_datum as string | null),
    regionPrefix: regionPrefixFromPostal(row.iranyitoszam as string | null),
    nem: (row.nem as string) ?? null,
    kezelesreErkezesIndoka: (row.kezelesre_erkezes_indoka as string) ?? null,
    domainRevision: Number(row.domain_revision ?? 1),
    legacyComplianceStatus: (row.legacy_compliance_status as string) ?? null,
  };
}
