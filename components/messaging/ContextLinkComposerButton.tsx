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
          'flex-shrink-0 btn-secondary rounded-full w-10 h-10 sm:w-auto sm:rounded-lg sm:px-3 sm:py-2.5 p-0 sm:p-2'
        }
        title="Strukturált link csatolása (beteg, dokumentum, …)"
      >
        <Paperclip className="w-4 h-4 sm:mr-1" />
        <span className="hidden sm:inline text-sm">Csatolás</span>
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
