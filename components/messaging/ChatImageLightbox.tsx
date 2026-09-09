'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, X } from 'lucide-react';

interface Props {
  src: string;
  alt?: string;
  filename?: string | null;
  /** Letöltés URL (ha eltér az inline forrástól). */
  downloadHref?: string | null;
  onClose: () => void;
}

/** Egyszerű, csatorna-független teljes képernyős képnéző a chat-képekhez. */
export function ChatImageLightbox({ src, alt = 'Kép', filename, downloadHref, onClose }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const domDoc = window.document;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    domDoc.addEventListener('keydown', handleKeyDown);
    // Háttér-görgetés zárolása (számlálóval, mint a LightboxModal).
    const currentCount = parseInt(domDoc.body.dataset.scrollLockCount || '0', 10);
    domDoc.body.dataset.scrollLockCount = String(currentCount + 1);
    domDoc.body.style.overflow = 'hidden';
    return () => {
      domDoc.removeEventListener('keydown', handleKeyDown);
      const count = parseInt(domDoc.body.dataset.scrollLockCount || '0', 10);
      const next = Math.max(0, count - 1);
      domDoc.body.dataset.scrollLockCount = String(next);
      if (next === 0) domDoc.body.style.overflow = '';
    };
  }, [onClose]);

  if (!mounted || typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={filename || alt}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
        aria-label="Bezárás"
        autoFocus
      >
        <X className="w-6 h-6" />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-black/60 rounded-lg px-3 py-1.5 max-w-[95vw]">
        {filename ? (
          <span className="text-gray-200 text-xs truncate max-w-[50vw]" title={filename}>
            {filename}
          </span>
        ) : null}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 text-white hover:bg-white/20 rounded transition-colors"
          title="Megnyitás új lapon"
          aria-label="Megnyitás új lapon"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <a
          href={downloadHref || src}
          download={filename || undefined}
          className="p-1.5 text-white hover:bg-white/20 rounded transition-colors"
          title="Letöltés"
          aria-label="Letöltés"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>
    </div>,
    window.document.body,
  );
}
