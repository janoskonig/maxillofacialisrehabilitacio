'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isImageFile,
  MAX_CHAT_IMAGES_PER_SEND,
  type ChatImageTarget,
  type PendingChatImage,
} from '@/lib/messaging/chat-image-upload';

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A chat-szerkesztőhöz csatolt, még el nem küldött képek állapota
 * (előnézet URL-ek felszabadításával).
 */
export function usePendingChatImages() {
  const [images, setImages] = useState<PendingChatImage[]>([]);
  const imagesRef = useRef<PendingChatImage[]>([]);
  imagesRef.current = images;

  /** Csak képfájlokat vesz fel; visszaadja a ténylegesen hozzáadott darabszámot. */
  const add = useCallback((files: File[], target: ChatImageTarget | null): number => {
    const accepted = files.filter(isImageFile);
    if (accepted.length === 0) return 0;
    const room = Math.max(0, MAX_CHAT_IMAGES_PER_SEND - imagesRef.current.length);
    const toAdd = accepted.slice(0, room);
    if (toAdd.length === 0) return 0;
    const items: PendingChatImage[] = toAdd.map((file) => ({
      id: newId(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'idle',
      error: null,
      target,
      uploadedMarker: null,
    }));
    setImages((prev) => [...prev, ...items]);
    return items.length;
  }, []);

  const remove = useCallback((id: string) => {
    setImages((prev) => {
      const hit = prev.find((img) => img.id === id);
      if (hit) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const update = useCallback((id: string, patch: Partial<PendingChatImage>) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  }, []);

  const setTargetForAll = useCallback((target: ChatImageTarget | null) => {
    setImages((prev) => prev.map((img) => ({ ...img, target })));
  }, []);

  const clear = useCallback(() => {
    setImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

  // Unmount: minden előnézet felszabadítása.
  useEffect(
    () => () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    },
    [],
  );

  return {
    images,
    hasImages: images.length > 0,
    isUploading: images.some((img) => img.status === 'uploading'),
    add,
    remove,
    update,
    setTargetForAll,
    clear,
  };
}

export type PendingChatImagesApi = ReturnType<typeof usePendingChatImages>;
