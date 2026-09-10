'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { PendingChatImage } from '@/lib/messaging/chat-image-upload';

interface Props {
  images: PendingChatImage[];
  onRemove: (id: string) => void;
  /** Rövid magyarázat a célhelyről (pl. „A kép a beteg dokumentumai közé kerül”). */
  note?: ReactNode;
  /** Ha megadott, „Módosítás” gomb jelenik meg a célhely megváltoztatásához. */
  onChangeTarget?: () => void;
  disabled?: boolean;
}

/** A szerkesztő fölötti csík a küldésre váró képekkel. */
export function PendingChatImagesBar({ images, onRemove, note, onChangeTarget, disabled = false }: Props) {
  if (!images.length) return null;

  return (
    <div
      className="px-2 py-1.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60"
      data-testid="pending-chat-images"
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((img) => {
          const uploading = img.status === 'uploading';
          const failed = img.status === 'error';
          return (
            <div
              key={img.id}
              className={`relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 border ${
                failed ? 'border-red-400 ring-2 ring-red-300' : 'border-gray-200 dark:border-gray-700'
              }`}
              title={failed ? img.error ?? 'Hiba' : img.file.name}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.previewUrl} alt="" className="w-full h-full object-cover" />
              {uploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-white animate-spin" aria-label="feltöltés folyamatban" />
                </div>
              )}
              {failed && (
                <div className="absolute inset-x-0 bottom-0 bg-red-600/90 text-white flex items-center justify-center py-0.5">
                  <AlertTriangle className="w-3.5 h-3.5" aria-label="hiba" />
                </div>
              )}
              {!uploading && (
                <button
                  type="button"
                  onClick={() => onRemove(img.id)}
                  disabled={disabled}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-40"
                  aria-label="Kép eltávolítása"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {(note || onChangeTarget) && (
        <div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400 px-0.5">
          <span className="truncate">{note}</span>
          {onChangeTarget && (
            <button
              type="button"
              onClick={onChangeTarget}
              disabled={disabled}
              className="flex-shrink-0 text-blue-600 dark:text-blue-300 hover:underline disabled:opacity-40"
            >
              Módosítás
            </button>
          )}
        </div>
      )}
    </div>
  );
}
