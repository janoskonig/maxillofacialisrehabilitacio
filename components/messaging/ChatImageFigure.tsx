'use client';

import { useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { ChatImageLightbox } from './ChatImageLightbox';

interface Props {
  src: string;
  alt: string;
  filename?: string | null;
  downloadHref?: string | null;
  className?: string;
}

/**
 * Inline kép a chat-buborékban: kattintásra teljes képernyős nézet.
 * Betöltés alatt placeholder, hiba esetén szöveges fallback.
 */
export function ChatImageFigure({ src, alt, filename, downloadHref, className }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  if (error) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/20 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs opacity-80 ${className ?? ''}`}
      >
        <ImageOff className="w-4 h-4 flex-shrink-0" />
        <span>A kép nem tölthető be</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`relative block rounded-lg overflow-hidden bg-black/10 dark:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
          loaded ? '' : 'min-w-[96px] min-h-[96px]'
        } ${className ?? ''}`}
        title={filename || alt}
        aria-label={`Kép megnyitása${filename ? `: ${filename}` : ''}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={`block w-auto h-auto max-w-full max-h-72 sm:max-h-80 object-contain transition-opacity ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {!loaded && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin opacity-70" aria-label="kép betöltése" />
          </span>
        )}
      </button>
      {open && (
        <ChatImageLightbox
          src={src}
          alt={alt}
          filename={filename}
          downloadHref={downloadHref}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
