/**
 * Manuális backend smoke a Szelet 0.3 beteg–orvos reply funkcióhoz.
 *
 * Futtatás:
 *   npx tsx scripts/smoke-patient-message-reply.ts
 *
 * NEM unit teszt — kerüld a CI-ben. Élő DB-re ír, majd takarít maga után.
 * Tisztán a `sendMessage` / `getPatientMessages` lib szinten ellenőriz; a
 * route layer (auth) tesztelése a `docs/messaging/api-smoke.http`-ban van.
 *
 * Bizonyítja:
 *   1. doctor → patient parent + patient → doctor (same lane) reply happy path.
 *   2. quotedMessage szerver oldalról, channel=patient.
 *   3. Cross-lane reply doctor sender (másik orvosnak címzett parent) → 404.
 *   4. Patient sender cross-lane reply → 404.
 *   5. Malformed UUID → 400.
 *   6. getPatientMessages a kiosztott visibility-vel hozza a preview-t.
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { sendMessage, getPatientMessages } from '../lib/communication';
import { ReplyTargetNotFoundError } from '../lib/message-reply';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Két orvos + egy beteg kell. A két orvos közül legalább az egyik
  // legyen treating (vagy admin) ehhez a beteghez, hogy a happy path
  // visibility-check átmenjen.
  const doctors = await pool.query(
    `SELECT id, email, doktor_neve FROM users WHERE active = true ORDER BY created_at ASC LIMIT 3`
  );
  assert(doctors.rows.length >= 3, 'legalább 3 aktív orvos kell');
  const [docX, docY] = doctors.rows;

  // Treating orvos beteget keresünk: ahol kezeleoorvos_user_id = docX.id
  const patients = await pool.query(
    `SELECT id, nev, email FROM patients WHERE kezeleoorvos_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [docX.id]
  );
  let patientId: string;
  let patientName: string | null;
  let patientEmail: string | null;
  if (patients.rows.length > 0) {
    patientId = patients.rows[0].id;
    patientName = patients.rows[0].nev;
    patientEmail = patients.rows[0].email;
  } else {
    // Fallback: bármelyik beteg, és docX-et "treating-nek" tekintjük a
    // legacy módon (régi VARCHAR kezeleoorvos mező), különben kihagyjuk
    // a treating-specifikus eseteket.
    const fallback = await pool.query(`SELECT id, nev, email FROM patients ORDER BY created_at DESC LIMIT 1`);
    assert(fallback.rows.length > 0, 'legalább 1 beteg kell');
    patientId = fallback.rows[0].id;
    patientName = fallback.rows[0].nev;
    patientEmail = fallback.rows[0].email;
    console.log('[setup] WARN: docX nem treating ehhez a beteghez — admin-szerű útvonalon menjünk');
  }

  console.log(`[setup] docX=${docX.email}, docY=${docY.email}, patient=${patientName ?? patientId}`);

  const createdIds: string[] = [];

  try {
    // 1) Parent: docX → patient (doctor sender, isAdmin=false, isTreating=true)
    const parent = await sendMessage({
      patientId,
      senderType: 'doctor',
      senderId: docX.id,
      senderEmail: docX.email,
      subject: '[SMOKE] parent — 0.3',
      message: 'Parent doctor → patient',
      recipientDoctorId: null,
    });
    createdIds.push(parent.id);
    console.log(`[1] parent docX → patient created: id=${parent.id}, replyToMessageId=${parent.replyToMessageId}`);
    assert(parent.replyToMessageId === null, 'parent must not be reply');

    // 2) Reply: patient → docX (lane = docX), válasz a parent-re
    if (!patientEmail) {
      console.log('[2] SKIP — betegnek nincs email, sendMessage patient ágban nem megy ezen az úton.');
    }
    const replyAsPatient = await sendMessage({
      patientId,
      senderType: 'patient',
      senderId: patientId,
      senderEmail: patientEmail || 'smoke@example.com',
      message: 'Patient reply same lane',
      recipientDoctorId: docX.id,
      replyToMessageId: parent.id,
      replySender: { kind: 'patient', patientId, laneDoctorId: docX.id },
    });
    createdIds.push(replyAsPatient.id);
    console.log(
      `[2] patient reply same-lane created: replyTo=${replyAsPatient.replyToMessageId}, quotedMessage=`,
      replyAsPatient.quotedMessage,
    );
    assert(replyAsPatient.replyToMessageId === parent.id, 'reply must reference parent');
    assert(replyAsPatient.quotedMessage, 'quotedMessage must be populated');
    assert(replyAsPatient.quotedMessage!.channel === 'patient', 'quote channel = patient');
    assert(replyAsPatient.quotedMessage!.id === parent.id, 'quote id matches parent');

    // 3) Cross-lane: docY (másik orvos) próbál válaszolni docX → patient parentre,
    //    nem admin, nem treating → 404
    let crossLaneErrorDoctor: unknown = null;
    try {
      await sendMessage({
        patientId,
        senderType: 'doctor',
        senderId: docY.id,
        senderEmail: docY.email,
        message: 'docY cross-lane reply attempt',
        recipientDoctorId: null,
        replyToMessageId: parent.id,
        replySender: { kind: 'doctor', doctorId: docY.id, isAdmin: false, isTreating: false },
      });
    } catch (e) {
      crossLaneErrorDoctor = e;
    }
    assert(
      crossLaneErrorDoctor instanceof ReplyTargetNotFoundError,
      'doctor cross-lane reply must throw ReplyTargetNotFoundError',
    );
    console.log(`[3] doctor cross-lane reply correctly rejected: ${(crossLaneErrorDoctor as Error).message}`);

    // 4) Patient cross-lane: a beteg másik orvost akar megválaszolni (laneDoctorId=docY),
    //    de a parent docX lane-ben van → 404
    let crossLaneErrorPatient: unknown = null;
    try {
      await sendMessage({
        patientId,
        senderType: 'patient',
        senderId: patientId,
        senderEmail: patientEmail || 'smoke@example.com',
        message: 'patient cross-lane reply attempt',
        recipientDoctorId: docY.id,
        replyToMessageId: parent.id,
        replySender: { kind: 'patient', patientId, laneDoctorId: docY.id },
      });
    } catch (e) {
      crossLaneErrorPatient = e;
    }
    assert(
      crossLaneErrorPatient instanceof ReplyTargetNotFoundError,
      'patient cross-lane reply must throw ReplyTargetNotFoundError',
    );
    console.log(`[4] patient cross-lane reply correctly rejected: ${(crossLaneErrorPatient as Error).message}`);

    // 5) Invalid UUID szintaxis
    let invalidError: unknown = null;
    try {
      await sendMessage({
        patientId,
        senderType: 'doctor',
        senderId: docX.id,
        senderEmail: docX.email,
        message: 'bad uuid reply',
        replyToMessageId: 'not-a-uuid',
        replySender: { kind: 'doctor', doctorId: docX.id, isAdmin: false, isTreating: true },
      });
    } catch (e) {
      invalidError = e;
    }
    assert(invalidError instanceof Error, 'bad uuid must throw');
    console.log(`[5] invalid uuid correctly rejected: ${(invalidError as Error).message}`);

    // 6) Admin happy path: docY admin-ként VÁLASZOL docX parent-re → 200 OK
    let adminReply: Awaited<ReturnType<typeof sendMessage>> | null = null;
    try {
      adminReply = await sendMessage({
        patientId,
        senderType: 'doctor',
        senderId: docY.id,
        senderEmail: docY.email,
        message: '[SMOKE] admin cross-lane reply',
        recipientDoctorId: null,
        replyToMessageId: parent.id,
        replySender: { kind: 'doctor', doctorId: docY.id, isAdmin: true, isTreating: false },
      });
      createdIds.push(adminReply.id);
      assert(adminReply.quotedMessage, 'admin reply has quotedMessage');
      console.log(`[6] admin cross-lane reply accepted: id=${adminReply.id}`);
    } catch (e) {
      console.log(`[6] admin reply unexpectedly rejected: ${(e as Error).message}`);
      throw e;
    }

    // 7) GET getPatientMessages (treating docX) — látja a reply-t (patient → docX),
    //    a quotedMessage preview-vel
    const list = await getPatientMessages(patientId, {
      doctorId: docX.id,
      isAdmin: false,
      limit: 50,
    });
    const replyInList = list.find((m) => m.id === replyAsPatient.id);
    assert(replyInList, 'patient reply must appear in docX list');
    assert(replyInList!.replyToMessageId === parent.id, 'list row preserves replyToMessageId');
    assert(replyInList!.quotedMessage, 'list row has quotedMessage');
    console.log(`[7] docX GET returns patient reply with quotedMessage: ${JSON.stringify(replyInList!.quotedMessage)}`);

    console.log('\n✅ Szelet 0.3 backend smoke OK — minden eset zöld.');
  } finally {
    if (createdIds.length > 0) {
      console.log(`[cleanup] removing ${createdIds.length} smoke message(s) and related logs…`);
      // communication_logs FK-zik a messages-re? Nézzünk rá — biztos ami biztos,
      // logCommunication NEM tartalmaz FK-t a messages-re, csak külön audit sor.
      // De rögzít communication_logs-ba a sendMessage. Töröljük ott is, ha létezik.
      try {
        await pool.query(
          `DELETE FROM communication_logs WHERE content = ANY($1::text[])`,
          [['Parent doctor → patient', 'Patient reply same lane', '[SMOKE] admin cross-lane reply']],
        );
      } catch {
        // ignore — szerkezet eltérhet
      }
      await pool.query(`DELETE FROM messages WHERE id = ANY($1::uuid[])`, [createdIds]);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Smoke failed:', err);
  process.exit(1);
});
