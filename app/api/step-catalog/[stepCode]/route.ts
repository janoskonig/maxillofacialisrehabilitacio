import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { stepCatalogPatchSchema } from '@/lib/admin-process-schemas';
import { invalidateStepLabelCache } from '@/lib/step-labels';

const STEP_CODE_REGEX = /^[a-z0-9_]+$/;

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/step-catalog/[stepCode] — update step label. Cache clear after.
 * Auth: admin + fogpótlástanász
 */
export const PATCH = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth, params }) => {
  const stepCode = decodeURIComponent(params.stepCode);
  if (!STEP_CODE_REGEX.test(stepCode)) {
    return NextResponse.json(
      { error: 'stepCode csak a-z, 0-9, _ lehet' },
      { status: 400 }
    );
  }

  const body = await req.json();
  const parsed = stepCatalogPatchSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const data = parsed.data;

  const pool = getDbPool();

  const exists = await pool.query(
    `SELECT 1 FROM step_catalog WHERE step_code = $1`,
    [stepCode]
  );
  if (exists.rows.length === 0) {
    return NextResponse.json({ error: 'Lépés nem található' }, { status: 404 });
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.labelHu !== undefined) {
    updates.push(`label_hu = $${idx}`);
    values.push(data.labelHu);
    idx++;
  }
  if (data.labelEn !== undefined) {
    updates.push(`label_en = $${idx}`);
    values.push(data.labelEn);
    idx++;
  }
  if (data.isActive !== undefined) {
    updates.push(`is_active = $${idx}`);
    values.push(data.isActive);
    idx++;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
  }

  updates.push(`updated_at = now()`, `updated_by = $${idx}`);
  values.push(auth.userId ?? null);
  idx++;
  values.push(stepCode);

  await pool.query(
    `UPDATE step_catalog SET ${updates.join(', ')} WHERE step_code = $${idx}`,
    values
  );

  invalidateStepLabelCache();

  const afterResult = await pool.query(
    `SELECT step_code as "stepCode", label_hu as "labelHu", label_en as "labelEn",
            is_active as "isActive", updated_at as "updatedAt"
     FROM step_catalog WHERE step_code = $1`,
    [stepCode]
  );

  return NextResponse.json({ item: afterResult.rows[0] });
});
