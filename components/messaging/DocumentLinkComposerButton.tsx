'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { DocumentLinkPicker } from './DocumentLinkPicker';
import type { DocumentLinkChatType } from '@/lib/messaging/document-link-marker';
import { insertDocumentLinkIntoMessage } from '@/lib/messaging/document-link-marker';

interface DocumentLinkComposerButtonProps {
  patientId?: string | null;
  chatType: DocumentLinkChatType;
  portalMode?: boolean;
  disabled?: boolean;
  /** Teljes üzenetszöveg a marker beszúrása után. */
  onInsert: (messageText: string) => void;
  /** Jelenlegi composer szöveg (marker beszúráshoz). */
  messageText: string;
  className?: string;
  title?: string;
}

/**
 * Composer gomb: meglévő feltöltött dokumentum kiválasztása és link marker beszúrása.
 */
export function DocumentLinkComposerButton({
  patientId,
  chatType,
  portalMode = false,
  disabled = false,
  onInsert,
  messageText,
  className,
  title = 'Feltöltött dokumentum linkelése',
}: DocumentLinkComposerButtonProps) {
  const [open, setOpen] = useState(false);
  const canOpen = portalMode || patientId || chatType === 'doctor-doctor';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || !canOpen}
        className={
          className ??
          'flex-shrink-0 btn-secondary rounded-full w-10 h-10 sm:w-auto sm:rounded-lg sm:px-3 sm:py-2.5 p-0 sm:p-2'
        }
        title={title}
      >
        <Link2 className="w-4 h-4 sm:mr-1" />
        <span className="hidden sm:inline text-sm">Link</span>
      </button>

      <DocumentLinkPicker
        isOpen={open}
        onClose={() => setOpen(false)}
        patientId={patientId}
        chatType={chatType}
        portalMode={portalMode}
        onSelect={(marker) => {
          onInsert(insertDocumentLinkIntoMessage(messageText, marker));
        }}
      />
    </>
  );
}
