/**
 * Quality metrics computed from clinical-rules + CRF required_for_quality fields.
 */

import {
  getMissingRequiredFields,
  getMissingRequiredDocRules,
  PROTOCOL_VERSION,
} from '@/lib/clinical-rules';
import type { Patient } from '@/lib/types';
import type { PatientDocument } from '@/lib/types';

export interface QualityMetrics {
  completenessScore: number;
  missingCriticalFields: string[];
  contradictionFlags: string[];
  staleDays: number | null;
  protocolVersion: string;
}

export function computeQualityMetrics(
  patient: Patient | null | undefined,
  documents: PatientDocument[] = [],
  lastUpdatedAt?: Date | string | null
): QualityMetrics {
  const missingFields = getMissingRequiredFields(patient);
  const missingDocs = getMissingRequiredDocRules(documents);
  const missingCriticalFields = [
    ...missingFields.map((f) => f.key as string),
    ...missingDocs.map((d) => `doc:${d.tag}`),
  ];

  const totalRequired =
    missingFields.length +
    missingDocs.reduce((sum, d) => sum + d.minCount, 0) +
    (patient ? 8 : 0);
  const missingCount = missingCriticalFields.length;
  const completenessScore =
    totalRequired > 0
      ? Math.round(Math.max(0, 100 - (missingCount / totalRequired) * 100) * 100) / 100
      : 0;

  const contradictionFlags: string[] = [];
  if (patient?.taj && patient.taj.length > 0 && !/^\d{9}$/.test(patient.taj.replace(/\s/g, ''))) {
    contradictionFlags.push('taj_format_invalid');
  }

  let staleDays: number | null = null;
  if (lastUpdatedAt) {
    const updated = new Date(lastUpdatedAt);
    staleDays = Math.floor((Date.now() - updated.getTime()) / (24 * 60 * 60 * 1000));
  }

  return {
    completenessScore,
    missingCriticalFields,
    contradictionFlags,
    staleDays,
    protocolVersion: PROTOCOL_VERSION,
  };
}
