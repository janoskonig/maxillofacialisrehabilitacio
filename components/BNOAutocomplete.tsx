'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface BNOCode {
  kod: string;
  nev: string;
}

interface BNOAutocompleteProps {
  id?: string;
  value: string;
  onChange: (kod: string, nev: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

const normalizeText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const normalizeCode = (text: string) => text.replace(/[.\s]/g, '').toUpperCase();

export function BNOAutocomplete({
  id,
  value,
  onChange,
  placeholder = 'Keresés BNO-kódra vagy diagnózisnévre...',
  className = 'form-input',
  readOnly = false,
  disabled = false,
}: BNOAutocompleteProps) {
  const listId = useId();
  const [searchTerm, setSearchTerm] = useState(value || '');
  const [bnoCodes, setBnoCodes] = useState<BNOCode[]>([]);
  const [isLoadingCodes, setIsLoadingCodes] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const canEdit = !readOnly && !disabled;

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingCodes(true);
    setLoadFailed(false);
    async function loadCodes() {
      try {
        const response = await fetch('/api/bno-codes', { signal: controller.signal });
        if (!response.ok) throw new Error('BNO-törzs betöltése sikertelen');
        const codes: unknown = await response.json();
        if (!Array.isArray(codes) || codes.length === 0 || !codes.every(code =>
          typeof code?.kod === 'string' && typeof code?.nev === 'string'
        )) throw new Error('Hiányos BNO-törzs');
        if (!controller.signal.aborted) setBnoCodes(codes);
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      } finally {
        if (!controller.signal.aborted) setIsLoadingCodes(false);
      }
    }
    void loadCodes();
    return () => controller.abort();
  }, [loadAttempt]);

  // A kiválasztott kód és a keresőszöveg külön érték. A gépelés nem írja felül
  // a mentett BNO-t / diagnózist, a külső reset viszont mindig érvényesül.
  useEffect(() => {
    setSearchTerm(value || '');
    setShowDropdown(false);
    setSelectedIndex(-1);
  }, [value]);

  const searchableCodes = useMemo(() => bnoCodes.map(code => ({
    code,
    name: normalizeText(code.nev),
    key: normalizeCode(code.kod),
  })), [bnoCodes]);

  const filteredCodes = useMemo(() => {
    const words = normalizeText(searchTerm).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const codeTerm = normalizeCode(searchTerm);
    return searchableCodes
      .filter(row => row.key.includes(codeTerm) || words.every(word => row.name.includes(word)))
      .slice(0, 15)
      .map(row => row.code);
  }, [searchTerm, searchableCodes]);

  const open = canEdit && showDropdown && searchTerm.trim() !== '' && !isLoadingCodes && !loadFailed;

  function selectCode(code: BNOCode) {
    // Kizárólag a törzsben létező kódot mentjük; nem gyártunk kódot csonkolással.
    setSearchTerm(code.kod);
    setShowDropdown(false);
    setSelectedIndex(-1);
    onChange(code.kod, code.nev);
  }

  function resolveCode() {
    const key = normalizeCode(searchTerm);
    return bnoCodes.find(code => normalizeCode(code.kod) === key)
      || (/^[A-Z]\d{2,3}$/.test(key)
        ? bnoCodes.find(code => normalizeCode(code.kod) === key.padEnd(5, '0'))
        : undefined)
      || bnoCodes.find(code => normalizeText(code.nev) === normalizeText(searchTerm));
  }

  useEffect(() => {
    if (selectedIndex >= 0 && open) {
      dropdownRef.current?.children[selectedIndex]?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [selectedIndex, open]);

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={id ? undefined : 'BNO-kód vagy diagnózis keresése'}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && selectedIndex >= 0 ? `${listId}-${selectedIndex}` : undefined}
        aria-busy={isLoadingCodes}
        value={searchTerm}
        onChange={event => {
          const next = event.target.value;
          setSearchTerm(next);
          setShowDropdown(true);
          setSelectedIndex(-1);
          if (!next.trim()) onChange('', '');
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => {
          if (canEdit && searchTerm !== value) {
            const exact = resolveCode();
            if (exact) selectCode(exact);
            else setSearchTerm(value || '');
          }
          setShowDropdown(false);
          setSelectedIndex(-1);
        }}
        onKeyDown={event => {
          if (!canEdit) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setShowDropdown(true);
            setSelectedIndex(index => event.key === 'ArrowDown'
              ? Math.min(index + 1, filteredCodes.length - 1)
              : Math.max(index - 1, -1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const code = open && selectedIndex >= 0 ? filteredCodes[selectedIndex]
              : resolveCode() || (open && filteredCodes.length === 1 ? filteredCodes[0] : undefined);
            if (code) selectCode(code);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setSearchTerm(value || '');
            setShowDropdown(false);
            setSelectedIndex(-1);
          }
        }}
        placeholder={isLoadingCodes ? 'BNO-kódok betöltése...' : placeholder}
        className={className}
        readOnly={readOnly}
        disabled={disabled}
        autoComplete="off"
      />
      {loadFailed && (
        <p role="status" className="mt-1 text-sm text-amber-700 dark:text-amber-300">
          A BNO-kereső nem tölthető be.
          {canEdit && <button type="button" className="ml-2 underline" onClick={() => setLoadAttempt(n => n + 1)}>Újrapróbálás</button>}
        </p>
      )}
      {open && (
        <div
          ref={dropdownRef}
          id={listId}
          role="listbox"
          aria-label="BNO-találatok"
          className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {filteredCodes.length === 0 && <p role="status" className="px-4 py-3 text-sm text-gray-500">Nincs találat. Keressen kódrészletre vagy a diagnózis egy szavára.</p>}
          {filteredCodes.map((code, index) => (
            <div
              key={code.kod}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={event => {
                event.preventDefault();
                selectCode(code);
              }}
              className={`px-4 py-2 cursor-pointer text-sm border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${index === selectedIndex
                ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            >
              <span className="font-medium">{code.kod}</span>
              <span className="block text-xs text-gray-600 dark:text-gray-400">{code.nev}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
