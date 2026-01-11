'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, User, Upload } from 'lucide-react';
import { DocumentRequestModal } from './DocumentRequestModal';
import { DocumentRequestInfo } from '@/lib/document-request-detector';

interface DocumentRequestInfoCardProps {
  documentRequest: DocumentRequestInfo;
  messageId: string;
  patientId?: string | null;
  chatType: 'patient-doctor' | 'doctor-doctor' | 'doctor-view-patient';
  isRecipient: boolean; // Whether current user is the recipient
  onSendMessage?: (messageText: string) => Promise<void>;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  'op': 'OP (máshol készített)',
  'foto': 'Önarckép',
  'zarojelentes': 'Zárójelentés',
  'ambulans lap': 'Ambuláns lap',
  '': 'Általános dokumentum',
};

/**
 * Convert mention format to display name
 * @kovacs+janos -> Kovács János (capitalize first letter of each word)
 * Note: This won't have accents, but it's better than showing @kovacs+janos
 */
function formatMentionAsName(mention: string): string {
  if (!mention || !mention.startsWith('@')) {
    return mention;
  }
  
  const withoutAt = mention.substring(1); // kovacs+janos
  const parts = withoutAt.split('+');
  
  return parts
    .map(part => {
      if (part.length === 0) return '';
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

export function DocumentRequestInfoCard({
  documentRequest,
  messageId,
  patientId,
  chatType,
  isRecipient,
  onSendMessage,
}: DocumentRequestInfoCardProps) {
  const [resolvedPatientId, setResolvedPatientId] = useState<string | null>(patientId || null);
  const [resolvedPatientName, setResolvedPatientName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // If we have a patient mention, try to resolve it to patient ID and name
    if (documentRequest.patientMention && !resolvedPatientId) {
      setLoading(true);
      const mentionWithoutAt = documentRequest.patientMention.substring(1); // kovacs+janos
      
      const findPatient = async () => {
        try {
          const response = await fetch(`/api/patients?forMention=true&q=${encodeURIComponent(mentionWithoutAt)}`, {
            credentials: 'include',
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.patients && data.patients.length > 0) {
              const match = data.patients.find(
                (p: any) => p.mentionFormat?.toLowerCase() === documentRequest.patientMention?.toLowerCase()
              );
              if (match) {
                setResolvedPatientId(match.id);
                setResolvedPatientName(match.nev);
              }
            }
          }
        } catch (error) {
          console.error('Error fetching patient for mention:', error);
        } finally {
          setLoading(false);
        }
      };
      
      findPatient();
    } else if (patientId && !resolvedPatientName) {
      // Fetch patient name if we have patientId but not name
      setLoading(true);
      const fetchPatientName = async () => {
        try {
          const response = await fetch(`/api/patients/${patientId}`, {
            credentials: 'include',
          });
          
          if (response.ok) {
            const data = await response.json();
            setResolvedPatientName(data.patient?.nev || null);
          }
        } catch (error) {
          console.error('Error fetching patient name:', error);
        } finally {
          setLoading(false);
        }
      };
      
      fetchPatientName();
    }
  }, [documentRequest.patientMention, patientId, resolvedPatientId]);

  const handleUploaded = async (messageText: string) => {
    // Send the message if callback provided
    if (onSendMessage) {
      try {
        await onSendMessage(messageText);
      } catch (error) {
        console.error('Hiba az üzenet küldésekor:', error);
        return; // Don't close modal if sending failed
      }
    }
    
    // Close modal
    setShowModal(false);
  };

  const documentTypeLabel = DOCUMENT_TYPE_LABELS[documentRequest.tag || ''] || 'Dokumentum';
  
  // Determine display name: prefer resolved name, then formatted mention, then patientName
  let displayPatientName: string | null = null;
  if (resolvedPatientName) {
    displayPatientName = resolvedPatientName;
  } else if (documentRequest.patientMention) {
    displayPatientName = formatMentionAsName(documentRequest.patientMention);
  } else if (documentRequest.patientName) {
    displayPatientName = documentRequest.patientName;
  }

  return (
    <>
      <div 
        className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 my-2 cursor-pointer hover:bg-amber-100 transition-colors"
        onClick={() => setShowModal(true)}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-200 rounded-lg text-amber-700 flex-shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-amber-900 text-sm mb-2">
              Dokumentum kérés
            </div>
            
            <div className="space-y-1.5 mb-3">
              <div className="text-xs text-amber-800 font-medium">
                <span className="font-semibold">Típus:</span> {documentTypeLabel}
              </div>
              
              {loading ? (
                <div className="text-xs text-amber-700">
                  <span className="font-semibold">Beteg:</span> Betöltés...
                </div>
              ) : displayPatientName ? (
                <div className="text-xs text-amber-800">
                  <span className="font-semibold">Beteg:</span> {displayPatientName}
                </div>
              ) : null}
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-200 hover:bg-amber-300 text-amber-900 rounded-lg border border-amber-300 transition-colors text-sm font-medium">
              <Upload className="w-4 h-4" />
              Feltöltés
            </div>
          </div>
        </div>
      </div>

      <DocumentRequestModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onDocumentUploaded={handleUploaded}
        patientId={resolvedPatientId || undefined}
        chatType={chatType}
        selectedPatientId={resolvedPatientId || undefined}
        requestedTag={documentRequest.tag || ''}
        requestedPatientId={resolvedPatientId || undefined}
        messageId={messageId}
      />
    </>
  );
}
