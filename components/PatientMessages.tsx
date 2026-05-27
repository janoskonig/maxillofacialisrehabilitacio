'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, User, ArrowRight, FileQuestion } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { getMonogram, getLastName } from '@/lib/utils';
import { MessageTextRenderer } from './MessageTextRenderer';
import { useSocket } from '@/contexts/SocketContext';
import { DocumentRequestSendWizard } from './DocumentRequestSendWizard';
import { ChatMessageBubble, type ChatBubbleMessage } from './messaging/ChatMessageBubble';
import { ReplyComposerBar } from './messaging/ReplyComposerBar';
import { useReplyState } from './messaging/useReplyState';
import { buildQuotedMessagePreview } from '@/lib/message-reply';
import type { QuotedMessagePreview, MessageDeliveryStatusEvent } from '@/lib/types/messaging';
import {
  applyDeliveryStatusUpdate,
  isPatientChannelDeliveryEvent,
} from './messaging/delivery-status-socket';
import { incrementParentReplyCount } from './messaging/reply-count-socket';

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
}

interface PatientMessagesProps {
  patientId: string;
  patientName?: string | null;
}

export function PatientMessages({ patientId, patientName }: PatientMessagesProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { socket, isConnected, joinRoom, leaveRoom } = useSocket();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesLoadedRef = useRef<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showRequestWizard, setShowRequestWizard] = useState(false);

  // Slice 0.6: reply state — beteg csatorna staff oldal.
  const replyState = useReplyState();

  // Beteg-szál váltáskor töröljük a reply targetet, hogy ne szivárogjon át
  // egy másik beteg üzenetére irányuló idézet.
  useEffect(() => {
    replyState.clearReply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const startReplyTo = useCallback((message: Message) => {
    const quote: QuotedMessagePreview = buildQuotedMessagePreview({
      id: message.id,
      channel: 'patient',
      senderId: message.senderId,
      senderName: message.senderType === 'doctor'
        ? message.senderEmail || 'Orvos'
        : patientName || 'Beteg',
      message: message.message,
      createdAt: message.createdAt,
    });
    replyState.setReplyTarget(quote);
    // Fókuszt adunk a textareának, hogy a billentyűzet rögtön gépelésre álljon.
    textareaRef.current?.focus();
  }, [patientName, replyState]);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messagesContainerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-blue-400', 'rounded-lg');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-blue-400', 'rounded-lg');
    }, 1600);
  }, []);

  const scrollToFirstReply = useCallback(
    (parentId: string) => {
      const firstReply = messages.find((m) => m.replyToMessageId === parentId);
      if (firstReply) scrollToMessage(firstReply.id);
    },
    [messages, scrollToMessage],
  );

  // Get current user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          if (data.user?.id) {
            setCurrentUserId(data.user.id);
          }
        }
      } catch (error) {
        console.error('Hiba a felhasználó betöltésekor:', error);
      }
    };
    fetchUser();
  }, []);

  // Initial message load from API
  const fetchMessages = useCallback(async () => {
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
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  }, [patientId, showToast]);

  // Load messages and setup WebSocket
  useEffect(() => {
    fetchMessages();
    
    if (isConnected) {
      joinRoom(patientId);
    }
    
    return () => {
      if (isConnected) {
        leaveRoom(patientId);
      }
    };
  }, [patientId, isConnected, joinRoom, leaveRoom, fetchMessages]);

  // WebSocket: Listen for new messages
  useEffect(() => {
    if (!socket || !patientId) return;

    const handleNewMessage = (data: { message: Message; patientId: string }) => {
      if (data.patientId !== patientId) return;

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

      setUnreadCount(prev => Math.max(0, prev - 1));
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
  }, [socket, patientId]);

  // Auto-mark patient messages as read when conversation opens
  // Egyszerűbb és megbízhatóbb: amikor a beszélgetés megnyílik, jelöljük olvasottnak az összes olvasatlant
  useEffect(() => {
    if (messages.length === 0 || loading || !patientId) return;

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
          unreadPatientMessages.map(msg => 
            fetch(`/api/messages/${msg.id}/read`, {
              method: 'PUT',
              credentials: 'include',
            }).catch(err => {
              console.error(`Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
              // Revert on error
              setMessages(prevMessages => 
                prevMessages.map(m => 
                  m.id === msg.id ? { ...m, readAt: null } : m
                )
              );
              setUnreadCount(prev => prev + 1);
            })
          )
        );
      }
    }, 500); // 500ms delay, hogy biztosan renderelődtek az üzenetek

    return () => clearTimeout(timeoutId);
  }, [patientId, loading, messages.length]);

  // Scroll to bottom when messages change or loading finishes
  useEffect(() => {
    if (!loading) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          } else if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
          }
        }, 50);
      });
    }
  }, [messages, loading]);

  // Force scroll to bottom when component mounts or patientId changes
  useEffect(() => {
    if (patientId && !loading) {
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        } else if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
      }, 200);
    }
  }, [patientId, loading]);

  // Send message
  const handleSendMessage = async () => {
    const textToSend = newMessage.trim();
    if (!textToSend) {
      showToast('Kérjük, írjon üzenetet', 'error');
      return;
    }

    // Reply state snapshot a POST startján — közben felhasználó nem
    // tud egy másik üzenetre váltani.
    const replyTargetSnapshot = replyState.replyTarget;
    const replyToMessageId = replyTargetSnapshot?.id ?? null;

    // Slice 0.8: idempotencia kulcs.
    const clientMessageId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      setSending(true);
      
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          patientId,
          subject: null,
          message: textToSend,
          replyToMessageId,
          clientMessageId,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 429) {
          showToast(error.error || 'Túl sok üzenet — próbáld újra később.', 'error');
          return;
        }
        throw new Error(error.error || 'Hiba az üzenet küldésekor');
      }

      const data = await response.json();
      
      if (data.message) {
        messagesLoadedRef.current.add(data.message.id);
        setMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) {
            return prev;
          }
          return [...prev, {
            ...data.message,
            createdAt: new Date(data.message.createdAt),
            readAt: data.message.readAt ? new Date(data.message.readAt) : null,
          }];
        });
      }
      
      setNewMessage('');
      replyState.clearReply();
      showToast('Üzenet sikeresen elküldve', 'success');
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col h-[600px] min-h-[600px]">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
                Üzenetek {patientName && `- ${patientName}`}
              </h3>
              <button
                onClick={() => router.push(`/patients/${patientId}/view`)}
                className="btn-secondary flex items-center gap-1 text-sm px-2 py-1 flex-shrink-0"
                title="Beteg részletei"
              >
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">Részletek</span>
                <ArrowRight className="w-3 h-3 sm:hidden" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {isConnected && (
              <div className="w-2 h-2 bg-green-500 rounded-full animate-connection-pulse" title="Kapcsolódva" />
            )}
            {unreadCount > 0 && (
              <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 sm:p-4 bg-gray-50 space-y-3 scroll-smooth">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>Még nincsenek üzenetek</p>
          </div>
        ) : (
          messages.map((message) => {
            // Orvos oldalon: orvos üzenetei JOBBRA (kék), beteg üzenetei BALRA (fehér)
            const isFromMe = currentUserId ? message.senderType === 'doctor' && message.senderId === currentUserId : message.senderType === 'doctor';
            const isPending = message.pending === true;

            const senderName = isFromMe
              ? (message.senderEmail || 'Én')
              : (patientName || 'Beteg');
            const lastName = getLastName(senderName);
            const monogram = getMonogram(senderName);

            const bubbleMessage: ChatBubbleMessage = {
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
                : message.deliveryStatus ?? (message.readAt ? 'read' : 'sent'),
              readAt: message.readAt ?? null,
            };

            return (
              <div key={message.id} className={`flex flex-col ${isFromMe ? 'items-end' : 'items-start'}`}>
                {/* Sender name and monogram */}
                {!isFromMe && (
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-xs font-semibold text-green-700">
                      {monogram}
                    </div>
                    <span className="text-xs font-medium text-gray-700">{lastName}</span>
                  </div>
                )}
                <ChatMessageBubble
                  message={bubbleMessage}
                  currentUserId={currentUserId}
                  showSenderLabel={false}
                  renderText={(text) => (
                    <MessageTextRenderer
                      text={text}
                      chatType="doctor-view-patient"
                      patientId={patientId}
                      messageId={message.id}
                      senderId={message.senderId}
                      currentUserId={currentUserId || undefined}
                      onSendMessage={async (messageText) => {
                        setNewMessage(messageText);
                        await handleSendMessage();
                      }}
                    />
                  )}
                  onReply={isPending ? undefined : () => startReplyTo(message)}
                  onQuoteClick={scrollToMessage}
                  onReplyThreadClick={scrollToFirstReply}
                />
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Slice 0.6: reply mód csík a composer fölött */}
      {replyState.isReplying && replyState.replyTarget && (
        <ReplyComposerBar
          quote={replyState.replyTarget}
          onClose={replyState.clearReply}
          senderLabelOverride={
            replyState.replyTarget.senderId === currentUserId
              ? 'Te'
              : replyState.replyTarget.senderName ?? undefined
          }
        />
      )}

      {/* Message Input */}
      <div className="border-t bg-white p-2 sm:p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-4">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowRequestWizard(true)}
            className="flex-shrink-0 btn-secondary rounded-full w-10 h-10 sm:w-auto sm:rounded-lg sm:px-3 sm:py-2.5 p-0 sm:p-2"
            title="Dokumentum bekérése"
          >
            <FileQuestion className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline text-sm">Bekérés</span>
          </button>
          <textarea
            ref={textareaRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && replyState.isReplying) {
                e.preventDefault();
                replyState.clearReply();
              }
            }}
            className="form-input flex-1 resize-none min-h-[44px]"
            rows={2}
            placeholder="Írja be üzenetét..."
            disabled={sending}
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || !newMessage.trim()}
            className="flex-shrink-0 bg-medical-primary hover:bg-medical-primary-dark text-white rounded-full w-10 h-10 sm:w-auto sm:h-auto sm:rounded-lg sm:px-4 sm:py-2.5 flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-soft"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">{sending ? '...' : 'Küldés'}</span>
          </button>
        </div>
      </div>

      <DocumentRequestSendWizard
        isOpen={showRequestWizard}
        onClose={() => setShowRequestWizard(false)}
        patientId={patientId}
        patientName={patientName}
        mode="chat_patient"
        onSent={() => fetchMessages()}
      />
    </div>
  );
}
