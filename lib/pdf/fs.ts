import fs from 'node:fs';
import path from 'node:path';

export function resolveExistingPath(candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function readFileFromCandidates(candidates: string[]): Buffer {
  const hit = resolveExistingPath(candidates);
  if (!hit) {
    const cwd = process.cwd();
    const details = candidates.map((c) => `- ${c}`).join('\n');
    throw new Error(`PDF template not found. process.cwd() = ${cwd}\nTried:\n${details}`);
  }
  return fs.readFileSync(hit);
}

export function projectRootCandidates(...parts: string[]): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, ...parts),
    path.join(cwd, 'src', ...parts),
    path.join(cwd, '..', ...parts),
  ];
}
