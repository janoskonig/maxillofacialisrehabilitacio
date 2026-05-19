import { describe, it, expect } from 'vitest';
import {
  DEPENDENCY_GRAPH_V1,
  assertAcyclic,
  transitiveInvalidationTargets,
  aggregateLocalTargets,
} from '@/lib/research-registry/dependency-graph';

describe('dependency-graph', () => {
  it('v1 graph is acyclic', () => {
    expect(() => assertAcyclic(DEPENDENCY_GRAPH_V1)).not.toThrow();
  });

  it('transitive invalidation from patient includes quality and export', () => {
    const targets = transitiveInvalidationTargets(DEPENDENCY_GRAPH_V1, 'patient');
    expect(targets).toContain('episode');
    expect(targets).toContain('entity_quality_state');
    expect(targets).toContain('analysis_export');
  });

  it('aggregate-local from episode only reaches appointment', () => {
    const targets = aggregateLocalTargets(DEPENDENCY_GRAPH_V1, 'episode');
    expect(targets).toEqual(['appointment']);
  });
});
