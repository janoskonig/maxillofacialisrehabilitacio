'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Plus, Tag as TagIcon } from 'lucide-react';

interface TagSelectorProps {
  selectedTags: string[];
  availableTags: string[];
  onTagsChange: (tags: string[]) => void;
  allowCreate?: boolean;
  maxTagLength?: number;
  placeholder?: string;
  quickTags?: string[];
}

// Tag normalization function
function normalizeTag(tag: string): string {
  // 1. Trim whitespace
  let normalized = tag.trim();
  
  // 2. Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');
  
  return normalized;
}

// Find canonical tag from available tags (case-insensitive)
function findCanonicalTag(tag: string, availableTags: string[]): string | null {
  const normalized = normalizeTag(tag).toLowerCase();
  const canonical = availableTags.find(
    at => normalizeTag(at).toLowerCase() === normalized
  );
  return canonical || null;
}

// Validate tag
function validateTag(tag: string, maxLength: number = 50): { valid: boolean; error?: string } {
  const trimmed = normalizeTag(tag);
  
  // Whitespace check
  if (trimmed.length === 0) {
    return { valid: false, error: 'Tag nem lehet üres' };
  }
  
  // Length check
  if (trimmed.length > maxLength) {
    return { valid: false, error: `Tag túl hosszú (max ${maxLength} karakter)` };
  }
  
  // Character set check (betű/szám kell legyen benne)
  const hasLetterOrDigit = /[a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(trimmed);
  if (!hasLetterOrDigit) {
    return { valid: false, error: 'Tag tartalmaznia kell betűt vagy számot' };
  }
  
  return { valid: true };
}

export function TagSelector({
  selectedTags,
  availableTags,
  onTagsChange,
  allowCreate = true,
  maxTagLength = 50,
  placeholder = 'Keresés vagy új címke...',
  quickTags = [],
}: TagSelectorProps) {
  const [inputValue, setInputValue] = useState('');
  const [filteredTags, setFilteredTags] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [createOption, setCreateOption] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Filter tags based on input
  useEffect(() => {
    if (inputValue.trim() === '') {
      setFilteredTags([]);
      setShowSuggestions(false);
      setCreateOption(false);
      return;
    }

    const term = normalizeTag(inputValue).toLowerCase();
    const filtered = availableTags
      .filter(tag => {
        const normalized = normalizeTag(tag).toLowerCase();
        return normalized.includes(term) && 
               !selectedTags.some(st => normalizeTag(st).toLowerCase() === normalized);
      })
      .slice(0, 10);

    setFilteredTags(filtered);
    setShowSuggestions(filtered.length > 0 || (allowCreate && inputValue.trim().length > 0));
    
    // Show create option if no exact match found
    const hasExactMatch = filtered.some(tag => 
      normalizeTag(tag).toLowerCase() === term
    );
    setCreateOption(allowCreate && !hasExactMatch && inputValue.trim().length > 0);
    setSelectedIndex(-1);
  }, [inputValue, availableTags, selectedTags, allowCreate]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const addTag = (tagToAdd?: string) => {
    const tag = tagToAdd || inputValue.trim();
    if (!tag) return;

    // Normalize and find canonical form
    const normalized = normalizeTag(tag);
    const canonical = findCanonicalTag(normalized, availableTags);
    const finalTag = canonical || normalized;

    // Validate
    const validation = validateTag(finalTag, maxTagLength);
    if (!validation.valid) {
      // Could show error toast here
      console.warn('Tag validation error:', validation.error);
      return;
    }

    // Check for duplicates (case-insensitive)
    const isDuplicate = selectedTags.some(
      st => normalizeTag(st).toLowerCase() === normalizeTag(finalTag).toLowerCase()
    );
    
    if (isDuplicate) {
      return;
    }

    // Add tag
    onTagsChange([...selectedTags, finalTag]);
    setInputValue('');
    setShowSuggestions(false);
    setCreateOption(false);
  };

  const removeTag = (tagToRemove: string) => {
    onTagsChange(selectedTags.filter(tag => tag !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && filteredTags[selectedIndex]) {
        addTag(filteredTags[selectedIndex]);
      } else if (createOption && inputValue.trim()) {
        addTag();
      } else if (inputValue.trim()) {
        addTag();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const maxIndex = filteredTags.length + (createOption ? 1 : 0) - 1;
      setSelectedIndex(prev => (prev < maxIndex ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  const handleQuickTagClick = (tag: string) => {
    const normalized = normalizeTag(tag);
    const canonical = findCanonicalTag(normalized, availableTags);
    const finalTag = canonical || normalized;

    // Check for duplicates
    const isDuplicate = selectedTags.some(
      st => normalizeTag(st).toLowerCase() === normalizeTag(finalTag).toLowerCase()
    );
    
    if (!isDuplicate) {
      onTagsChange([...selectedTags, finalTag]);
    }
  };

  return (
    <div className="space-y-2">
      {/* Selected tags (chips) */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-medical-primary text-white"
            >
              <TagIcon className="w-3 h-3 mr-1" />
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-2 hover:text-gray-200 transition-colors"
                aria-label={`${tag} eltávolítása`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Quick tag buttons */}
      {quickTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickTags.map((tag) => {
            const normalized = normalizeTag(tag).toLowerCase();
            const isSelected = selectedTags.some(
              st => normalizeTag(st).toLowerCase() === normalized
            );
            return (
              <button
                key={tag}
                type="button"
                onClick={() => handleQuickTagClick(tag)}
                disabled={isSelected}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isSelected
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Input with suggestions */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (inputValue.trim() || availableTags.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              className="form-input w-full"
              placeholder={placeholder}
            />
            {showSuggestions && (filteredTags.length > 0 || createOption) && (
              <div
                ref={suggestionsRef}
                className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto"
              >
                {filteredTags.map((tag, index) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addTag(tag)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${
                      index === selectedIndex ? 'bg-gray-100' : ''
                    }`}
                  >
                    {tag}
                  </button>
                ))}
                {createOption && (
                  <button
                    type="button"
                    onClick={() => addTag()}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none text-medical-primary ${
                      selectedIndex === filteredTags.length ? 'bg-gray-100' : ''
                    }`}
                  >
                    <Plus className="w-3 h-3 inline mr-2" />
                    Létrehozás: "{inputValue.trim()}"
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => addTag()}
            className="btn-secondary"
            disabled={!inputValue.trim()}
            title="Címke hozzáadása"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
