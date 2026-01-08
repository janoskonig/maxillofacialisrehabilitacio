'use client';

import { useState, useEffect, useRef } from 'react';
import { PatientMention as PatientMentionType } from '@/lib/types';

interface PatientMentionProps {
  text: string;
  cursorPosition: number;
  onSelect: (mentionFormat: string, patientName: string) => void;
}

/**
 * Autocomplete component for patient mentions in message input
 * Shows suggestions when user types @ followed by patient name
 */
export function PatientMention({ text, cursorPosition, onSelect }: PatientMentionProps) {
  const [suggestions, setSuggestions] = useState<PatientMentionType[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Find @ mention in text at cursor position
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex === -1) {
      setShowSuggestions(false);
      setMentionStart(null);
      setMentionQuery('');
      return;
    }

    // Check if there's a space after @ (mention ended)
    const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
    if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
      setShowSuggestions(false);
      setMentionStart(null);
      setMentionQuery('');
      return;
    }

    // Extract query (text after @)
    const query = textAfterAt.toLowerCase().trim();
    
    setMentionStart(lastAtIndex);
    setMentionQuery(query);

    // Fetch suggestions if query is not empty
    if (query.length > 0) {
      fetchSuggestions(query);
      setShowSuggestions(true);
    } else {
      // Show all patients if just @ is typed
      fetchSuggestions('');
      setShowSuggestions(true);
    }
  }, [text, cursorPosition]);

  const fetchSuggestions = async (query: string) => {
    try {
      const response = await fetch(
        `/api/patients?forMention=true${query ? `&q=${encodeURIComponent(query)}` : ''}`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch patients');
      }

      const data = await response.json();
      setSuggestions(data.patients || []);
      setSelectedIndex(0);
    } catch (error) {
      console.error('Error fetching patient suggestions:', error);
      setSuggestions([]);
    }
  };

  const handleSelect = (patient: PatientMentionType) => {
    if (mentionStart === null) return;

    // Replace @query with @mentionFormat
    const textBefore = text.substring(0, mentionStart);
    const textAfter = text.substring(cursorPosition);
    const newText = `${textBefore}${patient.mentionFormat} ${textAfter}`;

    // Calculate new cursor position
    const newCursorPosition = mentionStart + patient.mentionFormat.length + 1;

    onSelect(patient.mentionFormat, patient.nev);
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
    }
  };

  // Expose handleKeyDown for parent component
  useEffect(() => {
    // This will be called by parent component
    if (showSuggestions) {
      // Scroll selected item into view
      if (suggestionsRef.current) {
        const selectedElement = suggestionsRef.current.children[selectedIndex] as HTMLElement;
        if (selectedElement) {
          selectedElement.scrollIntoView({ block: 'nearest' });
        }
      }
    }
  }, [selectedIndex, showSuggestions, suggestions.length]);

  if (!showSuggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={suggestionsRef}
      className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
      style={{
        bottom: '100%',
        left: 0,
        marginBottom: '4px',
        minWidth: '200px',
      }}
    >
      {suggestions.map((patient, index) => (
        <div
          key={patient.id}
          onClick={() => handleSelect(patient)}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`px-3 py-2 cursor-pointer ${
            index === selectedIndex
              ? 'bg-blue-100 text-blue-900'
              : 'hover:bg-gray-50 text-gray-900'
          }`}
        >
          <div className="font-medium">{patient.nev}</div>
          <div className="text-xs text-gray-500">{patient.mentionFormat}</div>
        </div>
      ))}
    </div>
  );
}

// Export hook for parent component to handle keyboard events
export function usePatientMentionKeyboard(
  showSuggestions: boolean,
  onKeyDown: (e: React.KeyboardEvent) => void
) {
  useEffect(() => {
    if (!showSuggestions) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        onKeyDown(e as unknown as React.KeyboardEvent);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSuggestions, onKeyDown]);
}

