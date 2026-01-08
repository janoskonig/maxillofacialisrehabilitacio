'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface MessageTextRendererProps {
  text: string;
}

/**
 * Render message text with @mention support
 * Mentions are in format: @vezeteknev+keresztnev
 * They are rendered as clickable links to /patients/[id]/view
 */
export function MessageTextRenderer({ text }: MessageTextRendererProps) {
  // Regex to match @mentions: @word+word (e.g., @kovacs+janos)
  const mentionRegex = /@([a-z0-9+]+)/gi;
  
  // Split text by mentions and render each part
  const parts: Array<{ type: 'text' | 'mention'; content: string; mentionFormat?: string }> = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex, match.index),
      });
    }

    // Add mention
    const mentionFormat = match[0]; // @kovacs+janos
    parts.push({
      type: 'mention',
      content: mentionFormat,
      mentionFormat: mentionFormat,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.substring(lastIndex),
    });
  }

  // If no mentions found, just return the text
  if (parts.length === 0) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={index}>{part.content}</span>;
        } else {
          // Mention - we need to find the patient ID from the mention format
          // For now, we'll render it as a styled link, but the actual patient ID lookup
          // will be done in the parent component or via a separate API call
          // The mention format is @vezeteknev+keresztnev, we need to search for the patient
          return (
            <MentionLink
              key={index}
              mentionFormat={part.mentionFormat!}
              displayText={part.content}
            />
          );
        }
      })}
    </span>
  );
}

interface MentionLinkProps {
  mentionFormat: string; // @kovacs+janos
  displayText: string;
}

/**
 * Component that renders a mention as a clickable link
 * It needs to fetch the patient ID from the mention format
 */
function MentionLink({ mentionFormat, displayText }: MentionLinkProps) {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Extract mention format without @
    const mentionWithoutAt = mentionFormat.substring(1); // kovacs+janos
    
    const findPatient = async () => {
      try {
        // First try with query parameter for better performance
        const searchResponse = await fetch(`/api/patients?forMention=true&q=${encodeURIComponent(mentionWithoutAt)}`, {
          credentials: 'include',
        });
        
        if (!searchResponse.ok) {
          throw new Error('Failed to fetch patients');
        }
        
        const searchData = await searchResponse.json();
        
        if (searchData.patients && searchData.patients.length > 0) {
          // Find exact match by mentionFormat (case insensitive)
          let match = searchData.patients.find(
            (p: any) => p.mentionFormat?.toLowerCase() === mentionFormat.toLowerCase()
          );
          
          // If no exact match but only one result, use it (API already filtered)
          if (!match && searchData.patients.length === 1) {
            match = searchData.patients[0];
          }
          
          // If still no match, try fetching all patients and search there
          if (!match) {
            const allResponse = await fetch(`/api/patients?forMention=true`, {
              credentials: 'include',
            });
            
            if (allResponse.ok) {
              const allData = await allResponse.json();
              if (allData.patients && allData.patients.length > 0) {
                match = allData.patients.find(
                  (p: any) => p.mentionFormat?.toLowerCase() === mentionFormat.toLowerCase()
                );
              }
            }
          }
          
          if (match) {
            setPatientId(match.id);
            setPatientName(match.nev);
          } else {
            console.warn('Patient not found for mention:', mentionFormat);
          }
        } else {
          // No results from search, try fetching all patients
          const allResponse = await fetch(`/api/patients?forMention=true`, {
            credentials: 'include',
          });
          
          if (allResponse.ok) {
            const allData = await allResponse.json();
            if (allData.patients && allData.patients.length > 0) {
              const match = allData.patients.find(
                (p: any) => p.mentionFormat?.toLowerCase() === mentionFormat.toLowerCase()
              );
              
              if (match) {
                setPatientId(match.id);
                setPatientName(match.nev);
              } else {
                console.warn('Patient not found for mention:', mentionFormat);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error fetching patient for mention:', err);
      } finally {
        setLoading(false);
      }
    };
    
    findPatient();
  }, [mentionFormat]);

  if (loading) {
    // Show mention as plain text while loading
    return (
      <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-medium">
        {displayText}
      </span>
    );
  }

  if (!patientId) {
    // Patient not found - show as plain text (not clickable)
    return (
      <span 
        className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium"
        title="Beteg nem található"
      >
        {displayText}
      </span>
    );
  }

  // Patient found - show as clickable link
  return (
    <Link
      href={`/patients/${patientId}/view`}
      className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-medium hover:bg-blue-200 transition-colors cursor-pointer"
      title={patientName || displayText}
    >
      {patientName || displayText}
    </Link>
  );
}

