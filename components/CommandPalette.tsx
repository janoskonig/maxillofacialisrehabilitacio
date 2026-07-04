'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UserRound, CornerDownLeft } from 'lucide-react';
import { visibleGroups, visibleFooter, type Role } from '@/lib/navigation';
import { useModalA11y } from '@/hooks/useModalA11y';

interface PatientHit {
  id: string;
  nev: string | null;
  taj: string | null;
}

interface PaletteItem {
  key: string;
  kind: 'patient' | 'nav';
  label: string;
  sublabel?: string;
  href: string;
}

interface CommandPaletteProps {
  role: Role;
}

/**
 * Ctrl/Cmd+K parancspaletta: betegkeresés (név/TAJ) + navigációs célok.
 * Nyilakkal választható, Enter megnyitja; Esc zár. A nav-célok a központi
 * lib/navigation registry szerep-szűrt listájából jönnek.
 */
export function CommandPalette({ role }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<PatientHit[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [searching, setSearching] = useState(false);
  const modalRef = useModalA11y({ active: open, onClose: () => setOpen(false) });
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Globális Ctrl/Cmd+K
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Nyitáskor tiszta állapot
  useEffect(() => {
    if (open) {
      setQuery('');
      setPatients([]);
      setHighlight(0);
    }
  }, [open]);

  // Debounce-olt betegkeresés
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setPatients([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients?q=${encodeURIComponent(q)}&limit=8`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        setPatients(
          (data.patients || []).map((p: any) => ({ id: p.id, nev: p.nev, taj: p.taj }))
        );
        setHighlight(0);
      } catch {
        // hálózati hiba / abort — a paletta üresen marad
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const navItems = useMemo(() => {
    const groups = visibleGroups(role);
    const all = [...groups.flatMap(g => g.items), ...visibleFooter(role)];
    const q = query.trim().toLowerCase();
    return all.filter(item => !q || item.label.toLowerCase().includes(q));
  }, [role, query]);

  const items: PaletteItem[] = useMemo(
    () => [
      ...patients.map(p => ({
        key: `patient-${p.id}`,
        kind: 'patient' as const,
        label: p.nev || 'Név nélküli beteg',
        sublabel: p.taj || undefined,
        href: `/patients/${p.id}/view`,
      })),
      ...navItems.map(n => ({
        key: `nav-${n.id}`,
        kind: 'nav' as const,
        label: n.label,
        href: n.path,
      })),
    ],
    [patients, navItems]
  );

  const openItem = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      setOpen(false);
      router.push(item.href);
    },
    [router]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[90] flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Parancspaletta"
      onMouseDown={e => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg outline-none overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 border-b border-gray-200 dark:border-gray-800">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight(h => Math.min(h + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight(h => Math.max(h - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                openItem(items[highlight]);
              }
            }}
            placeholder="Beteg neve, TAJ, vagy oldal..."
            className="w-full py-3 bg-transparent text-base text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none"
            aria-label="Keresés betegre vagy oldalra"
          />
          <kbd className="text-[10px] text-gray-400 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto py-2" role="listbox" aria-label="Találatok">
          {searching && patients.length === 0 && query.trim().length >= 2 && (
            <li className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">Keresés...</li>
          )}
          {items.length === 0 && !searching && (
            <li className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">Nincs találat.</li>
          )}
          {items.map((item, idx) => (
            <li key={item.key} role="option" aria-selected={idx === highlight}>
              <button
                type="button"
                onClick={() => openItem(item)}
                onMouseEnter={() => setHighlight(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm ${
                  idx === highlight
                    ? 'bg-medical-primary/10 text-gray-900 dark:text-gray-100'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {item.kind === 'patient' ? (
                  <UserRound className="w-4 h-4 text-medical-primary flex-shrink-0" aria-hidden="true" />
                ) : (
                  <CornerDownLeft className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
                )}
                <span className="flex-1 min-w-0 truncate font-medium">{item.label}</span>
                {item.sublabel && (
                  <span className="text-xs text-gray-400 flex-shrink-0">{item.sublabel}</span>
                )}
                <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0">
                  {item.kind === 'patient' ? 'beteg' : 'oldal'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
