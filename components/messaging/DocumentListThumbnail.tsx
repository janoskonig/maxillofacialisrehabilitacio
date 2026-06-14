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
  /** Lista (48px) vagy kártya (teljes doboz) méret. */
  size?: 'sm' | 'lg';
}

function ThumbnailFallback({
  mimeType,
  size,
}: {
  mimeType: string | null;
  size: 'sm' | 'lg';
}) {
  const Icon = mimeType?.startsWith('image/') ? ImageIcon : FileText;
  const boxClass =
    size === 'lg'
      ? 'w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800'
      : 'w-12 h-12 flex-shrink-0 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center';
  const iconClass = size === 'lg' ? 'w-12 h-12 text-gray-400 dark:text-gray-500' : 'w-5 h-5 text-gray-400 dark:text-gray-500';
  return (
    <div className={boxClass}>
      <Icon className={iconClass} />
    </div>
  );
}

export function DocumentListThumbnail({
  documentId,
  filename,
  mimeType,
  patientId,
  portalMode = false,
  size = 'sm',
}: DocumentListThumbnailProps) {
  const pdfWidthPx = size === 'lg' ? 400 : 96;
  const boxClass =
    size === 'lg'
      ? 'w-full h-full overflow-hidden bg-gray-100 dark:bg-gray-800'
      : 'w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800';
  const loaderBoxClass =
    size === 'lg'
      ? 'w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800'
      : 'w-12 h-12 flex-shrink-0 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center';
  const loaderIconClass = size === 'lg' ? 'w-8 h-8' : 'w-4 h-4';
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
    void renderPdfFirstPageThumbnail(inlineUrl, pdfWidthPx)
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
  }, [isPdf, inlineUrl, pdfWidthPx]);

  if (!previewable || !inlineUrl) {
    return <ThumbnailFallback mimeType={mimeType} size={size} />;
  }

  if (isPdf) {
    if (pdfLoading) {
      return (
        <div className={loaderBoxClass}>
          <Loader2 className={`${loaderIconClass} animate-spin text-gray-400 dark:text-gray-500`} />
        </div>
      );
    }
    if (!pdfThumb) {
      return <ThumbnailFallback mimeType={mimeType} size={size} />;
    }
    return (
      <div className={boxClass}>
        <img
          src={pdfThumb}
          alt=""
          className={`w-full h-full object-cover${size === 'lg' ? ' group-hover:opacity-75 transition-opacity' : ''}`}
        />
      </div>
    );
  }

  if (!isImage || imageError) {
    return <ThumbnailFallback mimeType={mimeType} size={size} />;
  }

  return (
    <div className={boxClass}>
      <img
        src={inlineUrl}
        alt=""
        className={`w-full h-full object-cover${size === 'lg' ? ' group-hover:opacity-75 transition-opacity' : ''}`}
        loading="lazy"
        decoding="async"
        onError={() => setImageError(true)}
      />
    </div>
  );
}
