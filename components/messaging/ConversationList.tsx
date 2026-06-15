'use client';

/**
 * ConversationList — közös beszélgetés-lista (csatorna-független).
 *
 * `ConversationVM[]`-et renderel `ConversationListItem`-eken keresztül,
 * opcionális kliens-oldali szűrő-mezővel és billentyűzet-navigációval
 * (fel/le nyíl + Enter, `role="listbox"`).
 */

import { useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { ConversationListItem, type ConversationVM } from './ConversationListItem';

export type { ConversationVM } from './ConversationListItem';

interface ConversationListProps {
  items: ConversationVM[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Kliens-oldali szűrő-mező megjelenítése a lista tetején. */
  showFilter?: boolean;
  filterPlaceholder?: string;
  /** Tartalom üres listánál. */
  emptyState?: ReactNode;
}

export function ConversationList({
  items,
  selectedId,
  onSelect,
  showFilter = true,
  filterPlaceholder = 'Keresés…',
  emptyState,
}: ConversationListProps) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? items.filter((vm) => {
        const q = query.trim().toLowerCase();
        return (
          vm.title.toLowerCase().includes(q) ||
          (vm.subtitle ?? '').toLowerCase().includes(q) ||
          (vm.preview ?? '').toLowerCase().includes(q)
        );
      })
    : items;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = filtered.findIndex((vm) => vm.id === selectedId);
    const nextIdx =
      e.key === 'ArrowDown'
        ? Math.min(idx + 1, filtered.length - 1)
        : Math.max(idx - 1, 0);
    const next = filtered[nextIdx];
    if (next) onSelect(next.id);
  };

  return (
    <div className="flex flex-col h-full">
      {showFilter && (
        <div className="px-3 pt-2 pb-1">
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={filterPlaceholder}
              aria-label={filterPlaceholder}
              className="flex-1 bg-transparent border-0 focus:ring-0 focus:outline-none text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-gray-400 dark:text-gray-500">
          {emptyState ?? (query.trim() ? 'Nincs találat.' : 'Nincs beszélgetés.')}
        </div>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Beszélgetések"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="flex-1 overflow-y-auto focus:outline-none"
        >
          {filtered.map((vm) => (
            <ConversationListItem key={vm.id} vm={vm} active={vm.id === selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
