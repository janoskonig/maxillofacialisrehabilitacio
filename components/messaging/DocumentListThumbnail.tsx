'use client';

import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import {
  getPatientDocumentInlineUrl,
  getPortalDocumentInlineUrl,
  isDocumentPreviewable,
  isPdfDocument,
} from '@/lib/document-inline-url';
import { renderPdfFirstPageThumbnail } from '@/lib/pdf-first-page-thumbnail';

interface DocumentListThumbnailProps {
  documentId: string;
  filename: string;
  mimeType: string | null;
  patientId: string | null;
  portalMode?: boolean;
}

function ThumbnailFallback({ mimeType }: { mimeType: string | null }) {
  const Icon = mimeType?.startsWith('image/') ? ImageIcon : FileText;
  return (
    <div className="w-12 h-12 flex-shrink-0 rounded-md bg-gray-100 flex items-center justify-center">
      <Icon className="w-5 h-5 text-gray-400" />
    </div>
  );
}

export function DocumentListThumbnail({
  documentId,
  filename,
  mimeType,
  patientId,
  portalMode = false,
}: DocumentListThumbnailProps) {
  const [imageError, setImageError] = useState(false);
  const [pdfThumb, setPdfThumb] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const previewable = isDocumentPreviewable(mimeType, filename);
  const isPdf = isPdfDocument(mimeType, filename);
  const isImage = mimeType?.startsWith('image/') ?? false;

  const inlineUrl = (() => {
    if (!previewable) return null;
    if (portalMode) return getPortalDocumentInlineUrl(documentId);
    if (!patientId) return null;
    return getPatientDocumentInlineUrl(documentId, patientId);
  })();

  useEffect(() => {
    if (!isPdf || !inlineUrl) {
      setPdfThumb(null);
      setPdfLoading(false);
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    setPdfThumb(null);
    void renderPdfFirstPageThumbnail(inlineUrl)
      .then((dataUrl) => {
        if (!cancelled) setPdfThumb(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setPdfThumb(null);
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPdf, inlineUrl]);

  if (!previewable || !inlineUrl) {
    return <ThumbnailFallback mimeType={mimeType} />;
  }

  if (isPdf) {
    if (pdfLoading) {
      return (
        <div className="w-12 h-12 flex-shrink-0 rounded-md bg-gray-100 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        </div>
      );
    }
    if (!pdfThumb) {
      return <ThumbnailFallback mimeType={mimeType} />;
    }
    return (
      <div className="w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-gray-100">
        <img src={pdfThumb} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }

  if (!isImage || imageError) {
    return <ThumbnailFallback mimeType={mimeType} />;
  }

  return (
    <div className="w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-gray-100">
      <img
        src={inlineUrl}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setImageError(true)}
      />
    </div>
  );
}
