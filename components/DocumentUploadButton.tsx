'use client';

import { useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { DocumentRequestModal } from './DocumentRequestModal';

interface DocumentUploadButtonProps {
  messageId: string;
  tag: string;
  patientId?: string | null;
  patientName?: string | null;
  chatType: 'patient-doctor' | 'doctor-doctor' | 'doctor-view-patient';
  onUploaded?: () => void; // Callback after successful upload
  onSendMessage?: (messageText: string) => Promise<void>; // Function to send message
}

export function DocumentUploadButton({
  messageId,
  tag,
  patientId,
  patientName,
  chatType,
  onUploaded,
  onSendMessage,
}: DocumentUploadButtonProps) {
  const [showModal, setShowModal] = useState(false);

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
    
    // Close modal and call callback
    setShowModal(false);
    if (onUploaded) {
      onUploaded();
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg border border-blue-200 transition-colors text-sm font-medium"
        title={`${tag ? `${tag} ` : ''}dokumentum feltöltése`}
      >
        <Upload className="w-4 h-4" />
        Feltöltés
      </button>

      <DocumentRequestModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onDocumentUploaded={handleUploaded}
        patientId={patientId || undefined}
        chatType={chatType}
        selectedPatientId={patientId || undefined}
        requestedTag={tag}
        requestedPatientId={patientId || undefined}
        messageId={messageId}
      />
    </>
  );
}
