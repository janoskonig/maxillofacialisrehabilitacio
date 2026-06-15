'use client';

import { useState, useEffect, useRef, useCallback, useMemo, type RefObject } from 'react';
import { MessageCircle, Search, User, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { MessageTextRenderer } from './MessageTextRenderer';
import { useSocket } from '@/contexts/SocketContext';
import { MessagesShell } from './mobile/MessagesShell';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { type ChatBubbleMessage } from './messaging/ChatMessageBubble';
import { Avatar } from './messaging/Avatar';
import { MessageThread } from './messaging/MessageThread';
import { MessageComposer } from './messaging/MessageComposer';
import { ConversationList, type ConversationVM } from './messaging/ConversationList';
import { ReplyComposerBar } from './messaging/ReplyComposerBar';
import { useReplyState } from './messaging/useReplyState';
import { buildQuotedMessagePreview } from '@/lib/message-reply';
import type { QuotedMessagePreview, MessageDeliveryStatusEvent } from '@/lib/types/messaging';
import {
  applyDeliveryStatusUpdate,
  isPatientChannelDeliveryEvent,
} from './messaging/delivery-status-socket';
import { incrementParentReplyCount } from './messaging/reply-count-socket';
import { useReplyThreadCollapse } from './messaging/useReplyThreadCollapse';
import { filterMessagesByThreadCollapse } from '@/lib/messaging/reply-thread-visibility';
import { DocumentLinkComposerButton } from './messaging/DocumentLinkComposerButton';
import { ContextLinkComposerButton } from './messaging/ContextLinkComposerButton';
import { PendingContextLinksBar } from './messaging/PendingContextLinksBar';
import type { PendingContextLink } from './messaging/ContextLinkAttachPicker';
import { useMessageContextActions } from '@/hooks/useMessageContextActions';
import type { MessageContextLink, MessageSearchHit } from '@/lib/types/messaging';
import { MessageSearchButton } from './messaging/MessageSearchButton';
import { useRegisterMessageSearch } from '@/hooks/useRegisterMessageSearch';
import type { MessageSearchHandler } from '@/contexts/MessageSearchContext';

interface Message {
  id: string;
  patientId: string;
  senderType: 'doctor' | 'patient';
  senderId: string;
  senderEmail: string;
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
  pending?: boolean;
  replyToMessageId?: string | null;
  quotedMessage?: QuotedMessagePreview | null;
  replyCount?: number;
  deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  contextLinks?: MessageContextLink[];
}

interface Patient {
  id: string;
  nev: string;
  email: string | null;
}

interface Conversation {
  patientId: string;
  patientName: string;
  lastMessage: Message | null;
  unreadCount: number;
}

export function PatientMessagesList() {
  const router = useRouter();
  const { showToast } = useToast();
  const { socket, isConnected, joinRoom, leaveRoom } = useSocket();
  
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPatientSelector, setShowPatientSelector] = useState(false);
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [availablePatients, setAvailablePatients] = useState<Patient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesLoadedRef = useRef<Set<string>>(new Set());
  // A conversations legfrissebb pillanatképe a socket-handlerek számára (renderfüggetlen).
  const conversationsRef = useRef<Conversation[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pendingContextLinks, setPendingContextLinks] = useState<PendingContextLink[]>([]);
  const { attachLink, removeLink } = useMessageContextActions('patient');

  // Hooks must be called unconditionally at the top level
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  // Slice 0.6: reply state — staff inbox (több beteg-szál, váltáskor reset).
  const replyState = useReplyState();

  useEffect(() => {
    replyState.clearReply();
    setPendingContextLinks([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatientId]);

  const startReplyTo = useCallback((message: Message) => {
    const quote: QuotedMessagePreview = buildQuotedMessagePreview({
      id: message.id,
      channel: 'patient',
      senderId: message.senderId,
      senderName: message.senderType === 'doctor'
        ? message.senderEmail || 'Orvos'
        : selectedPatientName || 'Beteg',
      message: message.message,
      createdAt: message.createdAt,
    });
    replyState.setReplyTarget(quote);
    textareaRef.current?.focus();
  }, [selectedPatientName, replyState]);

  const scrollToMessage = useCallback((messageId: string): boolean => {
    const el = messagesContainerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`,
    );
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-blue-400', 'rounded-lg');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-blue-400', 'rounded-lg');
    }, 1600);
    return true;
  }, []);

  const scrollToFirstReply = useCallback(
    (parentId: string) => {
      const firstReply = messages.find((m) => m.replyToMessageId === parentId);
      if (firstReply) scrollToMessage(firstReply.id);
    },
    [messages, scrollToMessage],
  );

  const { collapsedRoots, isCollapsed, toggleThread, resetThreads } = useReplyThreadCollapse();
  const visibleMessages = useMemo(
    () => filterMessagesByThreadCollapse(messages, collapsedRoots),
    [messages, collapsedRoots],
  );
  const handleReplyThreadToggle = useCallback(
    (parentId: string) => {
      const wasCollapsed = isCollapsed(parentId);
      toggleThread(parentId);
      if (wasCollapsed) scrollToFirstReply(parentId);
    },
    [isCollapsed, toggleThread, scrollToFirstReply],
  );

  const messageById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Gépel-indikátor (a beteg szálban). Jelenlét nincs — a beteg nem staff.
  const typingConversation = useMemo(
    () => (selectedPatientId ? { patientId: selectedPatientId } : null),
    [selectedPatientId],
  );
  const { typingLabel, notifyTyping } = useTypingIndicator({
    socket,
    isConnected,
    conversation: typingConversation,
    currentUserId,
    peerName: selectedPatientName,
  });

  // Csatorna-független buborék-shape. Orvos üzenetei JOBBRA (saját), beteg BALRA.
  const bubbleMessages = useMemo<ChatBubbleMessage[]>(
    () =>
      visibleMessages.map((message) => {
        const isFromMe = currentUserId
          ? message.senderType === 'doctor' && message.senderId === currentUserId
          : message.senderType === 'doctor';
        const isPending = message.pending === true;
        const isFailed = message.deliveryStatus === 'failed';
        const senderName = isFromMe
          ? message.senderEmail || 'Én'
          : selectedPatientName || 'Beteg';

        return {
          id: message.id,
          message: message.message,
          createdAt: message.createdAt,
          senderId: message.senderId,
          senderName,
          isFromMe,
          replyToMessageId: message.replyToMessageId ?? null,
          quotedMessage: message.quotedMessage ?? null,
          replyCount: message.replyCount ?? 0,
          deliveryStatus: isPending
            ? 'pending'
            : isFailed
              ? 'failed'
              : message.deliveryStatus ?? (message.readAt ? 'read' : 'sent'),
          readAt: message.readAt ?? null,
          contextLinks: message.contextLinks ?? [],
        };
      }),
    [visibleMessages, currentUserId, selectedPatientName],
  );

  useEffect(() => {
    resetThreads();
  }, [selectedPatientId, resetThreads]);

  // Get current user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        if (user && user.id) {
          setCurrentUserId(user.id);
        }
      } catch (error) {
        console.error('Hiba a felhasználó betöltésekor:', error);
      }
    };
    fetchUser();
  }, []);

  // Fetch conversations via single batch API call
  const fetchConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/messages/conversations', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a konverzációk betöltésekor');
      }

      const data = await response.json();
      const conversationsList: Conversation[] = (data.conversations || []).map((c: any) => ({
        patientId: c.patientId,
        patientName: c.patientName,
        lastMessage: c.lastMessage
          ? {
              id: c.lastMessage.id,
              patientId: c.lastMessage.patientId,
              senderType: c.lastMessage.senderType,
              senderId: c.lastMessage.senderId,
              senderEmail: c.lastMessage.senderEmail,
              subject: c.lastMessage.subject,
              message: c.lastMessage.message,
              readAt: c.lastMessage.readAt ? new Date(c.lastMessage.readAt) : null,
              createdAt: new Date(c.lastMessage.createdAt),
            }
          : null,
        unreadCount: c.unreadCount ?? 0,
      }));

      setConversations(conversationsList);
    } catch (error) {
      console.error('Hiba a konverzációk betöltésekor:', error);
      showToast('Hiba történt a konverzációk betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // conversationsRef szinkronban tartása (a socket-handlerek a ref-et olvassák).
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Célzott, lokális frissítés bejövő üzenetnél — teljes refetch helyett.
  // Csak akkor esik vissza teljes újratöltésre, ha a beszélgetés még ismeretlen (új szál).
  const applyIncomingMessageToConversations = useCallback(
    (message: Message, patientId: string, isActiveConversation: boolean) => {
      const known = conversationsRef.current.some((c) => c.patientId === patientId);
      if (!known) {
        fetchConversations();
        return;
      }
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.patientId === patientId);
        if (idx === -1) return prev;
        const existing = prev[idx];
        const incrementUnread =
          !isActiveConversation && message.senderType === 'patient' && !message.readAt;
        const updated: Conversation = {
          ...existing,
          lastMessage: message,
          unreadCount: incrementUnread ? existing.unreadCount + 1 : existing.unreadCount,
        };
        // A frissített beszélgetés a lista tetejére kerül (mint a szerver rendezése).
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    },
    [fetchConversations],
  );

  // Fetch available patients for new chat
  const fetchAvailablePatients = useCallback(async () => {
    if (!showPatientSelector) return;
    
    setLoadingPatients(true);
    try {
      const response = await fetch('/api/patients?limit=1000', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a betegek betöltésekor');
      }

      const data = await response.json();
      const patientsWithEmail = (data.patients || []).filter(
        (p: Patient) => p.email && p.email.trim() !== ''
      );
      setAvailablePatients(patientsWithEmail);
    } catch (error) {
      console.error('Hiba a betegek betöltésekor:', error);
      showToast('Hiba történt a betegek betöltésekor', 'error');
    } finally {
      setLoadingPatients(false);
    }
  }, [showPatientSelector, showToast]);

  // Fetch patients when selector is shown
  useEffect(() => {
    if (showPatientSelector) {
      fetchAvailablePatients();
    }
  }, [showPatientSelector, fetchAvailablePatients]);

  // Initial load
  useEffect(() => {
    fetchConversations();

    // Biztonsági poll a socket-frissítések mellé — de csak ha a fül látható,
    // így háttérben nincs felesleges hálózati/CPU terhelés.
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchConversations();
      if (selectedPatientId) {
        fetchMessages(selectedPatientId);
      }
    }, 15_000);

    return () => clearInterval(interval);
  }, [fetchConversations]);

  // Fetch messages for selected patient
  const fetchMessages = useCallback(async (patientId: string) => {
    if (!patientId) return;

    setLoadingMessages(true);
    try {
      const response = await fetch(`/api/messages?patientId=${patientId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      const loadedMessages = (data.messages || []).reverse() as Message[];
      
      loadedMessages.forEach(msg => messagesLoadedRef.current.add(msg.id));
      
      setMessages(loadedMessages);
      
      const unread = loadedMessages.filter(
        (m: Message) => m.senderType === 'patient' && !m.readAt
      ).length;
      setUnreadCount(unread);
      
      // Automatikusan jelöljük olvasottnak az olvasatlan beteg üzeneteket
      setTimeout(() => {
        const unreadPatientMessages = loadedMessages.filter(
          m => m.senderType === 'patient' && 
               !m.readAt && 
               !m.pending && 
               !m.id.startsWith('pending-') &&
               /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)
        );
        
        if (unreadPatientMessages.length > 0) {
          console.log('[PatientMessagesList] Auto-marking messages as read after fetch:', unreadPatientMessages.length);
          
          // Optimistic update
          setMessages(prevMessages => 
            prevMessages.map(m => 
              unreadPatientMessages.some(um => um.id === m.id) 
                ? { ...m, readAt: new Date() } 
                : m
            )
          );
          
          setUnreadCount(prev => Math.max(0, prev - unreadPatientMessages.length));
          
          // API hívások
          Promise.all(
            unreadPatientMessages.map(msg => {
              console.log('[PatientMessagesList] Marking message as read:', msg.id);
              return fetch(`/api/messages/${msg.id}/read`, {
                method: 'PUT',
                credentials: 'include',
              })
              .then(async (response) => {
                if (!response.ok) {
                  const errorData = await response.json().catch(() => ({}));
                  throw new Error(errorData.error || `HTTP ${response.status}`);
                }
                console.log('[PatientMessagesList] Message marked as read successfully:', msg.id);
              })
              .catch(err => {
                console.error(`[PatientMessagesList] Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
                // Revert on error
                setMessages(prevMessages => 
                  prevMessages.map(m => 
                    m.id === msg.id ? { ...m, readAt: null } : m
                  )
                );
                setUnreadCount(prev => prev + 1);
              });
            })
          ).then(() => {
            fetchConversations(); // Refresh conversations after marking as read
          });
        }
      }, 300);
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoadingMessages(false);
    }
  }, [showToast, fetchConversations]);

  // Load messages and setup WebSocket when patient selected
  useEffect(() => {
    if (selectedPatientId) {
      fetchMessages(selectedPatientId);
      
      if (isConnected) {
        joinRoom(selectedPatientId);
      }
      
      return () => {
        if (isConnected) {
          leaveRoom(selectedPatientId);
        }
      };
    } else {
      setMessages([]);
      messagesLoadedRef.current.clear();
    }
  }, [selectedPatientId, isConnected, joinRoom, leaveRoom, fetchMessages]);

  // WebSocket: Listen for new messages
  useEffect(() => {
    if (!socket || !selectedPatientId) return;

    const handleNewMessage = (data: { message: Message; patientId: string }) => {
      const normalizedMessage: Message = {
        ...data.message,
        createdAt: new Date(data.message.createdAt),
        readAt: data.message.readAt ? new Date(data.message.readAt) : null,
      };

      if (data.patientId !== selectedPatientId) {
        // Másik beteg szála: csak az érintett beszélgetést frissítjük lokálisan.
        applyIncomingMessageToConversations(normalizedMessage, data.patientId, false);
        return;
      }

      if (messagesLoadedRef.current.has(data.message.id)) {
        return;
      }

      messagesLoadedRef.current.add(data.message.id);

      setMessages(prev => {
        if (prev.some(m => m.id === data.message.id)) {
          return prev;
        }
        const withNew = [...prev, {
          ...data.message,
          createdAt: new Date(data.message.createdAt),
          readAt: data.message.readAt ? new Date(data.message.readAt) : null,
        }];
        return incrementParentReplyCount(withNew, data.message.replyToMessageId);
      });

      if (data.message.senderType === 'patient' && !data.message.readAt) {
        setUnreadCount(prev => prev + 1);
      }

      // A nyitott beszélgetés utolsó üzenetét lokálisan frissítjük (nincs hálózati kör).
      applyIncomingMessageToConversations(normalizedMessage, data.patientId, true);
    };

    const handleMessageRead = (data: { messageId: string; patientId: string }) => {
      if (data.patientId !== selectedPatientId) return;

      setMessages(prev =>
        prev.map(m =>
          m.id === data.messageId
            ? { ...m, readAt: new Date(), deliveryStatus: 'read' as const }
            : m
        )
      );

      setUnreadCount(prev => Math.max(0, prev - 1));
    };

    const handleDeliveryStatus = (event: MessageDeliveryStatusEvent) => {
      if (!selectedPatientId || !isPatientChannelDeliveryEvent(event, selectedPatientId)) return;
      setMessages((prev) => applyDeliveryStatusUpdate(prev, event));
    };

    socket.on('new-message', handleNewMessage);
    socket.on('message-read', handleMessageRead);
    socket.on('message-delivery-status', handleDeliveryStatus);

    return () => {
      socket.off('new-message', handleNewMessage);
      socket.off('message-read', handleMessageRead);
      socket.off('message-delivery-status', handleDeliveryStatus);
    };
  }, [socket, selectedPatientId, applyIncomingMessageToConversations]);

  // Auto-mark patient messages as read when conversation opens
  // Egyszerűbb és megbízhatóbb: amikor a beszélgetés megnyílik, jelöljük olvasottnak az összes olvasatlant
  useEffect(() => {
    if (messages.length === 0 || loadingMessages || !selectedPatientId) {
      console.log('[PatientMessagesList] Auto-mark skipped:', { loadingMessages, messagesLength: messages.length, selectedPatientId });
      return;
    }

    console.log('[PatientMessagesList] Auto-mark triggered:', { selectedPatientId, messagesCount: messages.length });

    // Várunk egy kicsit, hogy biztosan renderelődtek az üzenetek
    const timeoutId = setTimeout(() => {
      // Mark all unread patient messages as read immediately when loaded
      const unreadPatientMessages = messages.filter(
        m => m.senderType === 'patient' && 
             !m.readAt && 
             !m.pending && 
             !m.id.startsWith('pending-') &&
             /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)
      );
      
      console.log('[PatientMessagesList] Unread messages found:', unreadPatientMessages.length, unreadPatientMessages.map(m => ({ id: m.id, readAt: m.readAt })));
      
      if (unreadPatientMessages.length > 0) {
        // Mark as read optimistically
        setMessages(prevMessages => 
          prevMessages.map(m => 
            unreadPatientMessages.some(um => um.id === m.id) 
              ? { ...m, readAt: new Date() } 
              : m
          )
        );
        
        setUnreadCount(prev => Math.max(0, prev - unreadPatientMessages.length));
        
        // Send API requests to mark as read
        Promise.all(
          unreadPatientMessages.map(msg => {
            console.log('[PatientMessagesList] Marking message as read:', msg.id);
            return fetch(`/api/messages/${msg.id}/read`, {
              method: 'PUT',
              credentials: 'include',
            })
            .then(async (response) => {
              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
              }
              console.log('[PatientMessagesList] Message marked as read successfully:', msg.id);
            })
            .catch(err => {
              console.error(`[PatientMessagesList] Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
              // Revert on error
              setMessages(prevMessages => 
                prevMessages.map(m => 
                  m.id === msg.id ? { ...m, readAt: null } : m
                )
              );
              setUnreadCount(prev => prev + 1);
            });
          })
        ).then(() => {
          fetchConversations(); // Refresh conversations after marking as read
        });
      }
    }, 500); // 500ms delay, hogy biztosan renderelődtek az üzenetek

    return () => clearTimeout(timeoutId);
  }, [selectedPatientId, loadingMessages, messages.length, fetchConversations]);

  const postPatientMessage = useCallback(
    async (
      tempId: string,
      text: string,
      replyToMessageId: string | null,
      targetPatientId: string,
    ): Promise<string | null> => {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId: targetPatientId,
          subject: null,
          message: text,
          replyToMessageId,
          clientMessageId: tempId,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 429) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId ? { ...m, pending: false, deliveryStatus: 'failed' } : m,
            ),
          );
          showToast(error.error || 'Túl sok üzenet — próbáld újra később.', 'error');
          return null;
        }
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        throw new Error(error.error || 'Hiba az üzenet küldésekor');
      }

      const data = await response.json();
      if (data.message) {
        messagesLoadedRef.current.add(data.message.id);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...data.message,
                  createdAt: new Date(data.message.createdAt),
                  readAt: data.message.readAt ? new Date(data.message.readAt) : null,
                  pending: false,
                  contextLinks: data.message.contextLinks ?? [],
                }
              : m,
          ),
        );
        return data.message.id as string;
      }
      return null;
    },
    [showToast],
  );

  const handleSendMessage = async () => {
    const textToSend = newMessage.trim();
    if (!textToSend || !selectedPatientId) {
      showToast('Kérjük, válasszon beteget és írjon üzenetet', 'error');
      return;
    }

    const replyTargetSnapshot = replyState.replyTarget;
    const replyToMessageId = replyTargetSnapshot?.id ?? null;

    const randomPart =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempId = `pending-${randomPart}`;

    try {
      setSending(true);

      const pendingMessage: Message = {
        id: tempId,
        patientId: selectedPatientId,
        senderType: 'doctor',
        senderId: currentUserId || '',
        senderEmail: '',
        subject: null,
        message: textToSend,
        readAt: null,
        createdAt: new Date(),
        pending: true,
        replyToMessageId,
        quotedMessage: replyTargetSnapshot ?? null,
      };
      setMessages((prev) => [...prev, pendingMessage]);

      const pendingSnapshot = [...pendingContextLinks];
      const messageId = await postPatientMessage(
        tempId,
        textToSend,
        replyToMessageId,
        selectedPatientId,
      );
      if (!messageId) return;

      if (pendingSnapshot.length > 0) {
        const attached: MessageContextLink[] = [];
        for (const p of pendingSnapshot) {
          const link = await attachLink(messageId, p.entityType, p.entityId);
          if (link) attached.push(link);
        }
        if (attached.length > 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, contextLinks: [...(m.contextLinks ?? []), ...attached] }
                : m,
            ),
          );
        }
        setPendingContextLinks([]);
      }

      setNewMessage('');
      replyState.clearReply();
      showToast('Üzenet sikeresen elküldve', 'success');
      fetchConversations();
    } catch (error: unknown) {
      console.error('Hiba az üzenet küldésekor:', error);
      const message = error instanceof Error ? error.message : 'Hiba történt az üzenet küldésekor';
      showToast(message, 'error');
    } finally {
      setSending(false);
    }
  };

  const retryFailedMessage = useCallback(
    async (failedMessage: Message): Promise<void> => {
      if (!failedMessage.id.startsWith('pending-') || !selectedPatientId) return;

      try {
        setSending(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === failedMessage.id
              ? { ...m, pending: true, deliveryStatus: undefined }
              : m,
          ),
        );

        const messageId = await postPatientMessage(
          failedMessage.id,
          failedMessage.message,
          failedMessage.replyToMessageId ?? null,
          selectedPatientId,
        );
        if (messageId) {
          replyState.clearReply();
          showToast('Üzenet sikeresen elküldve', 'success');
          fetchConversations();
        }
      } catch (error: unknown) {
        console.error('Hiba az üzenet újraküldésekor:', error);
        const message = error instanceof Error ? error.message : 'Újraküldés sikertelen';
        showToast(message, 'error');
      } finally {
        setSending(false);
      }
    },
    [postPatientMessage, replyState, selectedPatientId, showToast, fetchConversations],
  );

  const handleRemoveContextLink = useCallback(
    async (messageId: string, linkId: string) => {
      const ok = await removeLink(messageId, linkId);
      if (!ok) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, contextLinks: (m.contextLinks ?? []).filter((l) => l.id !== linkId) }
            : m,
        ),
      );
    },
    [removeLink],
  );

  const searchHandler = useMemo<MessageSearchHandler>(
    () => ({
      id: 'patient-messages-inbox',
      channel: 'patient',
      scope: { patientId: selectedPatientId ?? undefined },
      messagesContainerRef: messagesContainerRef as RefObject<HTMLElement | null>,
      scrollToMessage,
      focusComposer: () => textareaRef.current?.focus(),
      prepareHit: async (hit: MessageSearchHit) => {
        if (hit.channel !== 'patient' || !hit.patientId) return;
        if (selectedPatientId !== hit.patientId) {
          const conv = conversations.find((c) => c.patientId === hit.patientId);
          setSelectedPatientId(hit.patientId);
          setSelectedPatientName(conv?.patientName ?? hit.patientName ?? 'Beteg');
          messagesLoadedRef.current.clear();
          await fetchMessages(hit.patientId);
        }
      },
    }),
    [
      conversations,
      fetchMessages,
      scrollToMessage,
      selectedPatientId,
    ],
  );

  useRegisterMessageSearch(searchHandler);

  // Calculate total unread count
  const totalUnreadCount = conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-medical-primary mx-auto mb-4"></div>
            <p className="text-gray-500 dark:text-gray-400">Betöltés...</p>
          </div>
        </div>
      </div>
    );
  }

  // Prepare detail actions for MobileActionMenu
  const detailActions = selectedPatientId ? [
    {
      label: 'Beteg részletei',
      icon: <User className="w-4 h-4" />,
      onClick: () => router.push(`/patients/${selectedPatientId}/view`),
    },
  ] : [];

  // Conversations → view model
  const conversationItems: ConversationVM[] = conversations.map((conv) => ({
    id: conv.patientId,
    title: conv.patientName,
    preview: conv.lastMessage?.message ?? null,
    previewPrefix: conv.lastMessage?.senderType === 'doctor' ? 'Ön:' : null,
    timestamp: conv.lastMessage?.createdAt ?? null,
    unreadCount: conv.unreadCount,
    avatar: { name: conv.patientName, seed: conv.patientId },
  }));

  const handleSelectPatient = (patientId: string) => {
    const conv = conversations.find((c) => c.patientId === patientId);
    setSelectedPatientId(patientId);
    setSelectedPatientName(conv?.patientName ?? 'Beteg');
    messagesLoadedRef.current.clear();
  };

  const conversationsListContent = (
    <ConversationList
      items={conversationItems}
      selectedId={selectedPatientId}
      onSelect={handleSelectPatient}
      filterPlaceholder="Beteg keresése…"
      emptyState={
        <span>
          Még nincsenek beszélgetések
          <span className="block text-xs mt-2 text-gray-400 dark:text-gray-500">
            A betegekkel folytatott beszélgetések itt jelennek meg
          </span>
        </span>
      }
    />
  );

  // Detail header
  const detailHeaderContent = selectedPatientId ? (
    <div className="flex items-center gap-3 w-full min-w-0">
      <Avatar name={selectedPatientName} seed={selectedPatientId} sizeClass="h-9 w-9 hidden sm:flex" />
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
        {selectedPatientName}
      </h3>
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        <MessageSearchButton channel="patient" />
        {isConnected && (
          <div className="w-2 h-2 bg-green-500 rounded-full animate-connection-pulse" title="Kapcsolódva" />
        )}
        {unreadCount > 0 && (
          <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">{unreadCount}</span>
        )}
      </div>
    </div>
  ) : null;

  // Detail content: thread + composer
  const detailContent = (
    <>
      <MessageThread
        containerRef={messagesContainerRef}
        messages={bubbleMessages}
        currentUserId={currentUserId}
        loading={loadingMessages}
        scrollAnchorKey={selectedPatientId}
        typingLabel={typingLabel}
        showSenderName={false}
        canRemoveContextLinks
        onRemoveContextLink={handleRemoveContextLink}
        emptyState={
          <div className="text-center text-gray-500 dark:text-gray-400">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p>Még nincsenek üzenetek</p>
          </div>
        }
        renderAvatar={(bubble) => (
          <Avatar name={bubble.senderName} seed={bubble.senderId} sizeClass="h-7 w-7" textClass="text-[10px]" />
        )}
        renderText={(text, bubble) => (
          <MessageTextRenderer
            text={text}
            chatType="doctor-view-patient"
            patientId={selectedPatientId}
            messageId={bubble.id}
            senderId={bubble.senderId}
            currentUserId={currentUserId || undefined}
            contextLinks={bubble.contextLinks}
            onSendMessage={async (messageText) => {
              setNewMessage(messageText);
              await handleSendMessage();
            }}
          />
        )}
        onReply={(bubble) => {
          const orig = messageById.get(bubble.id);
          if (orig && !orig.pending && orig.deliveryStatus !== 'failed') startReplyTo(orig);
        }}
        onQuoteClick={scrollToMessage}
        onReplyThreadToggle={handleReplyThreadToggle}
        isThreadCollapsed={isCollapsed}
        onRetry={(bubble) => {
          const orig = messageById.get(bubble.id);
          if (orig) void retryFailedMessage(orig);
        }}
      />

      <MessageComposer
        value={newMessage}
        onChange={setNewMessage}
        onSend={handleSendMessage}
        sending={sending}
        sendOnEnter={!isMobile}
        autoFocusKey={selectedPatientId}
        textareaRef={textareaRef}
        onTyping={notifyTyping}
        onEscape={replyState.isReplying ? replyState.clearReply : undefined}
        placeholder="Írja be üzenetét…"
        replyBar={
          replyState.isReplying && replyState.replyTarget ? (
            <ReplyComposerBar
              quote={replyState.replyTarget}
              onClose={replyState.clearReply}
              senderLabelOverride={
                replyState.replyTarget.senderId === currentUserId
                  ? 'Te'
                  : replyState.replyTarget.senderName ?? undefined
              }
            />
          ) : undefined
        }
        pendingBar={
          pendingContextLinks.length > 0 ? (
            <PendingContextLinksBar
              links={pendingContextLinks}
              onRemove={(i) => setPendingContextLinks((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ) : undefined
        }
        attachSlot={
          selectedPatientId ? (
            <>
              <DocumentLinkComposerButton
                patientId={selectedPatientId}
                chatType="patient-doctor"
                messageText={newMessage}
                disabled={sending}
                onInsert={setNewMessage}
              />
              <ContextLinkComposerButton
                patientId={selectedPatientId}
                pendingLinks={pendingContextLinks}
                disabled={sending}
                onAddPending={(link) => setPendingContextLinks((prev) => [...prev, link])}
              />
            </>
          ) : undefined
        }
      />
    </>
  );

  // New chat content
  const newChatContent = showPatientSelector ? (
    <>
      {/* New Chat Header */}
      <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Új beszélgetés</h3>
          <button
            onClick={() => {
              setShowPatientSelector(false);
              setPatientSearchQuery('');
            }}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors mobile-touch-target"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={patientSearchQuery}
            onChange={(e) => setPatientSearchQuery(e.target.value)}
            placeholder="Beteg keresése..."
            className="form-input pl-10 w-full"
            autoFocus
          />
        </div>
        {patientSearchQuery && (
          <div className="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded bg-white dark:bg-gray-900">
            {loadingPatients ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Betöltés...</div>
            ) : availablePatients.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Nincs találat</div>
            ) : (
              availablePatients
                .filter(p => 
                  p.nev.toLowerCase().includes(patientSearchQuery.toLowerCase()) ||
                  (p.email && p.email.toLowerCase().includes(patientSearchQuery.toLowerCase()))
                )
                .slice(0, 10)
                .map((patient) => (
                  <div
                    key={patient.id}
                    onClick={() => {
                      if (!patient.email || patient.email.trim() === '') {
                        showToast('Ennek a betegnek nincs email címe, ezért nem küldhet üzenetet', 'error');
                        return;
                      }
                      setSelectedPatientId(patient.id);
                      setSelectedPatientName(patient.nev);
                      setShowPatientSelector(false);
                      setPatientSearchQuery('');
                      messagesLoadedRef.current.clear();
                      // Refresh conversations to include new patient
                      setTimeout(() => fetchConversations(), 500);
                    }}
                    className="p-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 last:border-b-0 mobile-touch-target"
                  >
                    <div className="font-medium text-sm">{patient.nev}</div>
                    {patient.email && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{patient.email}</div>
                    )}
                  </div>
                ))
            )}
          </div>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <p>Válasszon beteget a beszélgetéshez</p>
        </div>
      </div>
    </>
  ) : null;

  return (
    <MessagesShell
      listTitle="Betegek"
      listIcon={<MessageCircle className="w-5 h-5" />}
      unreadCount={totalUnreadCount}
      onNewChat={() => setShowPatientSelector(true)}
      conversationsList={conversationsListContent}
      showDetail={!!selectedPatientId}
      onBack={() => {
        setSelectedPatientId(null);
        setSelectedPatientName(null);
      }}
      detailHeader={detailHeaderContent}
      detailContent={detailContent}
      detailActions={detailActions}
      showNewChat={showPatientSelector}
      newChatContent={newChatContent}
    />
  );
}
