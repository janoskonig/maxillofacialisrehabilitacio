/**
 * GET /api/scheduling/virtual-appointments
 * Virtual appointments = next required steps not yet booked.
 * Date-domain strict: YYYY-MM-DD only, horizon clamp, queryEcho, observability.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import {
  fetchVirtualAppointments,
  DEFAULT_HORIZON_DAYS,
  TIMEZONE,
} from '@/lib/virtual-appointments-service';
import { logger } from '@/lib/logger';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(s: string | null): boolean {
  if (!s || typeof s !== 'string') return false;
  if (!DATE_ONLY_REGEX.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const horizonDaysParam = searchParams.get('horizonDays');
    const providerId = searchParams.get('providerId') || undefined;
    const pool = searchParams.get('pool') || undefined;
    const readyOnly = searchParams.get('readyOnly') === 'true';

    // Reject timestamps (ISO with T, Z, or time component)
    if (startDateParam && (startDateParam.includes('T') || startDateParam.includes('Z'))) {
      return NextResponse.json(
        { code: 'INVALID_DATE_FORMAT', error: 'startDate must be YYYY-MM-DD only' },
        { status: 400 }
      );
    }
    if (endDateParam && (endDateParam.includes('T') || endDateParam.includes('Z'))) {
      return NextResponse.json(
        { code: 'INVALID_DATE_FORMAT', error: 'endDate must be YYYY-MM-DD only' },
        { status: 400 }
      );
    }

    if (!isValidDateOnly(startDateParam) || !isValidDateOnly(endDateParam)) {
      return NextResponse.json(
        { code: 'INVALID_DATE_FORMAT', error: 'startDate and endDate must be valid YYYY-MM-DD' },
        { status: 400 }
      );
    }

    const horizonDays = horizonDaysParam
      ? Math.min(parseInt(horizonDaysParam, 10) || DEFAULT_HORIZON_DAYS, 365)
      : DEFAULT_HORIZON_DAYS;

    let rangeStartDate = startDateParam!;
    let rangeEndDate = endDateParam!;

    if (rangeEndDate < rangeStartDate) {
      return NextResponse.json(
        { code: 'INVALID_DATE_RANGE', error: 'endDate must be >= startDate' },
        { status: 400 }
      );
    }

    // Clamp range to horizon
    const start = new Date(rangeStartDate);
    const end = new Date(rangeEndDate);
    const maxEnd = new Date(start);
    maxEnd.setDate(maxEnd.getDate() + horizonDays);
    if (end > maxEnd) {
      rangeEndDate = maxEnd.toISOString().slice(0, 10);
    }

    const { items, meta } = await fetchVirtualAppointments({
      rangeStartDate,
      rangeEndDate,
      providerId,
      pool,
      readyOnly,
    });

    const serverNow = new Date();
    const computedAtISO = serverNow.toISOString();

    return NextResponse.json({
      queryEcho: {
        startDate: startDateParam,
        endDate: endDateParam,
        horizonDays,
        providerId: providerId || undefined,
        pool: pool || undefined,
        readyOnly,
      },
      serverNowISO: computedAtISO,
      computedAtISO,
      rangeStartDate,
      rangeEndDate,
      dateDomain: 'DATE_ONLY_INCLUSIVE' as const,
      timezone: TIMEZONE,
      items,
      meta: {
        ...meta,
        limitApplied: meta.limitApplied,
      },
    });
  } catch (error) {
    logger.error('Error fetching virtual appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt a virtuális időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}
