'use client';

import { useState, useEffect, useRef, useCallback, useMemo, type RefObject } from 'react';
import { MessageCircle, Search, X, Phone } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { getMonogram } from '@/lib/utils';
import { MessageTextRenderer } from '@/components/MessageTextRenderer';
import { useSocket } from '@/contexts/SocketContext';
import { MessagesShell } from '@/components/mobile/MessagesShell';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { type ChatBubbleMessage } from '@/components/messaging/ChatMessageBubble';
import { Avatar } from '@/components/messaging/Avatar';
import { MessageThread } from '@/components/messaging/MessageThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { ConversationList, type ConversationVM } from '@/components/messaging/ConversationList';
import { ReplyComposerBar } from '@/components/messaging/ReplyComposerBar';
import { useReplyState } from '@/components/messaging/useReplyState';
import { buildQuotedMessagePreview } from '@/lib/message-reply';
import type {
  MessageContextLink,
  QuotedMessagePreview,
  MessageDeliveryStatusEvent,
  MessageSearchHit,
} from '@/lib/types/messaging';
import { MessageSearchProvider } from '@/contexts/MessageSearchContext';
import { MessageSearchButton } from '@/components/messaging/MessageSearchButton';
import { useRegisterMessageSearch } from '@/hooks/useRegisterMessageSearch';
import type { MessageSearchHandler } from '@/contexts/MessageSearchContext';
import {
  applyDeliveryStatusUpdate,
  isPatientChannelDeliveryEvent,
} from '@/components/messaging/delivery-status-socket';
import { incrementParentReplyCount } from '@/components/messaging/reply-count-socket';
import { useReplyThreadCollapse } from '@/components/messaging/useReplyThreadCollapse';
import { filterMessagesByThreadCollapse } from '@/lib/messaging/reply-thread-visibility';
import { DocumentLinkComposerButton } from '@/components/messaging/DocumentLinkComposerButton';

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
  deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  replyCount?: number;
  contextLinks?: MessageContextLink[];
}

interface Recipient {
  id: string;
  name: string;
  type: 'treating_doctor' | 'admin' | 'doctor';
}

interface Conversation {
  doctorId: string;
  doctorName: string;
  lastMessage: {
    message: string;
    senderType: 'doctor' | 'patient';
    createdAt: string;
  } | null;
  unreadCount: number;
}

export function PatientMessages() {
  const router = useRouter();
  const { showToast } = useToast();
  const { socket, isConnected, joinRoom, leaveRoom } = useSocket();
  
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDoctorName, setSelectedDoctorName] = useState<string | null>(null);

  const [showNewChat, setShowNewChat] = useState(false);
  const [doctorSearchQuery, setDoctorSearchQuery] = useState('');
  
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesLoadedRef = useRef<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  // Slice 0.6: reply state — beteg portál (saját zöld bubble stílus megmarad).
  const replyState = useReplyState();

  // Lane-váltáskor (másik orvos kiválasztva) töröljük a reply targetet.
  useEffect(() => {
    replyState.clearReply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctorId]);

  const startReplyTo = useCallback((message: Message) => {
    const senderName = message.senderType === 'patient'
      ? (patientName || 'Én')
      : (selectedDoctorName || 'Orvos');
    const quote: QuotedMessagePreview = buildQuotedMessagePreview({
      id: message.id,
      channel: 'patient',
      senderId: message.senderId,
      senderName,
      message: message.message,
      createdAt: message.createdAt,
    });
    replyState.setReplyTarget(quote);
    textareaRef.current?.focus();
  }, [patientName, selectedDoctorName, replyState]);

  const scrollToMessage = useCallback((messageId: string): boolean => {
    const el = messagesContainerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`,
    );
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-blue-400', 'rounded-2xl');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-blue-400', 'rounded-2xl');
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

  useEffect(() => {
    resetThreads();
  }, [selectedDoctorId, resetThreads]);

  const messageById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Csatorna-független buborék-shape. Beteg üzenetei JOBBRA (saját, zöld).
  const bubbleMessages = useMemo<ChatBubbleMessage[]>(
    () =>
      visibleMessages.map((message) => {
        const isFromMe = message.senderType === 'patient';
        const isPending = message.pending === true;
        const isFailed = message.deliveryStatus === 'failed';
        const senderName = isFromMe ? patientName || 'Én' : selectedDoctorName || 'Orvos';

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
    [visibleMessages, patientName, selectedDoctorName],
  );

  const totalUnreadCount = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // Fetch patient info
  useEffect(() => {
    const fetchPatientInfo = async () => {
      try {
        const response = await fetch('/api/patient-portal/patient', {
          credentials: 'include',
        });

        if (!response.ok || response.status === 401) {
          router.push('/patient-portal');
          return;
        }

        const data = await response.json();
        if (data.patient) {
          setPatientId(data.patient.id);
          setPatientName(data.patient.nev);
        }
      } catch (error) {
        console.error('Hiba a beteg adatok betöltésekor:', error);
        router.push('/patient-portal');
      }
    };

    fetchPatientInfo();
  }, [router]);

  // Fetch recipients (all doctors)
  useEffect(() => {
    const fetchRecipients = async () => {
      try {
        const response = await fetch('/api/patient-portal/recipients', {
          credentials: 'include',
        });

        if (!response.ok) {
          if (response.status === 401) {
            router.push('/patient-portal');
            return;
          }
          throw new Error('Hiba a címzettek betöltésekor');
        }

        const data = await response.json();
        if (data.recipients) {
          setRecipients(data.recipients);
        }
      } catch (error) {
        console.error('Hiba a címzettek betöltésekor:', error);
      }
    };

    fetchRecipients();
  }, [router]);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!patientId) return;
    try {
      const response = await fetch('/api/patient-portal/conversations', {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/patient-portal');
          return;
        }
        throw new Error('Hiba a beszélgetések betöltésekor');
      }

      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (error) {
      console.error('Hiba a beszélgetések betöltésekor:', error);
    } finally {
      setLoading(false);
    }
  }, [patientId, router]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Fetch messages for selected doctor
  const fetchMessages = useCallback(async (doctorIdOverride?: string) => {
    const laneDoctorId = doctorIdOverride ?? selectedDoctorId;
    if (!patientId || !laneDoctorId) return;

    try {
      setMessagesLoading(true);
      const response = await fetch(
        `/api/messages?patientId=${patientId}&doctorId=${laneDoctorId}`,
        { credentials: 'include' }
      );

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/patient-portal');
          return;
        }
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      const loadedMessages = (data.messages || []).reverse() as Message[];
      
      messagesLoadedRef.current.clear();
      loadedMessages.forEach(msg => messagesLoadedRef.current.add(msg.id));
      
      setMessages(loadedMessages);
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setMessagesLoading(false);
    }
  }, [patientId, selectedDoctorId, router, showToast]);

  useEffect(() => {
    if (selectedDoctorId) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [selectedDoctorId, fetchMessages]);

  const searchHandler = useMemo<MessageSearchHandler | null>(() => {
    if (!patientId) return null;
    return {
      id: 'patient-portal-messages',
      channel: 'patient',
      scope: {
        patientId,
        doctorId: selectedDoctorId ?? undefined,
      },
      messagesContainerRef: messagesContainerRef as RefObject<HTMLElement | null>,
      scrollToMessage,
      focusComposer: () => textareaRef.current?.focus(),
      prepareHit: async (hit: MessageSearchHit) => {
        if (!patientId || hit.channel !== 'patient') return;
        const laneDoctorId =
          hit.senderType === 'doctor'
            ? hit.senderId
            : hit.recipientDoctorId ?? undefined;
        if (laneDoctorId && selectedDoctorId !== laneDoctorId) {
          const conv = conversations.find((c) => c.doctorId === laneDoctorId);
          setSelectedDoctorName(conv?.doctorName ?? 'Orvos');
          setSelectedDoctorId(laneDoctorId);
          await fetchMessages(laneDoctorId);
        }
      },
    };
  }, [
    conversations,
    fetchMessages,
    patientId,
    scrollToMessage,
    selectedDoctorId,
  ]);

  useRegisterMessageSearch(searchHandler);

  // WebSocket setup
  useEffect(() => {
    if (patientId && isConnected) {
      joinRoom(patientId);
      return () => {
        leaveRoom(patientId);
      };
    }
  }, [patientId, isConnected, joinRoom, leaveRoom]);

  // WebSocket: Listen for new messages
  useEffect(() => {
    if (!socket || !patientId) return;

    const handleNewMessage = (data: { message: Message; patientId: string }) => {
      if (data.patientId !== patientId) return;

      if (messagesLoadedRef.current.has(data.message.id)) {
        return;
      }

      const incomingDoctorId = data.message.senderType === 'doctor'
        ? data.message.senderId
        : (data.message as any).recipientDoctorId;

      if (selectedDoctorId && incomingDoctorId === selectedDoctorId) {
        messagesLoadedRef.current.add(data.message.id);
        setMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          const withReply = [
            ...prev,
            {
              ...data.message,
              createdAt: new Date(data.message.createdAt),
              readAt: data.message.readAt ? new Date(data.message.readAt) : null,
            },
          ];
          return incrementParentReplyCount(withReply, data.message.replyToMessageId);
        });
      }

      fetchConversations();
    };

    const handleMessageRead = (data: { messageId: string; patientId: string }) => {
      if (data.patientId !== patientId) return;

      setMessages(prev =>
        prev.map(m =>
          m.id === data.messageId
            ? { ...m, readAt: new Date(), deliveryStatus: 'read' as const }
            : m
        )
      );
    };

    const handleDeliveryStatus = (event: MessageDeliveryStatusEvent) => {
      if (!patientId || !isPatientChannelDeliveryEvent(event, patientId)) return;
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
  }, [socket, patientId, selectedDoctorId, fetchConversations]);

  // Auto-mark doctor messages as read when conversation is open
  useEffect(() => {
    if (messages.length === 0 || messagesLoading || !patientId || !selectedDoctorId) return;

    const timeoutId = setTimeout(() => {
      const unreadDoctorMessages = messages.filter(
        m => m.senderType === 'doctor' && 
             !m.readAt && 
             !m.pending && 
             /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)
      );
      
      if (unreadDoctorMessages.length > 0) {
        setMessages(prevMessages => 
          prevMessages.map(m => 
            unreadDoctorMessages.some(um => um.id === m.id) 
              ? { ...m, readAt: new Date() } 
              : m
          )
        );
        
        setConversations(prev => prev.map(c =>
          c.doctorId === selectedDoctorId
            ? { ...c, unreadCount: Math.max(0, c.unreadCount - unreadDoctorMessages.length) }
            : c
        ));
        
        Promise.all(
          unreadDoctorMessages.map(msg => 
            fetch(`/api/messages/${msg.id}/read`, {
              method: 'PUT',
              credentials: 'include',
            }).catch(err => {
              console.error(`Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
              setMessages(prevMessages => 
                prevMessages.map(m => 
                  m.id === msg.id ? { ...m, readAt: null } : m
                )
              );
            })
          )
        );
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [patientId, selectedDoctorId, messagesLoading, messages.length]);

  // Select doctor
  const handleSelectDoctor = (doctorId: string, doctorName: string) => {
    setSelectedDoctorId(doctorId);
    setSelectedDoctorName(doctorName);
    setShowNewChat(false);
    setDoctorSearchQuery('');
  };

  // Start new chat
  const handleStartNewChat = () => {
    setShowNewChat(true);
    setSelectedDoctorId(null);
    setSelectedDoctorName(null);
    setDoctorSearchQuery('');
  };

  const postPatientMessage = useCallback(
    async (
      tempId: string,
      text: string,
      replyToMessageId: string | null,
    ): Promise<boolean> => {
      if (!patientId || !selectedDoctorId) return false;

      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId,
          subject: null,
          message: text,
          recipientDoctorId: selectedDoctorId,
          replyToMessageId,
          clientMessageId: tempId,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/patient-portal');
          return false;
        }
        const error = await response.json().catch(() => ({}));
        if (response.status === 429) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId ? { ...m, pending: false, deliveryStatus: 'failed' } : m,
            ),
          );
          showToast(error.error || 'Túl sok üzenet — próbáld újra később.', 'error');
          return false;
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
                }
              : m,
          ),
        );
      }
      return true;
    },
    [patientId, selectedDoctorId, router, showToast],
  );

  const handleSendMessage = async () => {
    const textToSend = newMessage.trim();
    if (!patientId || !textToSend || !selectedDoctorId) {
      showToast('Kérjük, írjon üzenetet', 'error');
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
        patientId,
        senderType: 'patient',
        senderId: patientId,
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

      const ok = await postPatientMessage(tempId, textToSend, replyToMessageId);
      if (!ok) return;

      setNewMessage('');
      replyState.clearReply();
      showToast('Üzenet sikeresen elküldve', 'success');
      setTimeout(() => fetchConversations(), 500);
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
      if (!failedMessage.id.startsWith('pending-')) return;

      try {
        setSending(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === failedMessage.id
              ? { ...m, pending: true, deliveryStatus: undefined }
              : m,
          ),
        );

        const ok = await postPatientMessage(
          failedMessage.id,
          failedMessage.message,
          failedMessage.replyToMessageId ?? null,
        );
        if (ok) {
          replyState.clearReply();
          showToast('Üzenet sikeresen elküldve', 'success');
          setTimeout(() => fetchConversations(), 500);
        }
      } catch (error: unknown) {
        console.error('Hiba az üzenet újraküldésekor:', error);
        const message = error instanceof Error ? error.message : 'Újraküldés sikertelen';
        showToast(message, 'error');
      } finally {
        setSending(false);
      }
    },
    [postPatientMessage, replyState, showToast, fetchConversations],
  );

  // Filtered doctors for new chat
  const filteredRecipients = recipients.filter(r => {
    const existingConvDoctorIds = conversations.map(c => c.doctorId);
    const notAlreadyInConversation = !existingConvDoctorIds.includes(r.id);
    if (!doctorSearchQuery) return notAlreadyInConversation;
    const query = doctorSearchQuery.toLowerCase();
    return notAlreadyInConversation && r.name.toLowerCase().includes(query);
  });

  if (loading) {
    return (
      <div className="card">
        <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900 items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-medical-primary mx-auto mb-4"></div>
            <p className="text-gray-500 dark:text-gray-400">Betöltés...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!patientId) {
    return (
      <div className="card p-6 text-center text-gray-500 dark:text-gray-400">
        <p>Beteg adatok betöltése...</p>
      </div>
    );
  }

  const recipientTypeLabel = (doctorId: string | null): string | null => {
    const recipient = recipients.find((r) => r.id === doctorId);
    if (recipient?.type === 'treating_doctor') return 'Kezelőorvos';
    if (recipient?.type === 'admin') return 'Admin';
    return null;
  };

  // Conversations → view model
  const conversationItems: ConversationVM[] = conversations.map((conv) => ({
    id: conv.doctorId,
    title: conv.doctorName,
    subtitle: recipientTypeLabel(conv.doctorId),
    preview: conv.lastMessage?.message ?? null,
    previewPrefix: conv.lastMessage?.senderType === 'patient' ? 'Ön:' : null,
    timestamp: conv.lastMessage?.createdAt ?? null,
    unreadCount: conv.unreadCount,
    avatar: { name: conv.doctorName, seed: conv.doctorId },
  }));

  const conversationsListContent = (
    <ConversationList
      items={conversationItems}
      selectedId={selectedDoctorId}
      onSelect={(doctorId) => {
        const conv = conversations.find((c) => c.doctorId === doctorId);
        handleSelectDoctor(doctorId, conv?.doctorName ?? 'Orvos');
      }}
      filterPlaceholder="Orvos keresése…"
      emptyState={
        <span>
          Még nincsenek beszélgetések
          <span className="block text-xs mt-2 text-gray-400 dark:text-gray-500">
            Kattintson az „Új beszélgetés” gombra egy orvos kiválasztásához
          </span>
        </span>
      }
    />
  );

  // Detail header
  const detailHeaderContent = (
    <div className="flex items-center gap-3 w-full min-w-0">
      <Avatar name={selectedDoctorName} seed={selectedDoctorId ?? ''} sizeClass="h-9 w-9 hidden sm:flex" />
      <div className="flex-1 min-w-0">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
          {selectedDoctorName || 'Üzenetek'}
        </h3>
        {recipientTypeLabel(selectedDoctorId) && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{recipientTypeLabel(selectedDoctorId)}</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <MessageSearchButton channel="patient" />
        {isConnected && (
          <div className="w-2 h-2 bg-green-500 rounded-full animate-connection-pulse" title="Kapcsolódva" />
        )}
      </div>
    </div>
  );

  // Detail content: thread + composer
  const detailContent = (
    <>
      <MessageThread
        containerRef={messagesContainerRef}
        messages={bubbleMessages}
        currentUserId={patientId}
        loading={messagesLoading}
        scrollAnchorKey={selectedDoctorId}
        showSenderName={false}
        ownTone="green"
        emptyState={
          <div className="text-center text-gray-500 dark:text-gray-400">
            <MessageCircle className="w-14 h-14 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-base font-medium text-gray-700 dark:text-gray-300">Még nincs üzenet</p>
            <p className="text-sm mt-1">Írjon bátran kezelőorvosának.</p>
          </div>
        }
        renderAvatar={(bubble) => (
          <Avatar name={bubble.senderName} seed={bubble.senderId} sizeClass="h-7 w-7" textClass="text-[10px]" />
        )}
        renderText={(text, bubble) => (
          <MessageTextRenderer
            text={text}
            chatType="patient-doctor"
            patientId={patientId}
            messageId={bubble.id}
            senderId={bubble.senderId}
            currentUserId={patientId ?? undefined}
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
        disabled={!selectedDoctorId}
        sendOnEnter={!isMobile}
        autoFocusKey={selectedDoctorId}
        textareaRef={textareaRef}
        onEscape={replyState.isReplying ? replyState.clearReply : undefined}
        placeholder="Írja meg üzenetét…"
        replyBar={
          replyState.isReplying && replyState.replyTarget ? (
            <ReplyComposerBar
              quote={replyState.replyTarget}
              onClose={replyState.clearReply}
              senderLabelOverride={
                replyState.replyTarget.senderId === patientId
                  ? 'Te'
                  : replyState.replyTarget.senderName ?? undefined
              }
            />
          ) : undefined
        }
        attachSlot={
          <DocumentLinkComposerButton
            chatType="patient-doctor"
            portalMode
            messageText={newMessage}
            disabled={sending}
            onInsert={setNewMessage}
          />
        }
      />
    </>
  );

  // New chat content
  const newChatContent = (
    <>
      <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Új beszélgetés</h3>
          <button
            onClick={() => {
              setShowNewChat(false);
              setDoctorSearchQuery('');
            }}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors mobile-touch-target"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={doctorSearchQuery}
            onChange={(e) => setDoctorSearchQuery(e.target.value)}
            placeholder="Orvos keresése..."
            className="form-input w-full pl-9"
            autoFocus
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredRecipients.length === 0 ? (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
            {doctorSearchQuery ? 'Nincs találat' : 'Minden orvossal van már beszélgetése'}
          </div>
        ) : (
          filteredRecipients.map((recipient) => (
            <div
              key={recipient.id}
              onClick={() => handleSelectDoctor(recipient.id, recipient.name)}
              className="p-3 border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {getMonogram(recipient.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{recipient.name}</span>
                    {recipient.type === 'treating_doctor' && (
                      <span className="text-[10px] text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded-full flex-shrink-0">Kezelőorvos</span>
                    )}
                    {recipient.type === 'admin' && (
                      <span className="text-[10px] text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded-full flex-shrink-0">Admin</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );

  // Beteg-portál: nyugodtabb hangnem — sürgősségi figyelmeztetés a lista tetején.
  const listHeaderContent = (
    <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 rounded-lg px-3 py-2">
      <Phone className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <span className="text-xs leading-snug">
        Sürgős esetben hívja rendelőnket. Az üzenetekre munkaidőben válaszolunk.
      </span>
    </div>
  );

  return (
    <MessageSearchProvider preferredChannel="patient">
    <div className="card">
      <MessagesShell
        listTitle="Üzenetek"
        listIcon={<MessageCircle className="w-5 h-5" />}
        unreadCount={totalUnreadCount}
        onNewChat={handleStartNewChat}
        conversationsList={conversationsListContent}
        listHeaderContent={listHeaderContent}
        showDetail={!!selectedDoctorId}
        onBack={() => {
          setSelectedDoctorId(null);
          setSelectedDoctorName(null);
          setMessages([]);
        }}
        detailHeader={detailHeaderContent}
        detailContent={detailContent}
        detailActions={[]}
        showNewChat={showNewChat}
        newChatContent={newChatContent}
      />
    </div>
    </MessageSearchProvider>
  );
}
