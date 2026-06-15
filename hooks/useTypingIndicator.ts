'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

/** Az aktuálisan nyitott beszélgetés azonosítói (a routinghoz). */
export interface TypingConversation {
  patientId?: string | null;
  groupId?: string | null;
  /** 1:1 orvos-szál esetén a partner orvos userId-ja. */
  recipientId?: string | null;
}

interface TypingPayload {
  userId: string;
  userType: string;
  typing: boolean;
  patientId: string | null;
  groupId: string | null;
}

interface Options {
  socket: Socket | null;
  isConnected: boolean;
  conversation: TypingConversation | null;
  currentUserId?: string | null;
  /** Megjelenítendő név a „… gépel” címkéhez (pl. a partner neve). */
  peerName?: string | null;
}

const STOP_AFTER_MS = 3000; // saját typing auto-stop tétlenség után
const EXPIRE_MS = 4000; // bejövő typing biztonsági lejárat (elveszett stop esetére)

/**
 * useTypingIndicator — kétirányú „gépel…” jelzés.
 *
 *  - Bejövő: a nyitott beszélgetéshez tartozó `typing` eseményekből
 *    összerakja a `typingLabel`-t (`MessageThread` mutatja).
 *  - Kimenő: `notifyTyping()` a composer beírásakor — throttle-olt
 *    `typing-start`, majd tétlenség után `typing-stop`.
 *
 * Socket nélkül teljesen passzív (no-op + null label).
 */
export function useTypingIndicator({
  socket,
  isConnected,
  conversation,
  currentUserId,
  peerName,
}: Options) {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const expiryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // A legfrissebb conversation a kimenő throttle/stop számára.
  const convRef = useRef<TypingConversation | null>(conversation);
  useEffect(() => {
    convRef.current = conversation;
  }, [conversation]);

  const matchesConversation = useCallback(
    (p: TypingPayload): boolean => {
      const c = conversation;
      if (!c) return false;
      if (c.groupId) return p.groupId === c.groupId;
      if (c.patientId) return p.patientId === c.patientId;
      if (c.recipientId) return !p.groupId && !p.patientId && p.userId === c.recipientId;
      return false;
    },
    [conversation],
  );

  // Beszélgetésváltáskor ürítünk.
  useEffect(() => {
    setTypingUserIds([]);
    expiryTimers.current.forEach((t) => clearTimeout(t));
    expiryTimers.current.clear();
  }, [conversation?.patientId, conversation?.groupId, conversation?.recipientId]);

  // Bejövő typing.
  useEffect(() => {
    if (!socket || !isConnected) return;

    const onTyping = (payload: TypingPayload) => {
      if (payload.userId === currentUserId) return;
      if (!matchesConversation(payload)) return;

      const timers = expiryTimers.current;
      const existing = timers.get(payload.userId);
      if (existing) clearTimeout(existing);

      if (payload.typing) {
        setTypingUserIds((prev) => (prev.includes(payload.userId) ? prev : [...prev, payload.userId]));
        timers.set(
          payload.userId,
          setTimeout(() => {
            setTypingUserIds((prev) => prev.filter((id) => id !== payload.userId));
            timers.delete(payload.userId);
          }, EXPIRE_MS),
        );
      } else {
        setTypingUserIds((prev) => prev.filter((id) => id !== payload.userId));
        timers.delete(payload.userId);
      }
    };

    socket.on('typing', onTyping);
    return () => {
      socket.off('typing', onTyping);
    };
  }, [socket, isConnected, currentUserId, matchesConversation]);

  // Kimenő typing — throttle + auto-stop.
  const isTypingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = useCallback(
    (typing: boolean) => {
      const c = convRef.current;
      if (!socket || !isConnected || !c) return;
      const event = typing ? 'typing-start' : 'typing-stop';
      socket.emit(event, {
        patientId: c.patientId ?? undefined,
        groupId: c.groupId ?? undefined,
        recipientId: c.recipientId ?? undefined,
      });
    },
    [socket, isConnected],
  );

  const notifyTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      emit(true);
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      emit(false);
    }, STOP_AFTER_MS);
  }, [emit]);

  // Lebontáskor / beszélgetésváltáskor küldjünk stop-ot, ha gépeltünk.
  useEffect(() => {
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        emit(false);
      }
    };
  }, [conversation?.patientId, conversation?.groupId, conversation?.recipientId, emit]);

  const typingLabel =
    typingUserIds.length === 0
      ? null
      : peerName
        ? `${peerName} gépel…`
        : typingUserIds.length === 1
          ? 'gépel…'
          : 'többen gépelnek…';

  return { typingUserIds, typingLabel, notifyTyping };
}
