'use client';

import { Search } from 'lucide-react';
import { useMessageSearchContextOptional } from '@/contexts/MessageSearchContext';
import type { MessageChannel } from '@/lib/types/messaging';

interface Props {
  channel?: MessageChannel;
  className?: string;
  title?: string;
}

export function MessageSearchButton({
  channel,
  className,
  title = 'Üzenetek keresése (/)',
}: Props) {
  const ctx = useMessageSearchContextOptional();
  if (!ctx) return null;

  return (
    <button
      type="button"
      onClick={() => ctx.openSearch(channel)}
      className={
        className ??
        'flex-shrink-0 p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 transition-colors mobile-touch-target'
      }
      title={title}
      aria-label={title}
    >
      <Search className="w-5 h-5" />
    </button>
  );
}
