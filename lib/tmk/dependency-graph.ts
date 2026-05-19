/**
 * Versioned dependency graph (DAG) for bounded invalidation.
 * Cycle detection enforced in application layer.
 */

export type DependencyScope = 'aggregate_local' | 'materialized';

export interface DependencyEdge {
  from: string;
  to: string;
  scope: DependencyScope;
}

export interface DependencyGraph {
  nodes: string[];
  edges: DependencyEdge[];
}

/** v1 seed graph — must remain acyclic. */
export const DEPENDENCY_GRAPH_V1: DependencyGraph = {
  nodes: [
    'patient',
    'episode',
    'appointment',
    'ohip14_response',
    'entity_quality_state',
    'analysis_export',
  ],
  edges: [
    { from: 'patient', to: 'episode', scope: 'aggregate_local' },
    { from: 'episode', to: 'appointment', scope: 'aggregate_local' },
    { from: 'patient', to: 'entity_quality_state', scope: 'materialized' },
    { from: 'entity_quality_state', to: 'analysis_export', scope: 'materialized' },
  ],
};

/** Returns nodes transitively invalidated when `source` changes. */
export function transitiveInvalidationTargets(
  graph: DependencyGraph,
  source: string
): string[] {
  assertAcyclic(graph);
  const visited = new Set<string>();
  const queue = [source];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.from === node && !visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  visited.delete(source);
  return [...visited];
}

export function assertAcyclic(graph: DependencyGraph): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string): void {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      throw new Error(`Dependency cycle detected at node: ${node}`);
    }
    visiting.add(node);
    for (const edge of graph.edges) {
      if (edge.from === node) dfs(edge.to);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.nodes) {
    dfs(node);
  }
}

/** Aggregate-local invalidation only (bounded write amplification). */
export function aggregateLocalTargets(
  graph: DependencyGraph,
  source: string
): string[] {
  return graph.edges
    .filter((e) => e.from === source && e.scope === 'aggregate_local')
    .map((e) => e.to);
}
