'use client';

import { useCallback } from 'react';
import { useToast } from '@/contexts/ToastContext';
import type { MessageChannel, MessageContextEntityType, MessageContextLink } from '@/lib/types/messaging';

type ApiChannel = 'messages' | 'doctor-messages';

export function useMessageContextActions(channel: MessageChannel) {
  const { showToast } = useToast();
  const apiChannel: ApiChannel = channel === 'patient' ? 'messages' : 'doctor-messages';

  const attachLink = useCallback(
    async (
      messageId: string,
      entityType: MessageContextEntityType,
      entityId: string,
    ): Promise<MessageContextLink | null> => {
      try {
        const res = await fetch(`/api/${apiChannel}/${messageId}/context`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType, entityId }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Link csatolása sikertelen');
        }
        return data.link as MessageContextLink;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Hiba a link csatolásakor', 'error');
        return null;
      }
    },
    [apiChannel, showToast],
  );

  const removeLink = useCallback(
    async (messageId: string, linkId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/${apiChannel}/${messageId}/context`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkId }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Link eltávolítása sikertelen');
        }
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Hiba a link törlésekor', 'error');
        return false;
      }
    },
    [apiChannel, showToast],
  );

  const fetchLinks = useCallback(
    async (messageId: string): Promise<MessageContextLink[]> => {
      try {
        const res = await fetch(`/api/${apiChannel}/${messageId}/context`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) return [];
        return (data.links ?? []) as MessageContextLink[];
      } catch {
        return [];
      }
    },
    [apiChannel],
  );

  return { attachLink, removeLink, fetchLinks };
}
