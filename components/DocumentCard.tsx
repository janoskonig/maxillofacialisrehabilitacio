'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { PatientDocument } from '@/lib/types';
import { File, Download, Trash2, Tag, Pencil, X, Plus, Check } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/dateUtils';

interface DocumentCardProps {
  document: PatientDocument;
  patientId: string;
  canDelete?: boolean;
  canEditTags?: boolean;
  availableTags?: string[];
  onDownload: (doc: PatientDocument) => void;
  onDelete: (doc: PatientDocument) => void;
  onUpdateTags?: (doc: PatientDocument, tags: string[]) => Promise<void>;
  onPreview?: (doc: PatientDocument) => void;
  formatFileSize: (bytes: number) => string;
}

export function DocumentCard({
  document,
  patientId,
  canDelete = false,
  canEditTags = false,
  availableTags = [],
  onDownload,
  onDelete,
  onUpdateTags,
  onPreview,
  formatFileSize,
}: DocumentCardProps) {
  const [imageError, setImageError] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>(Array.isArray(document.tags) ? document.tags : []);
  const [newTag, setNewTag] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  // Fontos: onError többször is lefuthat (pl. cache / retry / dev), fogjuk le
  const errorLatchedRef = useRef(false);

  const isImage = document.mimeType?.startsWith('image/');

  useEffect(() => {
    setDraftTags(Array.isArray(document.tags) ? document.tags : []);
    setIsEditingTags(false);
    setNewTag('');
  }, [document.id, document.tags]);
  
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

  const addTag = (tagToAdd?: string) => {
    const value = (tagToAdd ?? newTag).trim();
    if (!value) return;

    const isDuplicate = draftTags.some((tag) => tag.toLowerCase() === value.toLowerCase());
    if (isDuplicate) {
      setNewTag('');
      return;
    }

    setDraftTags([...draftTags, value]);
    setNewTag('');
  };

  const removeTag = (tagToRemove: string) => {
    setDraftTags(draftTags.filter((tag) => tag !== tagToRemove));
  };

  const handleSaveTags = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onUpdateTags) return;
    try {
      setSavingTags(true);
      await onUpdateTags(document, draftTags);
      setIsEditingTags(false);
    } finally {
      setSavingTags(false);
    }
  };

  const handleCancelEditTags = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftTags(Array.isArray(document.tags) ? document.tags : []);
    setNewTag('');
    setIsEditingTags(false);
  };

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

        {!isEditingTags && document.tags && Array.isArray(document.tags) && document.tags.length > 0 && (
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

        {canEditTags && (
          <div className="mb-2">
            {isEditingTags ? (
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap gap-1">
                  {draftTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-medical-primary text-white"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-1 hover:text-gray-200"
                        title={`${tag} törlése`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                {availableTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {availableTags.map((tag) => {
                      const isSelected = draftTags.some((t) => t.toLowerCase() === tag.toLowerCase());
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => addTag(tag)}
                          disabled={isSelected}
                          className={`px-2 py-0.5 rounded text-xs border ${
                            isSelected
                              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    className="flex-1 form-input text-xs py-1"
                    placeholder="Új címke"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addTag();
                    }}
                    className="p-1 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                    title="Címke hozzáadása"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEditTags}
                    disabled={savingTags}
                    className="p-1 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded disabled:opacity-50"
                    title="Mégse"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTags}
                    disabled={savingTags}
                    className="p-1 text-green-700 hover:text-green-800 hover:bg-green-50 rounded disabled:opacity-50"
                    title="Mentés"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingTags(true);
                }}
                className="inline-flex items-center gap-1 text-xs text-medical-primary hover:underline"
              >
                <Pencil className="w-3 h-3" />
                Címkék szerkesztése
              </button>
            )}
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
