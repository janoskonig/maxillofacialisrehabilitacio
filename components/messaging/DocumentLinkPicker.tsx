'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, Search, X } from 'lucide-react';
import { MobileBottomSheet } from '@/components/mobile/MobileBottomSheet';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import {
  buildDocumentLinkMarker,
  type DocumentLinkChatType,
} from '@/lib/messaging/document-link-marker';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

interface PatientOption {
  id: string;
  nev: string | null;
}

export interface PatientDocumentRow {
  id: string;
  patientId?: string;
  filename: string;
  fileSize: number;
  mimeType: string | null;
  tags: string[];
  uploadedAt: string;
  uploadedByName?: string | null;
}

interface DocumentLinkPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Kiválasztott dokumentum marker beszúrása (nem küldi automatikusan). */
  onSelect: (marker: string) => void;
  patientId?: string | null;
  chatType: DocumentLinkChatType;
  /** Beteg portál: saját dokumentumlista API. */
  portalMode?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function docIcon(mimeType: string | null) {
  if (mimeType?.startsWith('image/')) return ImageIcon;
  return FileText;
}

export function DocumentLinkPicker({
  isOpen,
  onClose,
  onSelect,
  patientId,
  chatType,
  portalMode = false,
}: DocumentLinkPickerProps) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  const [documents, setDocuments] = useState<PatientDocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    patientId ?? null,
  );

  const needsPatientSelection =
    chatType === 'doctor-doctor' && !patientId && !portalMode;

  const effectivePatientId = patientId ?? selectedPatientId;

  const loadDocuments = useCallback(async () => {
    if (!portalMode && !effectivePatientId) return;
    setLoading(true);
    setError(null);
    try {
      const url = portalMode
        ? '/api/patient-portal/documents'
        : `/api/patients/${effectivePatientId}/documents`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Dokumentumok betöltése sikertelen');
      }
      const data = await response.json();
      setDocuments(data.documents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [effectivePatientId, portalMode]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }
    setSelectedPatientId(patientId ?? null);
    if (portalMode || effectivePatientId) {
      void loadDocuments();
    }
  }, [isOpen, patientId, effectivePatientId, portalMode, loadDocuments]);

  useEffect(() => {
    if (!isOpen || !needsPatientSelection) return;
    setLoadingPatients(true);
    fetch('/api/patients?limit=200', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Beteglista hiba'))))
      .then((data) => setPatients(data.patients ?? []))
      .catch(() => setPatients([]))
      .finally(() => setLoadingPatients(false));
  }, [isOpen, needsPatientSelection]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => {
      const tagStr = (d.tags ?? []).join(' ').toLowerCase();
      return (
        d.filename.toLowerCase().includes(q) ||
        tagStr.includes(q) ||
        (d.uploadedByName ?? '').toLowerCase().includes(q)
      );
    });
  }, [documents, query]);

  const handlePick = (doc: PatientDocumentRow) => {
    const pid = effectivePatientId ?? doc.patientId;
    if (!pid) return;
    const tag = doc.tags?.[0] ?? '';
    const marker = buildDocumentLinkMarker({
      tag,
      patientId: pid,
      documentId: doc.id,
      chatType,
    });
    onSelect(marker);
    onClose();
  };

  const body = (
    <div className="flex flex-col gap-3 min-h-0">
      {needsPatientSelection && (
        <div>
          <label className="form-label block mb-1">Beteg</label>
          {loadingPatients ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Betöltés…
            </div>
          ) : (
            <select
              className="form-input w-full"
              value={selectedPatientId ?? ''}
              onChange={(e) => {
                setSelectedPatientId(e.target.value || null);
                setDocuments([]);
              }}
            >
              <option value="">Válasszon beteget…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nev || p.id}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {(portalMode || effectivePatientId) && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              className="form-input w-full pl-9"
              placeholder="Keresés fájlnév vagy címke szerint…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-8 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 py-4">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              {documents.length === 0
                ? 'Nincs feltöltött dokumentum ehhez a beteghez.'
                : 'Nincs találat a keresésre.'}
            </p>
          ) : (
            <ul className="overflow-y-auto max-h-[50vh] sm:max-h-[360px] divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {filtered.map((doc) => {
                const Icon = docIcon(doc.mimeType);
                const uploadedAt = doc.uploadedAt
                  ? format(new Date(doc.uploadedAt), 'yyyy. MM. dd.', { locale: hu })
                  : '';
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(doc)}
                      className="w-full text-left px-3 py-3 hover:bg-blue-50 transition-colors flex gap-3 items-start"
                    >
                      <Icon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">
                          {doc.filename}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                          <span>{formatFileSize(doc.fileSize)}</span>
                          {doc.tags?.length > 0 && (
                            <span>{doc.tags.join(', ')}</span>
                          )}
                          {uploadedAt && <span>{uploadedAt}</span>}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {!effectivePatientId && !needsPatientSelection && (
        <p className="text-sm text-gray-500 py-4">Beteg azonosító hiányzik.</p>
      )}
    </div>
  );

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <MobileBottomSheet open={isOpen} onOpenChange={(open) => !open && onClose()} title="Dokumentum linkelése">
        {body}
      </MobileBottomSheet>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-link-picker-title"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 id="document-link-picker-title" className="text-lg font-semibold text-gray-900">
            Dokumentum linkelése
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100"
            aria-label="Bezárás"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-hidden flex flex-col min-h-0">{body}</div>
      </div>
    </div>
  );
}
