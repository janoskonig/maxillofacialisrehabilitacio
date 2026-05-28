'use client';

import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { ContextLinkAttachPicker, type PendingContextLink } from './ContextLinkAttachPicker';

interface Props {
  patientId?: string | null;
  pendingLinks: PendingContextLink[];
  onAddPending: (link: PendingContextLink) => void;
  disabled?: boolean;
  className?: string;
}

export function ContextLinkComposerButton({
  patientId,
  pendingLinks,
  onAddPending,
  disabled = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const excludeKeys = pendingLinks.map((l) => `${l.entityType}:${l.entityId}`);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={
          className ??
          'inline-flex items-center justify-center gap-1.5 flex-shrink-0 btn-secondary rounded-full w-10 h-10 p-0 sm:w-auto sm:h-auto sm:min-h-[44px] sm:rounded-lg sm:px-3 sm:py-2'
        }
        title="Strukturált link csatolása (beteg, dokumentum, …)"
      >
        <Paperclip className="w-4 h-4 flex-shrink-0" />
        <span className="hidden sm:inline text-sm leading-none whitespace-nowrap">Csatolás</span>
      </button>
      <ContextLinkAttachPicker
        isOpen={open}
        onClose={() => setOpen(false)}
        patientId={patientId}
        excludeKeys={excludeKeys}
        onSelect={onAddPending}
      />
    </>
  );
}
