'use client';

import { ChatImageFigure } from './ChatImageFigure';

interface Props {
  attachmentId: string;
}

/**
 * `[CHAT_IMAGE:<id>]` marker megjelenítése: beteghez nem rendelt orvos–orvos
 * chat-kép. A fájlt a jogosultság-ellenőrzött attachment endpoint adja.
 */
export function ChatImageAttachmentCard({ attachmentId }: Props) {
  const base = `/api/doctor-messages/attachments/${attachmentId}/file`;
  return (
    <div className="my-1">
      <ChatImageFigure src={base} alt="Csatolt kép" downloadHref={`${base}?download=true`} />
    </div>
  );
}
