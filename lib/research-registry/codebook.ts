/**
 * Codebook generator MVP from static YAML/JSON registry.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { SOURCE_OF_TRUTH_REGISTRY } from './source-of-truth-registry';
import { QUALITY_STATES } from './quality-state';
import { EXPORT_HASH_SPEC_VERSION } from './export-determinism';
import { ANALYSIS_CODEBOOK_ENTRIES } from './analysis-projection';

export interface CodebookEntry {
  variable: string;
  label: string;
  type: string;
  allowedValues?: string[];
  source: string;
  notes?: string;
}

export interface CodebookDocument {
  version: string;
  generatedAt: string;
  variables: CodebookEntry[];
}

const REGISTRY_PATH = join(process.cwd(), 'data/research-registry/codebook-registry.json');

function loadStaticRegistry(): CodebookEntry[] {
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { variables?: CodebookEntry[] };
    return parsed.variables ?? [];
  } catch {
    return [];
  }
}

export function generateCodebook(version = '1.0.0'): CodebookDocument {
  const staticVars = loadStaticRegistry();
  const derived: CodebookEntry[] = [
    // Az elemzésre kész adatkészlet változói (egy forrásból, lásd analysis-projection).
    ...ANALYSIS_CODEBOOK_ENTRIES,
    {
      variable: 'quality_state',
      label: 'Entity quality state',
      type: 'enum',
      allowedValues: [...QUALITY_STATES],
      source: 'entity_quality_state',
    },
    {
      variable: 'domain_revision',
      label: 'Optimistic locking revision',
      type: 'integer',
      source: 'patients|patient_episodes|appointments',
    },
    {
      variable: 'export_content_hash',
      label: 'Deterministic export hash',
      type: 'string',
      source: `analysis_exports (${EXPORT_HASH_SPEC_VERSION})`,
    },
    ...SOURCE_OF_TRUTH_REGISTRY.map((e) => ({
      variable: `${e.entityName}.${e.fieldPath}`,
      label: e.notes ?? e.entityName,
      type: 'metadata',
      source: e.authoritativeSource,
      notes: `recomputable=${e.recomputable}, cache=${e.isCache}, immutable=${e.immutable}`,
    })),
  ];

  return {
    version,
    generatedAt: new Date().toISOString(),
    variables: [...staticVars, ...derived],
  };
}
