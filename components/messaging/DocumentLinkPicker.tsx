'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { DocumentListThumbnail } from './DocumentListThumbnail';
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

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    patientId ?? null,
  );
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState<PatientOption[]>([]);
  const [loadingPatientSearch, setLoadingPatientSearch] = useState(false);

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
      setPatientSearchQuery('');
      setPatientSearchResults([]);
      return;
    }
    setSelectedPatientId(patientId ?? null);
    setSelectedPatientName(null);
  }, [isOpen, patientId]);

  useEffect(() => {
    if (!isOpen) return;
    if (portalMode || effectivePatientId) {
      void loadDocuments();
    }
  }, [isOpen, effectivePatientId, portalMode, loadDocuments]);

  useEffect(() => {
    if (!isOpen || !needsPatientSelection || selectedPatientId) {
      setPatientSearchResults([]);
      return;
    }
    const q = patientSearchQuery.trim();
    if (!q) {
      setPatientSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoadingPatientSearch(true);
      try {
        const res = await fetch(
          `/api/patients?q=${encodeURIComponent(q)}&limit=20`,
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error('Beteglista hiba');
        const data = await res.json();
        setPatientSearchResults(data.patients ?? []);
      } catch {
        setPatientSearchResults([]);
      } finally {
        setLoadingPatientSearch(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen, needsPatientSelection, patientSearchQuery, selectedPatientId]);

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
          {selectedPatientId ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="text-sm font-medium text-gray-900 truncate">
                {selectedPatientName || 'Kiválasztott beteg'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedPatientId(null);
                  setSelectedPatientName(null);
                  setDocuments([]);
                  setPatientSearchQuery('');
                }}
                className="text-sm text-blue-600 hover:text-blue-800 flex-shrink-0"
              >
                Módosítás
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="search"
                  className="form-input w-full pl-9"
                  placeholder="Beteg keresése név szerint…"
                  value={patientSearchQuery}
                  onChange={(e) => setPatientSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              {patientSearchQuery.trim() && (
                <div className="mt-1 max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                  {loadingPatientSearch ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Keresés…
                    </div>
                  ) : patientSearchResults.length === 0 ? (
                    <p className="py-4 text-center text-sm text-gray-500">Nincs találat</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {patientSearchResults.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPatientId(p.id);
                              setSelectedPatientName(p.nev || p.id);
                              setPatientSearchQuery('');
                              setPatientSearchResults([]);
                              setDocuments([]);
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors text-sm font-medium text-gray-900"
                          >
                            {p.nev || p.id}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
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
                const uploadedAt = doc.uploadedAt
                  ? format(new Date(doc.uploadedAt), 'yyyy. MM. dd.', { locale: hu })
                  : '';
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(doc)}
                      className="w-full text-left px-3 py-3 hover:bg-blue-50 transition-colors flex gap-3 items-center"
                    >
                      <DocumentListThumbnail
                        documentId={doc.id}
                        filename={doc.filename}
                        mimeType={doc.mimeType}
                        patientId={effectivePatientId}
                        portalMode={portalMode}
                      />
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
