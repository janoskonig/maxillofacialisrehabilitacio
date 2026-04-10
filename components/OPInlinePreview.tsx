'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PatientDocument } from '@/lib/types';
import { usePatientDocumentAnnotationsMap } from '@/hooks/usePatientDocumentAnnotationsMap';
import { OPImageViewer } from './OPImageViewer';
import { DocumentAnnotationThumbnail } from './DocumentAnnotationThumbnail';
import { Image as ImageIcon, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/dateUtils';

interface OPInlinePreviewProps {
  patientId: string;
  patientName?: string;
  variant?: 'default' | 'presentation';
  canAnnotate?: boolean;
  activityWhenViewerOpen?: { action: string; detail: string };
  presentationActivityContext?: string;
}

export function OPInlinePreview({
  patientId,
  patientName,
  variant = 'default',
  canAnnotate = false,
  activityWhenViewerOpen,
  presentationActivityContext,
}: OPInlinePreviewProps) {
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const prevUrlRef = useRef<string | null>(null);
  const opDocIds = useMemo(
    () => documents.map((d) => d.id).filter((id): id is string => Boolean(id)),
    [documents],
  );
  const { byDocumentId: annByDoc, refresh: refreshOpAnnotations } =
    usePatientDocumentAnnotationsMap(patientId, opDocIds);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/patients/${patientId}/documents/op`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        if (!cancelled) {
          setDocuments(data.documents || []);
          setCurrentIndex(0);
        }
      } catch {
        if (!cancelled) setDocuments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    return () => { cancelled = true; };
  }, [patientId]);

  const loadThumbnail = useCallback(async (doc: PatientDocument) => {
    setThumbnailError(false);
    setThumbnailLoading(true);
    setThumbnailUrl(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/documents/${doc.id}?inline=true`);
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('Empty');
      const url = URL.createObjectURL(blob);
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = url;
      setThumbnailUrl(url);
    } catch {
      setThumbnailError(true);
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    } finally {
      setThumbnailLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (documents.length > 0 && documents[currentIndex]) {
      loadThumbnail(documents[currentIndex]);
    } else {
      setThumbnailUrl(null);
      setThumbnailLoading(false);
    }
  }, [documents, currentIndex, loadThumbnail]);

  useEffect(() => {
    return () => {
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    };
  }, []);

  const isPresent = variant === 'presentation';
  const cardClass = isPresent
    ? 'border border-white/15 rounded-lg bg-gray-100 p-3 mb-0 shadow-sm'
    : 'border rounded-lg bg-gray-50 p-3 mb-4';

  if (loading) {
    return (
      <div
        className={`flex items-center gap-2 text-sm py-2 ${isPresent ? 'text-gray-500 border border-white/10 rounded-lg bg-gray-100/80 px-3' : 'text-gray-400'}`}
      >
        <ImageIcon className="w-4 h-4 animate-pulse" />
        <span>OP betöltése…</span>
      </div>
    );
  }

  if (documents.length === 0) return null;

  const currentDoc = documents[currentIndex];

  return (
    <>
      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon className="w-4 h-4 text-medical-primary" />
          <h5 className="text-sm font-semibold text-gray-700">OP felvétel</h5>
          {documents.length > 1 && (
            <span className="text-xs text-gray-500">
              ({currentIndex + 1}/{documents.length})
            </span>
          )}
          {currentDoc?.uploadedAt && (
            <span className={`text-xs ml-auto ${isPresent ? 'text-gray-500' : 'text-gray-400'}`}>
              {formatDateForDisplay(currentDoc.uploadedAt)}
            </span>
          )}
        </div>

        <div className="relative group">
          <div
            className="relative w-full overflow-hidden rounded cursor-pointer bg-black/5 flex items-center justify-center"
            style={{ minHeight: isPresent ? 'min(52vh, 480px)' : '100px' }}
            onClick={() => setViewerOpen(true)}
          >
            {thumbnailLoading && (
              <span className="text-sm text-gray-400 py-8">Kép betöltése…</span>
            )}
            {thumbnailUrl && !thumbnailLoading && currentDoc?.id && (
              <DocumentAnnotationThumbnail
                patientId={patientId}
                documentId={currentDoc.id}
                imageUrl={thumbnailUrl}
                annotations={annByDoc[currentDoc.id] ?? []}
                objectFit="contain"
                className="w-full"
                imgClassName="w-full object-contain"
                onImageError={() => setThumbnailError(true)}
              />
            )}
            {thumbnailError && !thumbnailLoading && (
              <span className="text-sm text-gray-400 py-8">Nem sikerült betölteni</span>
            )}

            {/* Hover overlay */}
            {thumbnailUrl && !thumbnailLoading && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                <div className="bg-white/90 rounded-full p-2 shadow">
                  <ZoomIn className="w-5 h-5 text-gray-700" />
                </div>
              </div>
            )}
          </div>

          {/* Navigation arrows for multiple OPs */}
          {documents.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setCurrentIndex(i => Math.max(0, i - 1)); }}
                disabled={currentIndex === 0}
                className="absolute left-1 top-1/2 -translate-y-1/2 p-1 bg-white/80 rounded-full shadow hover:bg-white disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setCurrentIndex(i => Math.min(documents.length - 1, i + 1)); }}
                disabled={currentIndex === documents.length - 1}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white/80 rounded-full shadow hover:bg-white disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <OPImageViewer
        patientId={patientId}
        patientName={patientName}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        canAnnotate={canAnnotate}
        onAnnotationsUpdated={refreshOpAnnotations}
        activityWhenOpened={activityWhenViewerOpen}
        presentationActivityContext={presentationActivityContext}
      />
    </>
  );
}
