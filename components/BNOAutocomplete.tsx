'use client';

import { useState, useEffect, useRef } from 'react';
import bnoCodes from '@/lib/bno-codes.json';

interface BNOCode {
  kod: string;
  nev: string;
}

interface BNOAutocompleteProps {
  value: string;
  onChange: (kod: string, nev: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

// Normalizálja a BNO kódot: ha kevesebb mint 5 karakter, akkor 0-kkal pótoljuk ki
function normalizeBNOCode(kod: string): string {
  if (!kod) return '';
  
  // Ha már 5 karakter vagy több, visszaadjuk
  if (kod.length >= 5) {
    return kod.substring(0, 5).toUpperCase();
  }
  
  // Ha kevesebb mint 5 karakter, 0-kkal pótoljuk ki
  const padded = kod.toUpperCase().padEnd(5, '0');
  return padded;
}

export function BNOAutocomplete({
  value,
  onChange,
  placeholder = 'Kezdjen el gépelni a BNO kód vagy név alapján...',
  className = 'form-input',
  readOnly = false,
  disabled = false,
}: BNOAutocompleteProps) {
  const [searchTerm, setSearchTerm] = useState(value || '');
  const [filteredCodes, setFilteredCodes] = useState<BNOCode[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const lastSelectedKodRef = useRef<string>('');

  // Szűrés a keresési kifejezés alapján
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredCodes([]);
      setShowDropdown(false);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = (bnoCodes as BNOCode[])
      .filter(code => {
        const kodMatch = code.kod.toLowerCase().includes(term);
        const nevMatch = code.nev.toLowerCase().includes(term);
        return kodMatch || nevMatch;
      })
      .slice(0, 15); // Maximum 15 eredmény

    setFilteredCodes(filtered);
    setShowDropdown(filtered.length > 0);
    setSelectedIndex(-1);
  }, [searchTerm]);

  // Input érték szinkronizálása a value prop-pal
  // A BNO mezőben csak a kód jelenik meg
  useEffect(() => {
    // Ha éppen kiválasztás történt, ne módosítsuk a searchTerm-et
    if (isSelectingRef.current) {
      return;
    }
    
    // Ha van kiválasztott kód, ne módosítsuk a searchTerm-et, hacsak nem változott explicit módon
    if (lastSelectedKodRef.current) {
      // Ha a value megegyezik a kiválasztott kóddal, ne csináljunk semmit
      if (lastSelectedKodRef.current === value) {
        return;
      }
      // Ha a value üres lett, de van kiválasztott kód, ne töröljük
      if (!value || value === '') {
        return;
      }
    }
    
    // Ha a value üres és van searchTerm, csak akkor töröljük, ha nem volt kiválasztás
    if ((!value || value === '') && searchTerm !== '' && !lastSelectedKodRef.current) {
      setSearchTerm('');
      return;
    }
    
    // Ha a value változott és nem üres, és nem egyezik a searchTerm-mel
    // Csak akkor frissítjük, ha nem egyezik a kiválasztott kóddal
    if (value && value !== searchTerm && value !== lastSelectedKodRef.current) {
      setSearchTerm(value);
      // Ha a value külsőleg változott (pl. form reset), töröljük a ref-et
      if (!lastSelectedKodRef.current || lastSelectedKodRef.current !== value) {
        lastSelectedKodRef.current = '';
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Kiválasztás kezelése
  const handleSelect = (code: BNOCode) => {
    isSelectingRef.current = true;
    // Csak a kódot jelenítjük meg a mezőben
    // Ha a kód kevesebb mint 5 karakter, normalizáljuk
    let finalKod = code.kod;
    if (code.kod.length < 5) {
      finalKod = normalizeBNOCode(code.kod);
    }
    
    // Mentjük az utolsó kiválasztott kódot ELŐSZÖR
    lastSelectedKodRef.current = finalKod;
    
    // Először beállítjuk a searchTerm-et
    setSearchTerm(finalKod);
    
    // Utána hívjuk meg az onChange-t
    onChange(finalKod, code.nev);
    
    setShowDropdown(false);
    setSelectedIndex(-1);
    
    // Ne hívjuk meg a blur-t, csak jelöljük meg, hogy kiválasztás történt
    // A blur csak akkor fut le, ha a felhasználó máshova kattint
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 1000); // Hosszabb timeout, hogy biztosan ne törölje
  };

  // Input változás kezelése
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);
    // Ha a felhasználó gépel, töröljük az utolsó kiválasztott kódot
    lastSelectedKodRef.current = '';
    if (newValue.trim() === '') {
      onChange('', '');
    }
  };

  // Blur kezelése - ha érvényes BNO kódot tartalmaz, beállítjuk a diagnózist is
  const handleBlur = () => {
    if (isSelectingRef.current) {
      return;
    }
    
    // Ha már van kiválasztott kód, ne futtassuk le a blur logikát
    if (lastSelectedKodRef.current && searchTerm === lastSelectedKodRef.current) {
      setShowDropdown(false);
      setSelectedIndex(-1);
      return;
    }
    
    setTimeout(() => {
      if (document.activeElement !== inputRef.current && !isSelectingRef.current) {
        const trimmedValue = searchTerm.trim().toUpperCase();
        
        // Ha már van kiválasztott kód és az megegyezik a searchTerm-mel, ne csináljunk semmit
        if (lastSelectedKodRef.current && trimmedValue === lastSelectedKodRef.current.toUpperCase()) {
          setShowDropdown(false);
          setSelectedIndex(-1);
          return;
        }
        
        if (trimmedValue) {
          // Először próbáljuk meg pontos egyezést találni
          let foundCode = (bnoCodes as BNOCode[]).find(code => 
            code.kod.toUpperCase() === trimmedValue
          );
          
          // Ha nem találunk pontos egyezést és a kód kevesebb mint 5 karakter,
          // akkor normalizáljuk és újra keresünk
          if (!foundCode && trimmedValue.length < 5) {
            const normalizedKod = normalizeBNOCode(trimmedValue);
            foundCode = (bnoCodes as BNOCode[]).find(code => 
              code.kod.toUpperCase() === normalizedKod
            );
            
            if (foundCode) {
              setSearchTerm(normalizedKod);
              lastSelectedKodRef.current = normalizedKod;
              onChange(normalizedKod, foundCode.nev);
            } else {
              // Ha még mindig nem található, próbáljuk meg prefix kereséssel
              const prefixMatch = (bnoCodes as BNOCode[]).find(code => 
                code.kod.toUpperCase().startsWith(trimmedValue)
              );
              
              if (prefixMatch) {
                setSearchTerm(prefixMatch.kod);
                lastSelectedKodRef.current = prefixMatch.kod;
                onChange(prefixMatch.kod, prefixMatch.nev);
              } else {
                // Ha nem található és nincs kiválasztott kód, töröljük
                if (!lastSelectedKodRef.current) {
                  setSearchTerm('');
                  onChange('', '');
                }
              }
            }
          } else if (foundCode) {
            // Ha találtunk pontos egyezést
            setSearchTerm(foundCode.kod);
            lastSelectedKodRef.current = foundCode.kod;
            onChange(foundCode.kod, foundCode.nev);
          } else {
            // Ha nem található és nincs kiválasztott kód, töröljük
            if (!lastSelectedKodRef.current) {
              setSearchTerm('');
              onChange('', '');
            }
          }
        } else {
          // Ha üres és nincs kiválasztott kód, töröljük az értékeket
          if (!lastSelectedKodRef.current) {
            onChange('', '');
          }
        }
        setShowDropdown(false);
        setSelectedIndex(-1);
      }
    }, 200);
  };

  // Fókusz kezelése
  const handleFocus = () => {
    if (searchTerm.trim() !== '' && filteredCodes.length > 0) {
      setShowDropdown(true);
    }
  };

  // Billentyűzet navigáció
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (readOnly || disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (showDropdown && filteredCodes.length > 0) {
        setSelectedIndex(prev => 
          prev < filteredCodes.length - 1 ? prev + 1 : prev
        );
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showDropdown) {
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showDropdown && selectedIndex >= 0 && selectedIndex < filteredCodes.length) {
        handleSelect(filteredCodes[selectedIndex]);
      } else {
        // Ha nincs kiválasztott elem, próbáljuk meg a blur logikát futtatni
        handleBlur();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSelectedIndex(-1);
      if (inputRef.current) {
        inputRef.current.blur();
      }
    }
  };

  // Kattintás kezelése a dropdown-on kívül
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Scroll a kiválasztott elemhez
  useEffect(() => {
    if (selectedIndex >= 0 && dropdownRef.current) {
      const selectedElement = dropdownRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={searchTerm}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        readOnly={readOnly}
        disabled={disabled}
        autoComplete="off"
        maxLength={5}
      />
      {showDropdown && filteredCodes.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {filteredCodes.map((code, index) => (
            <div
              key={`${code.kod}-${index}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(code);
              }}
              className={`px-4 py-2 cursor-pointer text-sm border-b border-gray-100 last:border-b-0 ${
                index === selectedIndex
                  ? 'bg-blue-100 text-blue-900'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="font-medium">{code.kod}</div>
              <div className="text-xs text-gray-600">{code.nev}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
