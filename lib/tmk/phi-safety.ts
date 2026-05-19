/**
 * PHI leakage detection stubs for export scanning.
 */

const PHI_PATTERNS = [
  { name: 'taj', regex: /\b\d{3}\s?\d{3}\s?\d{3}\b/g },
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'phone_hu', regex: /(\+36|06)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}/g },
];

export interface PhiScanResult {
  clean: boolean;
  findings: Array<{ pattern: string; sample: string }>;
}

export function scanForPhiLeaks(text: string): PhiScanResult {
  const findings: PhiScanResult['findings'] = [];
  for (const { name, regex } of PHI_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    const match = re.exec(text);
    if (match) {
      findings.push({ pattern: name, sample: match[0].slice(0, 8) + '…' });
    }
  }
  return { clean: findings.length === 0, findings };
}

export function assertExportPhiSafe(rows: Record<string, unknown>[]): void {
  const forbiddenKeys = ['nev', 'taj', 'email', 'telefonszam', 'cim', 'name', 'patient_name'];
  for (const row of rows) {
    for (const key of forbiddenKeys) {
      if (key in row && row[key] != null && String(row[key]).trim() !== '') {
        throw new Error(`PHI field "${key}" present in research export row`);
      }
    }
    const serialized = JSON.stringify(row);
    const scan = scanForPhiLeaks(serialized);
    if (!scan.clean) {
      throw new Error(
        `PHI pattern detected in export: ${scan.findings.map((f) => f.pattern).join(', ')}`
      );
    }
  }
}
