'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X, Loader2, SlidersHorizontal, Paperclip } from 'lucide-react';
import { useMessageSearchContext } from '@/contexts/MessageSearchContext';
import { useMessageSearch } from '@/hooks/useMessageSearch';
import { SearchResultRow } from './SearchResultRow';

export function MessageSearchModal() {
  const { isOpen, closeSearch, preferredChannel, activeHandler, navigateToHit } =
    useMessageSearchContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  const defaultScope = activeHandler?.scope;

  const { filters, hits, total, loading, error, setQuery, patchFilters, resetFilters } =
    useMessageSearch(preferredChannel, {
      enabled: isOpen,
      defaultFilters: {
        patientId: defaultScope?.patientId,
        recipientId: defaultScope?.recipientId,
        groupId: defaultScope?.groupId,
        doctorId: defaultScope?.doctorId,
      },
    });

  useEffect(() => {
    if (!isOpen) return;
    resetFilters({
      patientId: defaultScope?.patientId,
      recipientId: defaultScope?.recipientId,
      groupId: defaultScope?.groupId,
      doctorId: defaultScope?.doctorId,
    });
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [isOpen, defaultScope?.patientId, defaultScope?.recipientId, defaultScope?.groupId, defaultScope?.doctorId, resetFilters]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeSearch]);

  if (!isOpen) return null;

  const scopeLocked = Boolean(
    defaultScope?.patientId || defaultScope?.recipientId || defaultScope?.groupId,
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 pb-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Üzenetek keresése"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSearch();
      }}
    >
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[min(80vh,640px)]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
          <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={filters.q}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Keresés az üzenetekben…"
            className="flex-1 text-base outline-none placeholder:text-gray-400"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${showFilters ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Szűrők"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Bezárás"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {showFilters && (
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 space-y-3 text-sm">
            {preferredChannel === 'patient' && !defaultScope?.patientId && (
              <label className="block">
                <span className="text-gray-600 text-xs">Beteg ID (opcionális)</span>
                <input
                  type="text"
                  value={filters.patientId ?? ''}
                  onChange={(e) =>
                    patchFilters({ patientId: e.target.value.trim() || undefined })
                  }
                  className="form-input mt-1 w-full text-sm"
                  placeholder="UUID"
                />
              </label>
            )}
            {preferredChannel === 'doctor' && !scopeLocked && (
              <label className="block">
                <span className="text-gray-600 text-xs">Címzett orvos ID (1:1)</span>
                <input
                  type="text"
                  value={filters.recipientId ?? ''}
                  onChange={(e) =>
                    patchFilters({ recipientId: e.target.value.trim() || undefined })
                  }
                  className="form-input mt-1 w-full text-sm"
                  placeholder="UUID"
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-gray-600 text-xs">Dátumtól</span>
                <input
                  type="date"
                  value={filters.from?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    patchFilters({
                      from: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined,
                    })
                  }
                  className="form-input mt-1 w-full text-sm"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Dátumig</span>
                <input
                  type="date"
                  value={filters.to?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    patchFilters({
                      to: e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined,
                    })
                  }
                  className="form-input mt-1 w-full text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-gray-600 text-xs">Küldő</span>
              <select
                value={filters.sender ?? ''}
                onChange={(e) =>
                  patchFilters({ sender: e.target.value || undefined })
                }
                className="form-input mt-1 w-full text-sm"
              >
                <option value="">Mind</option>
                <option value="me">Én küldtem</option>
                {preferredChannel === 'patient' && (
                  <>
                    <option value="doctor">Orvos</option>
                    <option value="patient">Beteg</option>
                  </>
                )}
                {preferredChannel === 'doctor' && (
                  <option value="other">Mások</option>
                )}
              </select>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.hasAttachment ?? false}
                onChange={(e) =>
                  patchFilters({ hasAttachment: e.target.checked || undefined })
                }
                className="rounded border-gray-300"
              />
              <Paperclip className="w-4 h-4 text-gray-500" />
              <span className="text-gray-700">Csak dokumentum-linkkel</span>
            </label>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-[120px]">
          {filters.q.trim().length < 2 && (
            <p className="p-6 text-center text-sm text-gray-500">
              Írjon legalább 2 karaktert. Gyorsbillentyű: <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">/</kbd>
            </p>
          )}
          {filters.q.trim().length >= 2 && loading && (
            <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Keresés…
            </div>
          )}
          {error && (
            <p className="p-4 text-sm text-red-600 text-center">{error}</p>
          )}
          {!loading && !error && filters.q.trim().length >= 2 && hits.length === 0 && (
            <p className="p-6 text-center text-sm text-gray-500">Nincs találat</p>
          )}
          {!loading &&
            hits.map((hit) => (
              <SearchResultRow key={`${hit.channel}-${hit.id}`} hit={hit} onSelect={navigateToHit} />
            ))}
        </div>

        {total > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500 bg-gray-50">
            {hits.length} / {total} találat — kattintás: ugrás az üzenethez
          </div>
        )}
      </div>
    </div>
  );
}
