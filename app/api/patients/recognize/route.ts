import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { recognizePatientsInText } from '@/lib/patient-name-recognition';
import { getPatientRoster } from '@/lib/patient-roster';

export const dynamic = 'force-dynamic';

/**
 * POST /api/patients/recognize — felismeri a szabad szövegben említett betegeket
 * (teljes név + TAJ). A composer ezzel jeleníti meg a megerősítő sávot.
 */
export const POST = authedHandler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text : '';

  if (!text.trim()) {
    return NextResponse.json({ detections: [] });
  }

  const roster = await getPatientRoster();
  const detections = recognizePatientsInText(text, roster);

  return NextResponse.json({ detections });
});
