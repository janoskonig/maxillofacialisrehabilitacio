'use client';

import { X } from 'lucide-react';
import type { PendingContextLink } from './ContextLinkAttachPicker';

interface Props {
  links: PendingContextLink[];
  onRemove: (index: number) => void;
}

export function PendingContextLinksBar({ links, onRemove }: Props) {
  if (!links.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
      {links.map((link, i) => (
        <span
          key={`${link.entityType}:${link.entityId}`}
          className="inline-flex items-center gap-1 max-w-[200px] text-xs bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 rounded-full pl-2 pr-1 py-0.5"
        >
          <span className="truncate" title={link.label}>
            {link.label}
          </span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="p-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/40"
            aria-label="Eltávolítás"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
