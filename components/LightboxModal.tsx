'use client';

import { useEffect, useRef, useState, useCallback, useReducer } from 'react';
import { PatientDocument } from '@/lib/types';
import { X, ChevronLeft, ChevronRight, Download, ExternalLink, AlertCircle, File } from 'lucide-react';

type ImgState = {
  src: string | null;        // ami ténylegesen ki van téve
  loading: boolean;
  error: string | null;
  requestedKey: string | null; // melyik dokumentumot kérjük éppen
};

const initialImgState: ImgState = { 
  src: null, 
  loading: false, 
  error: null, 
  requestedKey: null 
};

function imgReducer(state: ImgState, action: { type: string; src?: string; error?: string; key?: string }): ImgState {
  switch (action.type) {
    case "REQUEST":
      return { ...state, loading: true, error: null, requestedKey: action.key ?? null };
    case "COMMIT":
      return { ...state, src: action.src ?? null, loading: false, error: null };
    case "FAIL":
      return { ...state, loading: false, error: action.error ?? "Failed to load" };
    default:
      return state;
  }
}

function preloadImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort);

    img.onload = () => { cleanup(); resolve(); };
    img.onerror = () => { cleanup(); reject(new Error("Image load error")); };

    img.src = url;
  });
}

interface LightboxModalProps {
  isOpen: boolean;
  document: PatientDocument | null;
  documents: PatientDocument[];
  patientId: string;
  onClose: () => void;
  onDownload?: (doc: PatientDocument) => void;
}

export function LightboxModal({
  isOpen,
  document,
  documents,
  patientId,
  onClose,
  onDownload,
}: LightboxModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [state, dispatch] = useReducer(imgReducer, initialImgState);
  const modalRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Filter only image documents for navigation
  const imageDocuments = documents.filter(doc => doc.mimeType?.startsWith('image/'));

  // Find current document index in image documents
  useEffect(() => {
    if (document && isOpen) {
      const index = imageDocuments.findIndex(doc => doc.id === document.id);
      if (index !== -1) {
        setCurrentIndex(index);
      }
    }
  }, [document, isOpen, imageDocuments]);

  // Preload image when current document changes
  useEffect(() => {
    if (!isOpen || !imageDocuments[currentIndex]) {
      return;
    }

    const activeDoc = imageDocuments[currentIndex];
    if (!activeDoc.mimeType?.startsWith('image/')) {
      return;
    }

    // előző kérés megszakítása
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const url = `/api/patients/${patientId}/documents/${activeDoc.id}?inline=true`;
    const requestedKey = `${activeDoc.id}`;

    dispatch({ type: "REQUEST", key: requestedKey });

    (async () => {
      try {
        await preloadImage(url, controller.signal);
        // csak akkor commit, ha még ez a legaktuálisabb kérés
        if (!controller.signal.aborted) {
          dispatch({ type: "COMMIT", src: url });
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        dispatch({ type: "FAIL", error: "Image could not be loaded" });
      }
    })();

    return () => controller.abort();
  }, [isOpen, patientId, currentIndex, imageDocuments]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex(prev => {
      if (prev > 0) {
        return prev - 1;
      }
      return prev;
    });
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex(prev => {
      const maxIndex = imageDocuments.length - 1;
      if (prev < maxIndex) {
        return prev + 1;
      }
      return prev;
    });
  }, [imageDocuments.length]);

  // Focus trap and keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    // Use window.document to avoid conflict with 'document' prop
    const domDoc = typeof window !== 'undefined' ? window.document : null;
    if (!domDoc) return;

    // Lock background scroll (with counter for multiple modals)
    if (domDoc.body) {
      const currentCount = parseInt(domDoc.body.dataset.scrollLockCount || '0', 10);
      domDoc.body.dataset.scrollLockCount = String(currentCount + 1);
      domDoc.body.style.overflow = 'hidden';
    }

    // Focus trap
    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (domDoc.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (domDoc.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Tab') {
        handleTabKey(e);
      }
    };

    domDoc.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => {
      domDoc.removeEventListener('keydown', handleKeyDown);
      // Unlock background scroll (with counter for multiple modals)
      if (domDoc.body) {
        const currentCount = parseInt(domDoc.body.dataset.scrollLockCount || '0', 10);
        const newCount = Math.max(0, currentCount - 1);
        domDoc.body.dataset.scrollLockCount = String(newCount);
        if (newCount === 0) {
          domDoc.body.style.overflow = '';
        }
      }
    };
  }, [isOpen, onClose, handlePrevious, handleNext]);

  const handleOpenInNewTab = () => {
    const currentDoc = imageDocuments[currentIndex];
    if (currentDoc) {
      window.open(`/api/patients/${patientId}/documents/${currentDoc.id}?inline=true`, '_blank');
    }
  };

  const handleDownload = () => {
    const currentDoc = imageDocuments[currentIndex];
    if (currentDoc && onDownload) {
      onDownload(currentDoc);
    }
  };

  if (!isOpen || !document) return null;

  const currentDoc = imageDocuments[currentIndex];
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < imageDocuments.length - 1;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full h-full max-w-7xl max-h-[95vh] flex items-center justify-center">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
          aria-label="Bezárás"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Navigation buttons */}
        {hasPrevious && (
          <button
            onClick={handlePrevious}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
            aria-label="Előző kép"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {hasNext && (
          <button
            onClick={handleNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
            aria-label="Következő kép"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* Image container */}
        <div className="relative w-full h-full flex items-center justify-center p-4">
          {state.src ? (
            <img
              src={state.src}
              alt={currentDoc?.filename || 'Kép'}
              className="max-w-full max-h-full object-contain"
              draggable={false}
              style={{ display: 'block' }}
            />
          ) : (
            <div style={{ width: 800, height: 600 }} /> // stabil placeholder, ne ugráljon a layout
          )}

          {state.loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="animate-pulse text-white">
                <File className="w-16 h-16" />
              </div>
            </div>
          )}

          {state.error && (
            <div className="flex flex-col items-center justify-center text-white p-8">
              <File className="w-16 h-16 mb-4 text-gray-400" />
              <p className="text-lg mb-2">Nem sikerült betölteni a képet</p>
              <div className="flex gap-2 mt-4">
                {onDownload && (
                  <button
                    onClick={handleDownload}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Letöltés
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  Bezárás
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom controls */}
        {!state.error && currentDoc && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-black/50 rounded-lg px-4 py-2">
            <span className="text-white text-sm">
              {currentIndex + 1} / {imageDocuments.length}
            </span>
            {currentDoc.filename && (
              <span className="text-gray-300 text-sm mx-2">•</span>
            )}
            {currentDoc.filename && (
              <span className="text-gray-300 text-sm truncate max-w-xs" title={currentDoc.filename}>
                {currentDoc.filename}
              </span>
            )}
            <button
              onClick={handleOpenInNewTab}
              className="ml-4 p-1.5 text-white hover:bg-white/20 rounded transition-colors"
              title="Megnyitás új lapon"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            {onDownload && (
              <button
                onClick={handleDownload}
                className="p-1.5 text-white hover:bg-white/20 rounded transition-colors"
                title="Letöltés"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
