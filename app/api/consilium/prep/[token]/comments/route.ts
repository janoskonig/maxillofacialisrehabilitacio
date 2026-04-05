import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  assertChecklistKeyOnItem,
  assertPrepTokenOrThrow,
  authorDisplayForUser,
  listPrepCommentsForItem,
  prepCommentBodySchema,
} from '@/lib/consilium-prep-share';
import { getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth, params }) => {
  const rawToken = decodeURIComponent(params.token ?? '');
  if (!rawToken) {
    return NextResponse.json({ error: 'Hiányzó token' }, { status: 400 });
  }
  const institutionId = await getUserInstitution(auth);
  const prep = await assertPrepTokenOrThrow(rawToken, institutionId);
  const prepComments = await listPrepCommentsForItem(prep.itemId);
  return NextResponse.json({ prepComments });
});

export const POST = authedHandler(async (req, { auth, params }) => {
  const rawToken = decodeURIComponent(params.token ?? '');
  if (!rawToken) {
    return NextResponse.json({ error: 'Hiányzó token' }, { status: 400 });
  }

  const institutionId = await getUserInstitution(auth);
  const prep = await assertPrepTokenOrThrow(rawToken, institutionId);

  if (prep.sessionStatus === 'closed') {
    throw new HttpError(403, 'Lezárt alkalomhoz nem lehet hozzászólni', 'SESSION_CLOSED');
  }

  const body = prepCommentBodySchema.parse(await req.json());
  await assertChecklistKeyOnItem(prep.itemId, prep.sessionId, body.checklistKey);

  const authorDisplay = await authorDisplayForUser(auth.userId);
  const pool = getDbPool();
  const ins = await pool.query(
    `INSERT INTO consilium_prep_comments (
       session_id, item_id, checklist_key, author_user_id, author_display, body
     )
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6)
     RETURNING id, checklist_key as "checklistKey", body, author_display as "authorDisplay", created_at as "createdAt"`,
    [prep.sessionId, prep.itemId, body.checklistKey, auth.userId, authorDisplay, body.body],
  );

  const row = ins.rows[0];
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);

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
