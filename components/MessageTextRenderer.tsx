'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DocumentRequestCard } from './DocumentRequestCard';
import { DocumentUploadButton } from './DocumentUploadButton';
import { DocumentRequestInfoCard } from './DocumentRequestInfoCard';
import { ConsiliumPrepMessageCard } from './ConsiliumPrepMessageCard';
import { detectDocumentRequest } from '@/lib/document-request-detector';
import { parseDocumentLinkMarker } from '@/lib/messaging/document-link-marker';
import { stripDocumentMarkerIfContextLinked } from '@/lib/messaging/strip-duplicate-document-marker';
import type { MessageContextLink } from '@/lib/types/messaging';

interface MessageTextRendererProps {
  text: string;
  chatType?: 'patient-doctor' | 'doctor-doctor' | 'doctor-view-patient';
  patientId?: string | null;
  messageId?: string; // Message ID for upload button
  senderId?: string; // Sender ID to check if current user is recipient
  currentUserId?: string | null; // Current user ID
  onSendMessage?: (messageText: string) => Promise<void>; // Function to send message
  /** Fázis 2.1: ha van strukturált dokumentum-link, a marker ne duplikáljon. */
  contextLinks?: MessageContextLink[] | null;
}

/**
 * Render message text with @mention support, document request cards, and upload buttons
 * Mentions are in format: @vezeteknev+keresztnev
 * Document uploads are in format: [DOCUMENT_UPLOADED:tag:patientId?:documentId]
 * Consilium prep links are in format: [CONSILIUM_PREP:<token>]
 * Document requests are detected from text and show upload button for recipients
 */
export function MessageTextRenderer({ 
  text, 
  chatType = 'patient-doctor', 
  patientId,
  messageId,
  senderId,
  currentUserId,
  onSendMessage,
  contextLinks,
}: MessageTextRendererProps) {
  const displayText = stripDocumentMarkerIfContextLinked(text, contextLinks);
  const lines = (displayText || '').split(/\r?\n/);
  const trailingNote = lines.slice(1).join('\n').trim();

  // Check for Konzílium előkészítő marker: [CONSILIUM_PREP:<token>]
  // Token is base64url (A-Za-z0-9_-), so the regex is safe and unambiguous.
  const consiliumPrepRegex = /\[CONSILIUM_PREP:([A-Za-z0-9_-]+)\]/;
  const consiliumPrepMatch = (displayText || '').match(consiliumPrepRegex);
  if (consiliumPrepMatch && typeof consiliumPrepMatch.index === 'number') {
    const token = consiliumPrepMatch[1];
    const before = (displayText || '').slice(0, consiliumPrepMatch.index).trim();
    const after = (displayText || '').slice(consiliumPrepMatch.index + consiliumPrepMatch[0].length).trim();
    return (
      <>
        {before ? (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm">{before}</p>
        ) : null}
        <ConsiliumPrepMessageCard token={token} />
        {after ? (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm mt-1 opacity-90">{after}</p>
        ) : null}
      </>
    );
  }

  const markerStart = (displayText || '').indexOf('[DOCUMENT_UPLOADED:');
  if (markerStart !== -1) {
    const markerEnd = (displayText || '').indexOf(']', markerStart);
    if (markerEnd !== -1) {
      const markerText = (displayText || '').slice(markerStart, markerEnd + 1);
      const documentLink = parseDocumentLinkMarker(markerText);
      if (documentLink) {
        const before = (displayText || '').slice(0, markerStart).trim();
        const after = (displayText || '').slice(markerEnd + 1).trim();
        return (
          <>
            {before ? (
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm mb-2">
                {before}
              </p>
            ) : null}
            <DocumentRequestCard
              tag={documentLink.tag}
              patientId={documentLink.patientId || patientId || undefined}
              documentId={documentLink.documentId}
              chatType={chatType}
            />
            {after ? (
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm mt-2 opacity-90">
                {after}
              </p>
            ) : null}
          </>
        );
      }
    }
  }

  // Check for document request in text
  const isRecipient = senderId && currentUserId && senderId !== currentUserId;
  const documentRequest = detectDocumentRequest(text);
  
  // If document request detected, show info card for both sender and recipient
  if (documentRequest.isDocumentRequest && messageId) {
    return (
      <>
        <DocumentRequestInfoCard
          documentRequest={documentRequest}
          messageId={messageId}
          patientId={patientId}
          chatType={chatType}
          isRecipient={isRecipient || false}
          onSendMessage={onSendMessage}
        />

        {trailingNote ? (
          <div className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm opacity-90">
            {trailingNote}
          </div>
        ) : null}
      </>
    );
  }

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
    return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</span>;
  }

  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
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
    const mentionWithoutAt = mentionFormat.substring(1); // kovacs+janos
    
    const findPatient = async () => {
      try {
        const response = await fetch(`/api/patients?forMention=true&q=${encodeURIComponent(mentionWithoutAt)}`, {
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch patients');
        }
        
        const data = await response.json();
        
        if (data.patients && data.patients.length > 0) {
          const match = data.patients.find(
            (p: any) => p.mentionFormat?.toLowerCase() === mentionFormat.toLowerCase()
          ) || (data.patients.length === 1 ? data.patients[0] : null);
          
          if (match) {
            setPatientId(match.id);
            setPatientName(match.nev);
          } else {
            console.warn('Patient not found for mention:', mentionFormat);
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
      <span className="inline-block px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 rounded font-medium">
        {displayText}
      </span>
    );
  }

  if (!patientId) {
    // Patient not found - show as plain text (not clickable)
    return (
      <span 
        className="inline-block px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded font-medium"
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
      className="inline-block px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 rounded font-medium hover:bg-blue-200 transition-colors cursor-pointer"
      title={patientName || displayText}
    >
      {patientName || displayText}
    </Link>
  );
}


