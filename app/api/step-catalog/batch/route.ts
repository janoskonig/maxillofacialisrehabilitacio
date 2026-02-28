import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import {
  stepCatalogBatchSchema,
  stepCatalogBatchItemSchema,
  canonicalizeStepCode,
} from '@/lib/admin-process-schemas';
import { invalidateStepLabelCache } from '@/lib/step-labels';
import { logger } from '@/lib/logger';

const STEP_CODE_REGEX = /^[a-z0-9_]+$/;

export const dynamic = 'force-dynamic';

/**
 * Parse CSV into array of { stepCode, labelHu, labelEn, isActive }
 * Format: step_code,label_hu,label_en,is_active (header optional)
 * Delimiter: comma or semicolon (auto-detect from first line)
 * is_active: 1|true|igen|yes = true, else false
 */
function parseCsvToItems(csvText: string): { items: unknown[]; errors: string[] } {
  const errors: string[] = [];
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { items: [], errors: ['Üres CSV'] };
  }

  const delim = lines[0].includes(';') ? ';' : ',';
  const rows: string[][] = lines.map((line) => {
    const parts: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (inQuotes) {
        cur += c;
      } else if (c === delim) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    parts.push(cur.trim());
    return parts;
  });

  const first = rows[0];
  const isHeader =
    first.length >= 2 &&
    (first[0].toLowerCase() === 'step_code' ||
      first[0].toLowerCase() === 'stepcode' ||
      first[0].toLowerCase() === 'code');
  const dataRows = isHeader ? rows.slice(1) : rows;

  const items: unknown[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const stepCodeRaw = row[0]?.trim() ?? '';
    const labelHu = (row[1] ?? '').trim();
    const labelEnRaw = (row[2] ?? '').trim();
    const isActiveRaw = (row[3] ?? '1').trim().toLowerCase();

    if (!stepCodeRaw) {
      errors.push(`Sor ${i + (isHeader ? 2 : 1)}: üres step_code`);
      continue;
    }
    const stepCode = canonicalizeStepCode(stepCodeRaw);
    if (!STEP_CODE_REGEX.test(stepCode)) {
      errors.push(`Sor ${i + (isHeader ? 2 : 1)}: érvénytelen step_code "${stepCodeRaw}"`);
      continue;
    }
    if (!labelHu) {
      errors.push(`Sor ${i + (isHeader ? 2 : 1)}: üres label_hu`);
      continue;
    }

    const isActive =
      ['1', 'true', 'igen', 'yes', 'i'].includes(isActiveRaw) || isActiveRaw === '';

    items.push({
      stepCode,
      labelHu,
      labelEn: labelEnRaw || null,
      isActive,
    });
  }

  return { items, errors };
}

/**
 * POST /api/step-catalog/batch — batch upsert részlépések (step_catalog)
 * Body: JSON { items: [{ stepCode, labelHu, labelEn?, isActive? }] }
 *   OR raw CSV text (Content-Type: text/csv, text/plain)
 * CSV format: step_code,label_hu,label_en,is_active (header optional)
 * Delimiter: comma or semicolon
 * Auth: admin + fogpótlástanász
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') ?? '';
    let items: unknown[];

    if (
      contentType.includes('text/csv') ||
      contentType.includes('text/plain') ||
      contentType.includes('application/csv')
    ) {
      const csvText = await request.text();
      const parsed = parseCsvToItems(csvText);
      if (parsed.errors.length > 0 && parsed.items.length === 0) {
        return NextResponse.json(
          { error: 'CSV feldolgozási hibák', details: parsed.errors },
          { status: 400 }
        );
      }
      items = parsed.items;
      if (parsed.errors.length > 0) {
        console.warn('[step-catalog/batch] CSV partial errors:', parsed.errors);
      }
    } else {
      const body = await request.json();
      const parsed = stepCatalogBatchSchema.safeParse(body);
      if (!parsed.success) {
        const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      items = parsed.data.items;
    }

    const validated: { stepCode: string; labelHu: string; labelEn: string | null; isActive: boolean }[] =
      [];
    const validationErrors: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const r = stepCatalogBatchItemSchema.safeParse(items[i]);
      if (r.success) {
        validated.push({
          stepCode: r.data.stepCode,
          labelHu: r.data.labelHu,
          labelEn: r.data.labelEn ?? null,
          isActive: r.data.isActive ?? true,
        });
      } else {
        validationErrors.push(
          `Sor ${i + 1}: ${r.error.errors.map((e) => e.message).join(', ')}`
        );
      }
    }

    if (validated.length === 0) {
      return NextResponse.json(
        {
          error: 'Nincs érvényes elem a feltöltésben',
          details: validationErrors,
        },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    const userId = auth.userId ?? null;

    for (const item of validated) {
      await pool.query(
        `INSERT INTO step_catalog (step_code, label_hu, label_en, is_active, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, now(), $5)
         ON CONFLICT (step_code) DO UPDATE SET
           label_hu = EXCLUDED.label_hu,
           label_en = EXCLUDED.label_en,
           is_active = EXCLUDED.is_active,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
        [item.stepCode, item.labelHu, item.labelEn, item.isActive, userId]
      );
    }

    invalidateStepLabelCache();

    return NextResponse.json({
      success: true,
      upserted: validated.length,
      skipped: validationErrors.length,
      details: validationErrors.length > 0 ? validationErrors : undefined,
    });
  } catch (error) {
    logger.error('Error batch upserting step catalog:', error);
    return NextResponse.json(
      { error: 'Hiba történt a részlépések feltöltésekor' },
      { status: 500 }
    );
  }
}
