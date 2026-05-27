'use client';

import { useState, useEffect } from 'react';
import { DoctorMessage, DoctorConversation } from '@/lib/types';
import { getCurrentUser } from '@/lib/auth';
import { useToast } from '@/contexts/ToastContext';
import type { Socket } from 'socket.io-client';
import { useReplyState, type ReplyState } from '@/components/messaging/useReplyState';
import { buildQuotedMessagePreview } from '@/lib/message-reply';
import type { QuotedMessagePreview, MessageDeliveryStatusEvent } from '@/lib/types/messaging';
import {
  applyDeliveryStatusUpdate,
  isDoctorDirectDeliveryEvent,
  isDoctorGroupDeliveryEvent,
} from '@/components/messaging/delivery-status-socket';
import { incrementParentReplyCount } from '@/components/messaging/reply-count-socket';

export interface Doctor {
  id: string;
  name: string;
  email: string;
  intezmeny: string | null;
}

export interface GroupParticipant {
  userId: string;
  userName: string;
  userEmail: string;
}

interface UseDoctorMessagesOptions {
  socket: Socket | null;
  isConnected: boolean;
}

export interface UseDoctorMessagesReturn {
  conversations: DoctorConversation[];
  messages: DoctorMessage[];
  doctors: Doctor[];
  groupParticipants: GroupParticipant[];
  unreadCount: number;
  currentUserId: string | null;
  isGroupCreator: boolean;

  selectedDoctorId: string | null;
  selectedDoctorName: string | null;
  selectedGroupId: string | null;
  selectedGroupName: string | null;

  loading: boolean;
  sending: boolean;
  deletingGroup: boolean;
  pendingMessageId: string | null;

  /**
   * Reply state (Slice 0.5). A hook saját maga birtokolja a `replyTarget`-et
   * — a komponens a `replyState.setReplyTarget(...)`-val állítja be (a
   * buborékon a „Válasz” gomb), és a hook `sendMessage`-e automatikusan
   * beleszerkeszti a POST body-jába a `replyToMessageId`-t, majd sikeres
   * küldés után törli.
   */
  replyState: ReplyState;
  /** Kényelmi setter: meglévő `DoctorMessage`-ből épít `QuotedMessagePreview`-t. */
  startReplyTo: (message: DoctorMessage) => void;

  selectDoctor: (doctorId: string, doctorName: string) => void;
  selectGroup: (groupId: string, groupName: string | null) => void;
  clearSelection: () => void;
  sendMessage: (text: string) => Promise<boolean>;
  createGroupConversation: (participantIds: string[]) => Promise<{ groupId: string } | null>;
  renameGroup: (newName: string) => Promise<boolean>;
  deleteGroup: () => Promise<boolean>;
  refreshConversations: () => Promise<void>;
  refreshGroupParticipants: () => Promise<void>;
  setSelectedGroupName: React.Dispatch<React.SetStateAction<string | null>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useDoctorMessages({ socket, isConnected }: UseDoctorMessagesOptions): UseDoctorMessagesReturn {
  const { showToast } = useToast();

  // ── Data state ──────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<DoctorConversation[]>([]);
  const [messages, setMessages] = useState<DoctorMessage[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isGroupCreator, setIsGroupCreator] = useState(false);

  // ── Selection state ─────────────────────────────────────────────────
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDoctorName, setSelectedDoctorName] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);

  // ── Loading state ───────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);

  // ── Reply state (Slice 0.5) ─────────────────────────────────────────
  const replyState = useReplyState();

  /**
   * Egy meglévő `DoctorMessage` row-ból azonnal `replyTarget` lesz. A
   * preview szöveg-csonkolás megegyezik a szerver oldalival (lásd
   * `lib/message-reply.buildQuotedMessagePreview`), így a saját és server-
   * generált preview vizuálisan azonos.
   */
  const startReplyTo = (message: DoctorMessage) => {
    const quote: QuotedMessagePreview = buildQuotedMessagePreview({
      id: message.id,
      channel: 'doctor',
      senderId: message.senderId,
      senderName: message.senderName ?? null,
      message: message.message,
      createdAt: message.createdAt,
    });
    replyState.setReplyTarget(quote);
  };

  // ── Fetch helpers ───────────────────────────────────────────────────

  const fetchConversations = async () => {
    try {
      const response = await fetch('/api/doctor-messages?conversations=true', {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Hiba a konverzációk betöltésekor');
      }

      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (error) {
      console.error('Hiba a konverzációk betöltésekor:', error);
      showToast('Hiba történt a konverzációk betöltésekor', 'error');
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const response = await fetch('/api/doctor-messages/unread-count', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az olvasatlan üzenetek számának lekérdezésekor');
      }

      const data = await response.json();
      setUnreadCount(data.count || 0);
    } catch (error) {
      console.error('Hiba az olvasatlan üzenetek számának lekérdezésekor:', error);
    }
  };

  const fetchMessages = async () => {
    if (!selectedDoctorId) return;

    try {
      const response = await fetch(`/api/doctor-messages?recipientId=${selectedDoctorId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      const msgs = (data.messages || []) as DoctorMessage[];
      setMessages(msgs.filter((m: DoctorMessage) => !m.pending));

      if (currentUserId) {
        setTimeout(() => {
          const unreadMessages = msgs.filter(m => {
            if (m.pending || m.id.startsWith('pending-')) return false;
            if (!UUID_RE.test(m.id)) return false;
            return m.recipientId === currentUserId && !m.readAt;
          });

          if (unreadMessages.length > 0) {
            unreadMessages.forEach(msg => {
              fetch(`/api/doctor-messages/${msg.id}/read`, {
                method: 'PUT',
                credentials: 'include',
              }).catch(err => console.error(`Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err));
            });

            setMessages(prevMessages =>
              prevMessages.map(m =>
                unreadMessages.some(um => um.id === m.id)
                  ? { ...m, readAt: new Date() }
                  : m
              )
            );
          }
        }, 300);
      }
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupMessages = async () => {
    if (!selectedGroupId) return;

    try {
      const response = await fetch(`/api/doctor-messages?groupId=${selectedGroupId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a csoportos beszélgetés üzeneteinek betöltésekor');
      }

      const data = await response.json();
      const msgs = (data.messages || []) as DoctorMessage[];
      const filteredMessages = msgs.filter((m: DoctorMessage) => !m.pending);
      setMessages(filteredMessages);

      if (currentUserId) {
        setTimeout(() => {
          const unreadMessages = filteredMessages.filter(m => {
            if (m.pending || m.id.startsWith('pending-')) return false;
            if (!UUID_RE.test(m.id)) return false;
            const isUnread = m.senderId !== currentUserId &&
                   (!m.readBy || m.readBy.length === 0 || !m.readBy.some(r => r.userId === currentUserId));
            return isUnread;
          });

          if (unreadMessages.length > 0) {
            setMessages(prevMessages =>
              prevMessages.map(m => {
                const isUnread = unreadMessages.some(um => um.id === m.id);
                if (!isUnread) return m;

                const alreadyRead = m.readBy?.some(r => r.userId === currentUserId);
                if (alreadyRead) return m;

                return {
                  ...m,
                  readBy: [
                    ...(m.readBy || []),
                    {
                      userId: currentUserId,
                      userName: null,
                      readAt: new Date(),
                    }
                  ]
                };
              })
            );

            Promise.all(
              unreadMessages.map(msg => {
                return fetch(`/api/doctor-messages/${msg.id}/read`, {
                  method: 'PUT',
                  credentials: 'include',
                })
                .then(async (response) => {
                  if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                  }

                  const refreshResponse = await fetch(`/api/doctor-messages?groupId=${selectedGroupId}`, {
                    credentials: 'include',
                  });
                  if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    const updatedMessage = refreshData.messages?.find((m: DoctorMessage) => m.id === msg.id);
                    if (updatedMessage) {
                      setMessages(prevMessages =>
                        prevMessages.map(m =>
                          m.id === msg.id ? updatedMessage : m
                        )
                      );
                    }
                  }
                })
                .catch(err => {
                  console.error(`[DoctorMessages] Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
                  setMessages(prevMessages =>
                    prevMessages.map(m => {
                      if (m.id !== msg.id) return m;
                      return {
                        ...m,
                        readBy: m.readBy?.filter(r => r.userId !== currentUserId) || []
                      };
                    })
                  );
                });
              })
            );
          }
        }, 300);
      }
    } catch (error) {
      console.error('Hiba a csoportos beszélgetés üzeneteinek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupParticipants = async () => {
    if (!selectedGroupId) return;

    try {
      const response = await fetch(`/api/doctor-messages/groups/${selectedGroupId}/participants`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a résztvevők betöltésekor');
      }

      const data = await response.json();
      setGroupParticipants(data.participants || []);

      if (data.createdBy && currentUserId) {
        setIsGroupCreator(data.createdBy === currentUserId);
      } else {
        setIsGroupCreator(false);
      }
    } catch (error) {
      console.error('Hiba a résztvevők betöltésekor:', error);
      setIsGroupCreator(false);
    }
  };

  const fetchDoctors = async () => {
    try {
      const response = await fetch('/api/users/doctors', {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Hiba az orvosok betöltésekor');
      }

      const data = await response.json();
      setDoctors(data.doctors || []);
    } catch (error) {
      console.error('Hiba az orvosok betöltésekor:', error);
      showToast('Hiba történt az orvosok betöltésekor', 'error');
    }
  };

  // ── Effects ─────────────────────────────────────────────────────────

  // Initial load + 30-second polling
  useEffect(() => {
    const loadData = async () => {
      const user = await getCurrentUser();
      if (!user || !user.id) {
        setLoading(false);
        return;
      }

      await fetchConversations();
      await fetchUnreadCount();
      setLoading(false);
    };
    loadData();

    // Slice 0.7: polling lefojtva 120s safety netre — a primer kézbesítés
    // a Socket.io `new-doctor-message` / `doctor-message-read` eseményekből
    // jön (lásd lentebb a subscribe useEffect-ben).
    const interval = setInterval(async () => {
      fetchConversations();
      fetchUnreadCount();
      if (selectedDoctorId) {
        fetchMessages();
      } else if (selectedGroupId) {
        fetchGroupMessages();
      }
    }, 120_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctorId, selectedGroupId]);

  // Fetch messages when doctor/group selection changes
  useEffect(() => {
    if (selectedDoctorId) {
      setSelectedGroupId(null);
      setSelectedGroupName(null);
      setGroupParticipants([]);
      fetchMessages();
    } else if (selectedGroupId) {
      setSelectedDoctorId(null);
      setSelectedDoctorName(null);
      fetchGroupMessages();
      fetchGroupParticipants();
    } else {
      setMessages([]);
    }
    // Reply target conversation-specific — másik szálra váltáskor ne
    // szivárogjon át a kiválasztott idézet.
    replyState.clearReply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctorId, selectedGroupId]);

  // Fetch doctors list + identify current user on mount
  useEffect(() => {
    fetchDoctors();
    const loadCurrentUser = async () => {
      const user = await getCurrentUser();
      if (user && user.id) {
        setCurrentUserId(user.id);
      }
    };
    loadCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-mark messages as read when a conversation is open
  useEffect(() => {
    if (!currentUserId || loading || messages.length === 0) return;
    if (!selectedDoctorId && !selectedGroupId) return;

    const timeoutId = setTimeout(() => {
      const unreadMessages = messages.filter(m => {
        if (m.pending || m.id.startsWith('pending-')) return false;
        if (!UUID_RE.test(m.id)) return false;

        if (selectedDoctorId && !selectedGroupId) {
          return m.recipientId === currentUserId && !m.readAt;
        }

        if (selectedGroupId) {
          return m.senderId !== currentUserId &&
            (!m.readBy || m.readBy.length === 0 || !m.readBy.some(r => r.userId === currentUserId));
        }

        return false;
      });

      if (unreadMessages.length > 0) {
        // Optimistic update
        setMessages(prevMessages =>
          prevMessages.map(m => {
            const isUnread = unreadMessages.some(um => um.id === m.id);
            if (!isUnread) return m;

            if (selectedGroupId) {
              const alreadyRead = m.readBy?.some(r => r.userId === currentUserId);
              if (alreadyRead) return m;

              return {
                ...m,
                readBy: [
                  ...(m.readBy || []),
                  {
                    userId: currentUserId,
                    userName: null,
                    readAt: new Date(),
                  }
                ]
              };
            } else {
              return { ...m, readAt: new Date() };
            }
          })
        );

        // Fire API calls in parallel
        Promise.all(
          unreadMessages.map(msg => {
            return fetch(`/api/doctor-messages/${msg.id}/read`, {
              method: 'PUT',
              credentials: 'include',
            })
            .then(async (response) => {
              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
              }

              if (selectedGroupId) {
                const resp = await fetch(`/api/doctor-messages?groupId=${selectedGroupId}`, {
                  credentials: 'include',
                });
                if (resp.ok) {
                  const data = await resp.json();
                  const updatedMessage = data.messages?.find((m: DoctorMessage) => m.id === msg.id);
                  if (updatedMessage) {
                    setMessages(prevMessages =>
                      prevMessages.map(m =>
                        m.id === msg.id ? updatedMessage : m
                      )
                    );
                  }
                }
              }
            })
            .catch(err => {
              console.error(`[DoctorMessages] Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
              // Rollback optimistic update
              setMessages(prevMessages =>
                prevMessages.map(m => {
                  if (m.id !== msg.id) return m;

                  if (selectedGroupId) {
                    return {
                      ...m,
                      readBy: m.readBy?.filter(r => r.userId !== currentUserId) || []
                    };
                  } else {
                    return { ...m, readAt: null };
                  }
                })
              );
            });
          })
        );
      }
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctorId, selectedGroupId, loading, currentUserId, messages.length]);

  // WebSocket: listen for doctor-message-read events (group + 1:1 from 0.7).
  useEffect(() => {
    if (!socket || !isConnected) return;
    if (!selectedGroupId && !selectedDoctorId) return;

    const handleDoctorMessageRead = (data: { messageId: string; groupId: string | null; userId: string; userName: string | null }) => {
      // Group eset: csak a saját szálban érdekel.
      if (data.groupId && data.groupId !== selectedGroupId) return;
      // 1:1 eset: csak akkor érdekel, ha jelenleg ezzel az orvossal beszélünk
      // (a `user:{me}` szobába jön ide, de a kontextus elveszik a payloadban;
      // ezért az aktuálisan kiválasztott 1:1 messages listáján futtatunk
      // map-et — ha nincs egyezés, no-op).
      if (!data.groupId && !selectedDoctorId) return;

      setMessages(prevMessages =>
        prevMessages.map(m => {
          if (m.id !== data.messageId) return m;
          if (data.groupId) {
            const existingReadBy = m.readBy || [];
            if (existingReadBy.some(r => r.userId === data.userId)) return m;
            const readBy = [
              ...existingReadBy,
              {
                userId: data.userId,
                userName: data.userName,
                readAt: new Date(),
              },
            ];
            return {
              ...m,
              readBy,
              deliveryStatus: 'delivered' as const,
            };
          }
          // 1:1: a feladó UI-ja kapja meg, frissítjük readAt-ot + deliveryStatus.
          return {
            ...m,
            readAt: m.readAt ?? new Date(),
            deliveryStatus: 'read',
          };
        })
      );
    };

    socket.on('doctor-message-read', handleDoctorMessageRead);

    if (selectedGroupId) {
      socket.emit('join-room', { groupId: `doctor-group:${selectedGroupId}` });
    }

    return () => {
      socket.off('doctor-message-read', handleDoctorMessageRead);
      if (selectedGroupId) {
        socket.emit('leave-room', { groupId: `doctor-group:${selectedGroupId}` });
      }
    };
  }, [socket, isConnected, selectedGroupId, selectedDoctorId]);

  // Slice 0.7: élő new-doctor-message kézbesítés. A `user:{me}` szobához a
  // szerver auto-joinol, group szobához a fenti effect csatlakoztat.
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleNewDoctorMessage = (data: { message: DoctorMessage; groupId: string | null }) => {
      const msg = data.message;
      if (!msg || !msg.id) return;
      if (msg.senderId === currentUserId) {
        // A saját pending üzenetet a POST callback már lecserélte —
        // duplikációt elkerülünk.
        return;
      }

      if (data.groupId) {
        // Group: csak ha jelenleg a megfelelő szálban vagyunk.
        if (data.groupId !== selectedGroupId) {
          fetchConversations();
          fetchUnreadCount();
          return;
        }
      } else {
        // 1:1: csak ha jelenleg a feladóval beszélünk.
        if (!selectedDoctorId || msg.senderId !== selectedDoctorId) {
          fetchConversations();
          fetchUnreadCount();
          return;
        }
      }

      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        const withNew = [
          ...prev,
          {
            ...msg,
            createdAt: new Date(msg.createdAt),
            readAt: msg.readAt ? new Date(msg.readAt) : null,
          },
        ];
        return incrementParentReplyCount(withNew, msg.replyToMessageId);
      });
    };

    socket.on('new-doctor-message', handleNewDoctorMessage);
    return () => {
      socket.off('new-doctor-message', handleNewDoctorMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, selectedGroupId, selectedDoctorId, currentUserId]);

  // Fázis 2: realtime deliveryStatus (delivered / read) a küldő bubble-ön.
  useEffect(() => {
    if (!socket || !isConnected) return;
    if (!selectedGroupId && !selectedDoctorId) return;

    const handleDeliveryStatus = (event: MessageDeliveryStatusEvent) => {
      if (event.channel !== 'doctor') return;
      if (event.groupId) {
        if (!isDoctorGroupDeliveryEvent(event, selectedGroupId)) return;
      } else if (!isDoctorDirectDeliveryEvent(event, selectedDoctorId)) {
        return;
      }

      setMessages((prev) => applyDeliveryStatusUpdate(prev, event));
    };

    socket.on('message-delivery-status', handleDeliveryStatus);
    return () => {
      socket.off('message-delivery-status', handleDeliveryStatus);
    };
  }, [socket, isConnected, selectedGroupId, selectedDoctorId]);

  // ── Actions ─────────────────────────────────────────────────────────

  const selectDoctor = (doctorId: string, doctorName: string) => {
    setSelectedDoctorId(doctorId);
    setSelectedDoctorName(doctorName);
    setSelectedGroupId(null);
    setSelectedGroupName(null);
    setGroupParticipants([]);
    setLoading(true);
  };

  const selectGroup = (groupId: string, groupName: string | null) => {
    setSelectedGroupId(groupId);
    setSelectedGroupName(groupName);
    setSelectedDoctorId(null);
    setSelectedDoctorName(null);
    setLoading(true);
  };

  const clearSelection = () => {
    setSelectedDoctorId(null);
    setSelectedDoctorName(null);
    setSelectedGroupId(null);
    setSelectedGroupName(null);
    setGroupParticipants([]);
    setMessages([]);
  };

  const sendMessage = async (text: string): Promise<boolean> => {
    if (!text.trim() || (!selectedDoctorId && !selectedGroupId)) return false;

    const replyTargetSnapshot = replyState.replyTarget;
    const replyToMessageId = replyTargetSnapshot?.id ?? null;

    // Slice 0.8: kliens-oldali idempotencia kulcs. A `pending-` prefix
    // miatt a meglévő `.startsWith('pending-')` szűrők (auto-read effect,
    // fetchMessages) változatlanul működnek; a szerver `(sender_id,
    // client_message_id)` UNIQUE kulcsa biztosítja, hogy a retry NEM
    // duplikál.
    const randomPart = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempId = `pending-${randomPart}`;

    try {
      setSending(true);

      const pendingMessage: DoctorMessage = {
        id: tempId,
        senderId: currentUserId || '',
        recipientId: selectedDoctorId || '',
        senderEmail: '',
        senderName: null,
        subject: null,
        message: text,
        readAt: null,
        createdAt: new Date(),
        pending: true,
        replyToMessageId,
        quotedMessage: replyTargetSnapshot ?? null,
      };

      setMessages(prev => [...prev, pendingMessage]);
      setPendingMessageId(tempId);

      const response = await fetch('/api/doctor-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recipientId: selectedDoctorId || undefined,
          groupId: selectedGroupId || undefined,
          subject: null,
          message: text,
          replyToMessageId,
          clientMessageId: tempId,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setPendingMessageId(null);

        if (response.status === 429) {
          // Slice 0.8: rate limit — failed bubble megmarad újraküldés-gombbal.
          // A tempId UNIQUE-kulcsa garantálja, hogy az újraküldés nem duplikál.
          showToast(error.error || 'Túl sok üzenet — próbáld újra később.', 'error');
          return false;
        }

        // Bármilyen más hiba esetén eltakarítjuk a pending buborékot.
        setMessages(prev => prev.filter(m => m.id !== tempId));
        throw new Error(error.error || 'Hiba az üzenet küldésekor');
      }

      const data = await response.json();

      setMessages(prev =>
        prev.map(m => m.id === tempId ? { ...data.message, pending: false } : m)
      );
      setPendingMessageId(null);
      replyState.clearReply();

      showToast('Üzenet sikeresen elküldve', 'success');

      setTimeout(() => {
        if (selectedDoctorId) {
          fetchMessages();
        } else if (selectedGroupId) {
          fetchGroupMessages();
        }
        fetchConversations();
      }, 500);

      return true;
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
      return false;
    } finally {
      setSending(false);
    }
  };

  const createGroupConversation = async (participantIds: string[]): Promise<{ groupId: string } | null> => {
    try {
      setLoading(true);
      const response = await fetch('/api/doctor-messages/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          participantIds,
          name: null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba a csoportos beszélgetés létrehozásakor');
      }

      const data = await response.json();
      showToast('Csoportos beszélgetés létrehozva', 'success');
      return { groupId: data.groupId };
    } catch (error: any) {
      console.error('Hiba a beszélgetés indításakor:', error);
      showToast(error.message || 'Hiba történt a beszélgetés indításakor', 'error');
      setLoading(false);
      return null;
    }
  };

  const renameGroup = async (newName: string): Promise<boolean> => {
    if (!selectedGroupId) return false;

    try {
      const response = await fetch(`/api/doctor-messages/groups/${selectedGroupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newName.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba a csoportos beszélgetés átnevezésekor');
      }

      setSelectedGroupName(newName.trim() || null);
      showToast('Csoportos beszélgetés átnevezve', 'success');
      fetchConversations();
      return true;
    } catch (error: any) {
      console.error('Hiba a csoportos beszélgetés átnevezésekor:', error);
      showToast(error.message || 'Hiba történt a csoportos beszélgetés átnevezésekor', 'error');
      return false;
    }
  };

  const deleteGroup = async (): Promise<boolean> => {
    if (!selectedGroupId) return false;

    try {
      setDeletingGroup(true);
      const response = await fetch(`/api/doctor-messages/groups/${selectedGroupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba a csoportos beszélgetés törlésekor');
      }

      showToast('Csoportos beszélgetés törölve', 'success');
      setSelectedGroupId(null);
      setSelectedGroupName(null);
      setGroupParticipants([]);
      setMessages([]);
      fetchConversations();
      return true;
    } catch (error: any) {
      console.error('Hiba a csoportos beszélgetés törlésekor:', error);
      showToast(error.message || 'Hiba történt a csoportos beszélgetés törlésekor', 'error');
      return false;
    } finally {
      setDeletingGroup(false);
    }
  };

  // ── Return ──────────────────────────────────────────────────────────

  return {
    conversations,
    messages,
    doctors,
    groupParticipants,
    unreadCount,
    currentUserId,
    isGroupCreator,

    selectedDoctorId,
    selectedDoctorName,
    selectedGroupId,
    selectedGroupName,

    loading,
    sending,
    deletingGroup,
    pendingMessageId,

    replyState,
    startReplyTo,

    selectDoctor,
    selectGroup,
    clearSelection,
    sendMessage,
    createGroupConversation,
    renameGroup,
    deleteGroup,
    refreshConversations: fetchConversations,
    refreshGroupParticipants: fetchGroupParticipants,
    setSelectedGroupName,
  };
}
