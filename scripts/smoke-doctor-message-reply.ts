/**
 * Manuális backend smoke a Szelet 0.2 reply funkcióhoz.
 *
 * Futtatás:
 *   npx tsx scripts/smoke-doctor-message-reply.ts
 *
 * NEM unit teszt — kerüld a CI-ben. Élő DB-re ír, majd takarít maga után
 * (rollback transaction). Két dolgot bizonyít:
 *   1. 1:1 reply ugyanabban a szálban → quotedMessage szerver oldalról jön.
 *   2. Cross-thread reply (másik 1:1 párra mutat) → ReplyTargetNotFoundError.
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { sendDoctorMessage, getDoctorMessages } from '../lib/doctor-communication';
import { ReplyTargetNotFoundError } from '../lib/message-reply';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Két aktív orvos kell — keressünk meglévőket.
  const doctors = await pool.query(
    `SELECT id, email, doktor_neve FROM users WHERE active = true ORDER BY created_at ASC LIMIT 3`
  );
  assert(doctors.rows.length >= 3, 'legalább 3 aktív orvos kell a smoke-hoz');
  const [a, b, c] = doctors.rows;
  console.log(`[setup] sender=${a.email}, recipient=${b.email}, outsider=${c.email}`);

  const createdIds: string[] = [];

  try {
    // 1) Parent üzenet A → B
    const parent = await sendDoctorMessage({
      senderId: a.id,
      senderEmail: a.email,
      senderName: a.doktor_neve,
      recipientId: b.id,
      message: '[SMOKE] parent — 0.2',
    });
    createdIds.push(parent.id);
    console.log(`[1] parent created: id=${parent.id}, replyToMessageId=${parent.replyToMessageId}`);
    assert(parent.replyToMessageId === null, 'parent should not be a reply');

    // 2) Reply A → B ugyanabban a szálban (parent-re)
    const reply = await sendDoctorMessage({
      senderId: a.id,
      senderEmail: a.email,
      senderName: a.doktor_neve,
      recipientId: b.id,
      message: '[SMOKE] reply same thread',
      replyToMessageId: parent.id,
    });
    createdIds.push(reply.id);
    console.log(
      `[2] reply created: id=${reply.id}, replyTo=${reply.replyToMessageId}, quotedMessage=`,
      reply.quotedMessage,
    );
    assert(reply.replyToMessageId === parent.id, 'reply must reference parent');
    assert(reply.quotedMessage !== null && reply.quotedMessage !== undefined, 'quotedMessage must be populated');
    assert(reply.quotedMessage!.id === parent.id, 'quotedMessage.id matches parent');
    assert(reply.quotedMessage!.channel === 'doctor', 'quote channel = doctor');
    assert(
      typeof reply.quotedMessage!.message === 'string' && reply.quotedMessage!.message.length > 0,
      'quote message text not empty',
    );

    // 3) Cross-thread reply: parent A↔B üzenetre B↔C szálból válaszolni → 404
    let cross_threadError: unknown = null;
    try {
      await sendDoctorMessage({
        senderId: b.id,
        senderEmail: b.email,
        senderName: b.doktor_neve,
        recipientId: c.id,
        message: '[SMOKE] cross thread reply should fail',
        replyToMessageId: parent.id,
      });
    } catch (e) {
      cross_threadError = e;
    }
    assert(cross_threadError instanceof ReplyTargetNotFoundError, 'cross-thread reply must throw ReplyTargetNotFoundError');
    console.log(`[3] cross-thread reply correctly rejected: ${(cross_threadError as Error).message}`);

    // 4) Invalid UUID szintaxis → throw 'Érvénytelen ...'
    let invalidError: unknown = null;
    try {
      await sendDoctorMessage({
        senderId: a.id,
        senderEmail: a.email,
        senderName: a.doktor_neve,
        recipientId: b.id,
        message: '[SMOKE] bad reply id',
        replyToMessageId: 'not-a-uuid',
      });
    } catch (e) {
      invalidError = e;
    }
    assert(invalidError instanceof Error, 'bad uuid must throw');
    console.log(`[4] invalid uuid correctly rejected: ${(invalidError as Error).message}`);

    // 5) GET getDoctorMessages → reply rendben látszódik a listában
    const list = await getDoctorMessages(a.id, { recipientId: b.id, limit: 50 });
    const replyInList = list.find((m) => m.id === reply.id);
    assert(replyInList, 'reply must appear in list');
    assert(replyInList!.replyToMessageId === parent.id, 'list row preserves replyToMessageId');
    assert(replyInList!.quotedMessage, 'list row has quotedMessage');
    console.log(`[5] list returns reply with quotedMessage: ${JSON.stringify(replyInList!.quotedMessage)}`);

    console.log('\n✅ Szelet 0.2 backend smoke OK — minden eset zöld.');
  } finally {
    if (createdIds.length > 0) {
      console.log(`[cleanup] removing ${createdIds.length} smoke message(s)…`);
      await pool.query(`DELETE FROM doctor_messages WHERE id = ANY($1::uuid[])`, [createdIds]);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Smoke failed:', err);
  process.exit(1);
});
