'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

/**
 * usePresence — staff (orvos) online-jelenlét a Socket.io `presence-*`
 * eseményekből. Mountkor `presence-request`-tel hidratál, majd `presence-update`
 * eseményekre frissít. Csak orvos felületeken használjuk (a betegek nem kapnak
 * `staff`-szoba broadcastot). Socket nélkül degradál: üres halmaz.
 */
export function usePresence(socket: Socket | null, isConnected: boolean) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!socket || !isConnected) return;

    const onSnapshot = (data: { onlineUserIds: string[] }) => {
      setOnlineUserIds(new Set(data.onlineUserIds));
    };
    const onUpdate = (data: { userId: string; online: boolean }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (data.online) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
    };

    socket.on('presence-snapshot', onSnapshot);
    socket.on('presence-update', onUpdate);
    socket.emit('presence-request');

    return () => {
      socket.off('presence-snapshot', onSnapshot);
      socket.off('presence-update', onUpdate);
    };
  }, [socket, isConnected]);

  const isOnline = useCallback(
    (userId?: string | null) => !!userId && onlineUserIds.has(userId),
    [onlineUserIds],
  );

  return { onlineUserIds, isOnline };
}
