'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, Check, CheckCheck, Loader2, User, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { getMonogram, getLastName } from '@/lib/utils';
import { MessageTextRenderer } from './MessageTextRenderer';
import { useSocket } from '@/contexts/SocketContext';

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
        
        return [...prev, {
          ...data.message,
          createdAt: new Date(data.message.createdAt),
          readAt: data.message.readAt ? new Date(data.message.readAt) : null,
        }];
      });

      if (data.message.senderType === 'patient' && !data.message.readAt) {
        setUnreadCount(prev => prev + 1);
      }
    };

    const handleMessageRead = (data: { messageId: string; patientId: string }) => {
      if (data.patientId !== patientId) return;

      setMessages(prev =>
        prev.map(m =>
          m.id === data.messageId ? { ...m, readAt: new Date() } : m
        )
      );

      setUnreadCount(prev => Math.max(0, prev - 1));
    };

    socket.on('new-message', handleNewMessage);
    socket.on('message-read', handleMessageRead);

    return () => {
      socket.off('new-message', handleNewMessage);
      socket.off('message-read', handleMessageRead);
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
        }),
      });

      if (!response.ok) {
        const error = await response.json();
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
            const isRead = message.readAt !== null;
            
            const senderName = isFromMe 
              ? (message.senderEmail || 'Én')
              : (patientName || 'Beteg');
            const lastName = getLastName(senderName);
            const monogram = getMonogram(senderName);

            return (
              <div
                key={message.id}
                data-message-id={message.id}
                className={`flex flex-col ${isFromMe ? 'items-end' : 'items-start'}`}
              >
                {/* Sender name and monogram */}
                {!isFromMe && (
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-xs font-semibold text-green-700">
                      {monogram}
                    </div>
                    <span className="text-xs font-medium text-gray-700">{lastName}</span>
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-lg px-4 py-2 ${
                    isFromMe
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-900 border border-gray-200'
                  }`}
                >
                  <div className="text-sm">
                    <MessageTextRenderer 
                      text={message.message} 
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
                  </div>
                  <div className={`text-xs mt-1 flex items-center gap-1.5 ${
                    isFromMe ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    <span>{format(new Date(message.createdAt), 'HH:mm', { locale: hu })}</span>
                    {isFromMe && (
                      <span className="ml-1">
                        {isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : isRead ? (
                          <CheckCheck className="w-3 h-3" />
                        ) : (
                          <Check className="w-3 h-3 opacity-70" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="border-t bg-white p-2 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="form-input flex-1 resize-none w-full min-h-[60px] sm:min-h-0"
            rows={2}
            placeholder="Írja be üzenetét..."
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (newMessage.trim() && !sending) {
                  handleSendMessage();
                }
              }
            }}
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || !newMessage.trim()}
            className="btn-primary flex items-center justify-center gap-2 px-4 py-2 sm:self-end w-full sm:w-auto"
          >
            <Send className="w-4 h-4" />
            <span className="sm:inline">{sending ? '...' : 'Küldés'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
