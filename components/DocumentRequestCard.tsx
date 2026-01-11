'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, Image as ImageIcon, Download, ExternalLink } from 'lucide-react';

interface Document {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string | null;
  description: string | null;
  tags: string[];
  uploadedAt: string;
  uploadedByName?: string | null;
}

interface DocumentRequestCardProps {
  tag?: string;
  patientId?: string;
  documentId: string;
  chatType: 'patient-doctor' | 'doctor-doctor' | 'doctor-view-patient';
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  'op': 'OP (máshol készített)',
  'foto': 'Önarckép',
  'zarojelentes': 'Zárójelentés',
  'ambulans lap': 'Ambuláns lap',
  '': 'Általános dokumentum',
};

export function DocumentRequestCard({
  tag,
  patientId,
  documentId,
  chatType,
}: DocumentRequestCardProps) {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [patientName, setPatientName] = useState<string | null>(null);

  useEffect(() => {
    fetchDocument();
    if (patientId) {
      fetchPatientName();
    }
  }, [documentId, patientId]);

  const fetchDocument = async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Dokumentum nem található');
      }

      const data = await response.json();
      setDocument(data.document);
    } catch (error) {
      console.error('Hiba a dokumentum betöltésekor:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPatientName = async () => {
    if (!patientId) return;
    try {
      const response = await fetch(`/api/patients/${patientId}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setPatientName(data.patient?.nev || null);
      }
    } catch (error) {
      console.error('Hiba a beteg nevének betöltésekor:', error);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getDocumentLink = (): string => {
    if (chatType === 'patient-doctor') {
      return '/patient-portal/documents';
    }
    if (patientId) {
      return `/patients/${patientId}/view`;
    }
    return '/patients';
  };

  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 my-2">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-600">Dokumentum betöltése...</span>
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 my-2">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-gray-400" />
          <span className="text-sm text-gray-600">Dokumentum nem található</span>
        </div>
      </div>
    );
  }

  const documentTypeLabel = DOCUMENT_TYPE_LABELS[tag || ''] || 'Dokumentum';
  const isImage = document.mimeType?.startsWith('image/');
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 my-2 hover:bg-blue-100 transition-colors">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-200 rounded-lg text-blue-700 flex-shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-blue-900 text-sm mb-1">
                Dokumentum feltöltve
              </div>
              <div className="text-xs text-blue-700 font-medium mb-1">
                {documentTypeLabel}
              </div>
              {patientName && (
                <div className="text-xs text-blue-600 mb-1">
                  Beteg: {patientName}
                </div>
              )}
              <div className="text-xs text-blue-600 truncate" title={document.filename}>
                {document.filename}
              </div>
              {document.description && (
                <div className="text-xs text-blue-600 mt-1 line-clamp-2">
                  {document.description}
                </div>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs text-blue-600">
                <span>{formatFileSize(document.fileSize)}</span>
                {document.uploadedByName && (
                  <>
                    <span>•</span>
                    <span>Feltöltötte: {document.uploadedByName}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <Link
            href={getDocumentLink()}
            className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-blue-700 hover:text-blue-900 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Dokumentumok megtekintése
          </Link>
        </div>
      </div>
    </div>
  );
}
