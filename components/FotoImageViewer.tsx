'use client';

import { useState, useEffect, useRef } from 'react';
import { PatientDocument } from '@/lib/types';
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/dateUtils';

interface FotoImageViewerProps {
  patientId: string;
  patientName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function FotoImageViewer({ patientId, patientName, isOpen, onClose }: FotoImageViewerProps) {
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const previousImageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen && patientId) {
      loadFotoDocuments();
      setCurrentIndex(0);
      setZoom(1);
      setRotation(0);
      setImageError(false);
      // Clean up previous image URL
      if (previousImageUrlRef.current) {
        window.URL.revokeObjectURL(previousImageUrlRef.current);
        previousImageUrlRef.current = null;
      }
      setImageUrl(null);
    }
  }, [isOpen, patientId]);

  // Load image when current document changes
  useEffect(() => {
    const loadImage = async (doc: PatientDocument) => {
      try {
        setImageError(false);
        setImageLoading(true);
        setImageUrl(null);
        
        // Add inline parameter to ensure image is served with inline disposition
        const response = await fetch(`/api/patients/${patientId}/documents/${doc.id}?inline=true`);
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Failed to load image:', response.status, errorText);
          throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
        }
        
        // Check content type
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          console.warn('Document is not an image type:', contentType);
          // Still try to load it, might be a valid image with wrong mime type
        }
        
        const blob = await response.blob();
        
        // Verify blob is not empty
        if (blob.size === 0) {
          throw new Error('Image file is empty');
        }
        
        const url = window.URL.createObjectURL(blob);
        
        // Clean up previous URL
        if (previousImageUrlRef.current) {
          window.URL.revokeObjectURL(previousImageUrlRef.current);
        }
        
        previousImageUrlRef.current = url;
        setImageUrl(url);
        setImageLoading(false);
      } catch (error) {
        console.error('Error loading image:', error);
        setImageError(true);
        setImageLoading(false);
        if (previousImageUrlRef.current) {
          window.URL.revokeObjectURL(previousImageUrlRef.current);
          previousImageUrlRef.current = null;
        }
        setImageUrl(null);
      }
    };

    if (documents.length > 0 && documents[currentIndex] && patientId) {
      loadImage(documents[currentIndex]);
    } else {
      setImageUrl(null);
      setImageLoading(false);
    }
  }, [documents, currentIndex, patientId]);

  // Cleanup blob URLs on unmount or when component closes
  useEffect(() => {
    return () => {
      if (previousImageUrlRef.current) {
        window.URL.revokeObjectURL(previousImageUrlRef.current);
        previousImageUrlRef.current = null;
      }
    };
  }, []);

  const loadFotoDocuments = async () => {
    if (!patientId) return;
    
    try {
      setLoading(true);
      const response = await fetch(`/api/patients/${patientId}/documents/foto`);
      if (!response.ok) {
        throw new Error('Failed to load foto documents');
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Error loading foto documents:', error);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      setZoom(1);
      setRotation(0);
      setImageError(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < documents.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      setZoom(1);
      setRotation(0);
      setImageError(false);
    }
  };

  const handleDownload = async (doc: PatientDocument) => {
    try {
      const response = await fetch(`/api/patients/${patientId}/documents/${doc.id}`);
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading document:', error);
      alert('Hiba történt a letöltés során');
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isOpen) return;
    
    if (e.key === 'ArrowLeft') {
      handlePrevious();
    } else if (e.key === 'ArrowRight') {
      handleNext();
    } else if (e.key === 'Escape') {
      onClose();
    } else if (e.key === '+' || e.key === '=') {
      handleZoomIn();
    } else if (e.key === '-') {
      handleZoomOut();
    } else if (e.key === 'r' || e.key === 'R') {
      handleRotate();
    }
  };

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, currentIndex, documents.length]);

  if (!isOpen) return null;

  const currentDocument = documents[currentIndex];

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="relative w-full h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-75 text-white p-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-semibold">
                {patientName ? `${patientName} - Foto dokumentumok` : 'Foto dokumentumok'}
              </h2>
              {currentDocument && (
                <p className="text-sm text-gray-300 mt-1">
                  {currentDocument.filename} 
                  {currentDocument.uploadedAt && ` • ${formatDateForDisplay(currentDocument.uploadedAt)}`}
                  {documents.length > 1 && ` • ${currentIndex + 1} / ${documents.length}`}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-2 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
              title="Bezárás (Esc)"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Image Container */}
        <div className="flex-1 flex items-center justify-center p-4 pt-20 pb-20">
          {loading ? (
            <div className="text-white text-lg">Foto dokumentumok betöltése...</div>
          ) : documents.length === 0 ? (
            <div className="text-white text-lg text-center">
              <p>Nincsenek foto dokumentumok</p>
            </div>
          ) : currentDocument ? (
            <div className="relative max-w-full max-h-full flex items-center justify-center">
              {imageLoading && (
                <div className="text-white text-lg absolute">Kép betöltése...</div>
              )}
              {imageUrl && !imageLoading && (
                <img
                  src={imageUrl}
                  alt={currentDocument.filename}
                  className="max-w-full max-h-full object-contain"
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transition: 'transform 0.2s ease-out',
                  }}
                  onError={(e) => {
                    console.error('Image load error:', e);
                    setImageError(true);
                    setImageLoading(false);
                  }}
                  onLoad={() => {
                    setImageError(false);
                    setImageLoading(false);
                  }}
                />
              )}
              {imageError && !imageLoading && (
                <div className="text-white text-center p-8">
                  <p className="text-lg mb-2">Nem sikerült betölteni a képet</p>
                  <p className="text-sm text-gray-300 mb-4">
                    Lehet, hogy a fájl nem képformátum, vagy sérült.
                  </p>
                  <button
                    onClick={() => handleDownload(currentDocument)}
                    className="btn-primary mt-4"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Letöltés
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Navigation Controls */}
        {documents.length > 1 && (
          <>
            <button
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black bg-opacity-75 text-white rounded-full hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              title="Előző (←)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={handleNext}
              disabled={currentIndex === documents.length - 1}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black bg-opacity-75 text-white rounded-full hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              title="Következő (→)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Toolbar */}
        {currentDocument && !imageError && (
          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white p-4 z-10">
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
                title="Kicsinyítés (-)"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <span className="text-sm min-w-[60px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
                title="Nagyítás (+)"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              <div className="w-px h-6 bg-white bg-opacity-30"></div>
              <button
                onClick={handleRotate}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
                title="Forgatás (R)"
              >
                <RotateCw className="w-5 h-5" />
              </button>
              <div className="w-px h-6 bg-white bg-opacity-30"></div>
              <button
                onClick={() => handleDownload(currentDocument)}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
                title="Letöltés"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

