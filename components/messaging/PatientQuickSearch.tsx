'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';

export interface PatientQuickSearchResult {
  id: string;
  nev: string | null;
  taj?: string | null;
}

interface Props {
  onSelect: (patient: PatientQuickSearchResult) => void;
  autoFocus?: boolean;
  placeholder?: string;
}

/** Beteg keresése név szerint (debounce-olt `/api/patients?q=`), listás választással. */
export function PatientQuickSearch({ onSelect, autoFocus = false, placeholder = 'Beteg keresése név szerint…' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientQuickSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/patients?q=${encodeURIComponent(q)}&limit=20`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Beteglista hiba');
        const data = await res.json();
        if (!cancelled) setResults(data.patients ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        <input
          type="search"
          className="form-input w-full pl-9"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={autoFocus}
          aria-label="Beteg keresése"
        />
      </div>
      {query.trim() && (
        <div className="mt-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Keresés…
            </div>
          ) : results.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">Nincs találat</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(p)}
                    className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{p.nev || p.id}</span>
                    {p.taj ? <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{p.taj}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
