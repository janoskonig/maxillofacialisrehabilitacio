'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { PatientDocument } from '@/lib/types';
import { File, Download, Trash2, Tag, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/dateUtils';

interface DocumentCardProps {
  document: PatientDocument;
  patientId: string;
  canDelete?: boolean;
  onDownload: (doc: PatientDocument) => void;
  onDelete: (doc: PatientDocument) => void;
  onPreview?: (doc: PatientDocument) => void;
  formatFileSize: (bytes: number) => string;
}

export function DocumentCard({
  document,
  patientId,
  canDelete = false,
  onDownload,
  onDelete,
  onPreview,
  formatFileSize,
}: DocumentCardProps) {
  const [imageError, setImageError] = useState(false);

  // Fontos: onError többször is lefuthat (pl. cache / retry / dev), fogjuk le
  const errorLatchedRef = useRef(false);

  const isImage = document.mimeType?.startsWith('image/');
  
  // Stabil URL számítás - ne számolódjon újra feleslegesen
  const thumbnailUrl = useMemo(() => {
    if (!isImage || imageError) return null;
    // Ha van olyan paraméter, ami minden rendernél változik (pl. timestamp), az flickert okoz
    return `/api/patients/${patientId}/documents/${document.id}?inline=true`;
  }, [isImage, imageError, patientId, document.id]);

  const handleThumbnailClick = (e: React.MouseEvent) => {
    if (isImage && onPreview && !imageError) {
      e.stopPropagation();
      onPreview(document);
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload(document);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(document);
  };

  const handleImageError = useCallback(() => {
    if (errorLatchedRef.current) return; // Ne fusson le többször (pl. cache / retry / dev)
    errorLatchedRef.current = true;
    setImageError(true);
  }, []);

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
      onClick={handleThumbnailClick}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square bg-gray-100 group">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={document.filename}
            className="w-full h-full object-cover group-hover:opacity-75 transition-opacity"
            loading="lazy"
            decoding="async"
            onError={handleImageError}
            style={{ display: 'block' }}
          />
        ) : imageError ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 p-4">
            <File className="w-12 h-12 text-gray-400 mb-2" />
            <p className="text-xs text-gray-600 text-center mb-2">Nem sikerült betölteni</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <File className="w-12 h-12 text-gray-400" />
          </div>
        )}
      </div>

      {/* Document Info */}
      <div className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base text-gray-900 truncate mb-1" title={document.filename}>
              {document.filename}
            </p>
            {document.description && (
              <p className="text-xs sm:text-sm text-gray-600 line-clamp-2 mb-2">{document.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] sm:text-xs text-gray-500 mb-2 flex-wrap">
          <span>{formatFileSize(document.fileSize || 0)}</span>
          <span>•</span>
          {document.uploadedAt && (
            <>
              <span>{formatDateForDisplay(document.uploadedAt)}</span>
              {document.uploadedByName && (
                <>
                  <span>•</span>
                  <span>Feltöltötte: {document.uploadedByName}</span>
                </>
              )}
            </>
          )}
        </div>

        {document.tags && Array.isArray(document.tags) && document.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {document.tags.map((tag: string) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
              >
                <Tag className="w-3 h-3 mr-1" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 rounded transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
            title="Letöltés"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Letöltés</span>
          </button>
          {canDelete && (
            <button
              onClick={handleDelete}
              className="p-1.5 sm:p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Törlés"
            >
              <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
