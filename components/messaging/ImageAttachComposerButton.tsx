'use client';

import { useRef } from 'react';
import { ImagePlus } from 'lucide-react';

interface ImageAttachComposerButtonProps {
  disabled?: boolean;
  /** A felhasználó által kiválasztott képfájlok (a hívó dönt a célhelyről). */
  onFilesSelected: (files: File[]) => void;
  multiple?: boolean;
  title?: string;
  className?: string;
}

/**
 * Composer gomb: kép kiválasztása (mobilon kamera / galéria) a chat-üzenethez.
 * Csak a fájlválasztást végzi — a feltöltés és a marker a küldéskor történik.
 */
export function ImageAttachComposerButton({
  disabled = false,
  onFilesSelected,
  multiple = true,
  title = 'Kép küldése',
  className,
}: ImageAttachComposerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={
          className ??
          'inline-flex items-center justify-center gap-1.5 flex-shrink-0 btn-secondary rounded-full w-10 h-10 p-0 sm:w-auto sm:h-auto sm:min-h-[44px] sm:rounded-lg sm:px-3 sm:py-2'
        }
        title={title}
        aria-label={title}
      >
        <ImagePlus className="w-4 h-4 flex-shrink-0" />
        <span className="hidden sm:inline text-sm leading-none whitespace-nowrap">Kép</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Ugyanaz a fájl újra kiválasztható legyen.
          e.target.value = '';
          if (files.length > 0) onFilesSelected(files);
        }}
      />
    </>
  );
}
