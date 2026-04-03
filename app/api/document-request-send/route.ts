import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { sendMessage } from '@/lib/communication';
import { sendDoctorMessage } from '@/lib/doctor-communication';
import { insertUserTask } from '@/lib/user-tasks';
import { buildDocumentRequestCommandMessage } from '@/lib/document-request-build';
import { validateUUID } from '@/lib/validation';
import { assertStaffCanAccessPatient } from '@/lib/staff-patient-access';

export const dynamic = 'force-dynamic';

const DOC_TITLE: Record<string, string> = {
  op: 'OP (panorámaröntgen) feltöltése',
  foto: 'Önarckép / szájfotó feltöltése',
  zarojelentes: 'Zárójelentés feltöltése',
  'ambulans lap': 'Ambuláns lap feltöltése',
  egyeb: 'Dokumentum feltöltése',
  '': 'Dokumentum feltöltése',
};

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { patientId, mode, colleagueUserId, documentTag, note } = body as {
    patientId?: string;
    mode?: 'patient' | 'colleague' | 'self';
    colleagueUserId?: string | null;
    documentTag?: string;
    note?: string | null;
  };

  let validatedPatientId: string;
  try {
    validatedPatientId = validateUUID(patientId, 'Beteg ID');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Érvénytelen beteg ID';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!mode || !['patient', 'colleague', 'self'].includes(mode)) {
    return NextResponse.json({ error: 'Érvénytelen mód' }, { status: 400 });
  }

  const tag = typeof documentTag === 'string' ? documentTag.trim() || 'egyeb' : 'egyeb';
  const noteText = typeof note === 'string' && note.trim() ? note.trim() : '';

  const access = await assertStaffCanAccessPatient(auth.userId, auth.email, auth.role, validatedPatientId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const pool = getDbPool();
  const patientRow = await pool.query(`SELECT id, nev FROM patients WHERE id = $1`, [validatedPatientId]);
  if (patientRow.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }
  const patientName = (patientRow.rows[0].nev as string) || 'Beteg';

  const baseCommand = buildDocumentRequestCommandMessage(patientName, tag);
  const fullMessage = noteText ? `${baseCommand}\n\n${noteText}` : baseCommand;
  const tagLc = tag.toLowerCase();
  const taskTitle =
    DOC_TITLE[tagLc] ?? DOC_TITLE[tag] ?? `Dokumentum feltöltése: ${tag}`;

  const poolSender = await pool.query(`SELECT email, doktor_neve FROM users WHERE id = $1`, [auth.userId]);
  const senderEmail = poolSender.rows[0]?.email as string;
  const senderName = poolSender.rows[0]?.doktor_neve as string | null;

  if (mode === 'patient') {
    const newMessage = await sendMessage({
      patientId: validatedPatientId,
      senderType: 'doctor',
      senderId: auth.userId,
      senderEmail,
      subject: null,
      message: fullMessage,
    });

    await insertUserTask({
      assigneeKind: 'patient',
      assigneeUserId: null,
      assigneePatientId: validatedPatientId,
      patientId: validatedPatientId,
      taskType: 'document_upload',
      title: taskTitle,
      description: noteText || null,
      metadata: { documentTag: tag || 'egyeb' },
      sourceMessageId: newMessage.id,
      sourceDoctorMessageId: null,
      createdByUserId: auth.userId,
    });

    return NextResponse.json({
      success: true,
      patientMessage: newMessage,
    });
  }

  if (mode === 'colleague') {
    if (!colleagueUserId || colleagueUserId === auth.userId) {
      return NextResponse.json({ error: 'Válasszon kollégát' }, { status: 400 });
    }
    let validatedColleague: string;
    try {
      validatedColleague = validateUUID(colleagueUserId, 'Kolléga ID');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Érvénytelen kolléga ID';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const col = await pool.query(
      `SELECT id, active FROM users WHERE id = $1 AND role != 'technikus'`,
      [validatedColleague]
    );
    if (col.rows.length === 0 || !col.rows[0].active) {
      return NextResponse.json({ error: 'A kolléga nem található vagy nem aktív' }, { status: 404 });
    }

    const dm = await sendDoctorMessage({
      recipientId: validatedColleague,
      senderId: auth.userId,
      senderEmail: auth.email,
      senderName,
      subject: `Dokumentum kérés — ${patientName}`,
      message: fullMessage,
    });

    await insertUserTask({
      assigneeKind: 'staff',
      assigneeUserId: validatedColleague,
      assigneePatientId: null,
      patientId: validatedPatientId,
      taskType: 'document_upload',
      title: `${taskTitle} (${patientName})`,
      description: noteText || null,
      metadata: { documentTag: tag || 'egyeb', patientName },
      sourceMessageId: null,
      sourceDoctorMessageId: dm.id,
      createdByUserId: auth.userId,
    });

    return NextResponse.json({
      success: true,
      doctorMessage: dm,
    });
  }

  // self — csak feladat, chat nélkül
  await insertUserTask({
    assigneeKind: 'staff',
    assigneeUserId: auth.userId,
    assigneePatientId: null,
    patientId: validatedPatientId,
    taskType: 'document_upload',
    title: `${taskTitle} — ${patientName} (emlékeztető)`,
    description: noteText || baseCommand,
    metadata: { documentTag: tag || 'egyeb', patientName, selfReminder: true },
    sourceMessageId: null,
    sourceDoctorMessageId: null,
    createdByUserId: auth.userId,
  });

  return NextResponse.json({ success: true, selfTaskOnly: true });
});
