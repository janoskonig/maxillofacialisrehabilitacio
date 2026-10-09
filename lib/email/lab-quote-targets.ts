import { getDbPool } from '@/lib/db';
import { LAB_QUOTE_TARGETS, type LabQuoteTarget } from './lab-quote-target-catalog';
export { isLabQuoteTargetId } from './lab-quote-target-catalog';

export async function getLabQuoteTargets(): Promise<LabQuoteTarget[]> {
  const result = await getDbPool().query<{ target_id: string; email: string | null }>(
    'SELECT target_id, email FROM lab_quote_target_settings'
  );
  const saved = new Map(result.rows.map(row => [row.target_id, row.email]));
  return LAB_QUOTE_TARGETS.map(target => ({
    ...target,
    email: saved.has(target.id) ? saved.get(target.id)! : target.email,
  }));
}
