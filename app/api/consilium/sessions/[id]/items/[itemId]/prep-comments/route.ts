import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import {
  assertSessionWritableForItemFields,
  getScopedSessionOrThrow,
  getUserInstitution,
} from '@/lib/consilium';
import {
  assertChecklistKeyOnItem,
  authorDisplayForUser,
  prepCommentBodySchema,
} from '@/lib/consilium-prep-share';
import { getDbPool } from '@/lib/db';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItemFields(session.status);

  const body = prepCommentBodySchema.parse(await req.json());
  await assertChecklistKeyOnItem(itemId, sessionId, body.checklistKey);

  const authorDisplay = await authorDisplayForUser(auth.userId);
  const pool = getDbPool();
  const ins = await pool.query(
    `INSERT INTO consilium_prep_comments (
       session_id, item_id, checklist_key, author_user_id, author_display, body
     )
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6)
     RETURNING id, checklist_key as "checklistKey", body, author_display as "authorDisplay", created_at as "createdAt"`,
    [sessionId, itemId, body.checklistKey, auth.userId, authorDisplay, body.body],
  );

  const row = ins.rows[0];
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);

  await logActivity(
    req,
    auth.email,
    'consilium_prep_comment_created',
    JSON.stringify({
      sessionId,
      itemId,
      checklistKey: body.checklistKey,
      commentId: row.id,
      bodyLength: body.body.length,
    }),
    { skipAdminNotificationQueue: true },
  );

  return NextResponse.json(
    {
      comment: {
        id: row.id,
        checklistKey: row.checklistKey,
        body: row.body,
        authorDisplay: row.authorDisplay,
        createdAt,
      },
    },
    { status: 201 },
  );
});
