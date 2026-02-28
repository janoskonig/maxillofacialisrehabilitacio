'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, Clock, Check, CheckCheck, Loader2, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { getMonogram, getLastName } from '@/lib/utils';
import { MessageTextRenderer } from '@/components/MessageTextRenderer';
import { useSocket } from '@/contexts/SocketContext';
import { MessagesShell } from '@/components/mobile/MessagesShell';
import { useBreakpoint } from '@/hooks/useBreakpoint';

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

interface Recipient {
  id: string;
  name: string;
  type: 'treating_doctor' | 'admin';
}

export function PatientMessages() {
  const router = useRouter();
  const { showToast } = useToast();
  const { socket, isConnected, joinRoom, leaveRoom } = useSocket();
  
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [doctorName, setDoctorName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [showRecipientSelector, setShowRecipientSelector] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesLoadedRef = useRef<Set<string>>(new Set());
  
  // Hooks must be called unconditionally at the top level
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

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
          setDoctorName(data.patient.kezeleoorvos || null);
        }
      } catch (error) {
        console.error('Hiba a beteg adatok betöltésekor:', error);
        router.push('/patient-portal');
      }
    };

    fetchPatientInfo();
  }, [router]);

  // Fetch recipients
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
        if (data.recipients && data.recipients.length > 0) {
          setRecipients(data.recipients);
          setSelectedRecipientId(data.recipients[0].id);
        }
      } catch (error) {
        console.error('Hiba a címzettek betöltésekor:', error);
      }
    };

    fetchRecipients();
  }, [router]);

  // Initial message load from API
  const fetchMessages = useCallback(async () => {
    if (!patientId) return;

    try {
      const response = await fetch(`/api/messages?patientId=${patientId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/patient-portal');
          return;
        }
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      const loadedMessages = (data.messages || []).reverse() as Message[];
      
      loadedMessages.forEach(msg => messagesLoadedRef.current.add(msg.id));
      
      setMessages(loadedMessages);
      
      const unread = loadedMessages.filter(
        (m: Message) => m.senderType === 'doctor' && !m.readAt
      ).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  }, [patientId, router, showToast]);

  // Load messages and setup WebSocket
  useEffect(() => {
    if (patientId) {
      fetchMessages();
      
      if (isConnected) {
        joinRoom(patientId);
      }
      
      return () => {
        if (isConnected) {
          leaveRoom(patientId);
        }
      };
    }
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

      if (data.message.senderType === 'doctor' && !data.message.readAt) {
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

  // Auto-mark doctor messages as read when conversation opens
  // Egyszerűbb és megbízhatóbb: amikor a beszélgetés megnyílik, jelöljük olvasottnak az összes olvasatlant
  useEffect(() => {
    if (messages.length === 0 || loading || !patientId) return;

    // Várunk egy kicsit, hogy biztosan renderelődtek az üzenetek
    const timeoutId = setTimeout(() => {
      const unreadDoctorMessages = messages.filter(
        m => m.senderType === 'doctor' && 
             !m.readAt && 
             !m.pending && 
             /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)
      );
      
      if (unreadDoctorMessages.length > 0) {
        // Mark as read optimistically
        setMessages(prevMessages => 
          prevMessages.map(m => 
            unreadDoctorMessages.some(um => um.id === m.id) 
              ? { ...m, readAt: new Date() } 
              : m
          )
        );
        
        setUnreadCount(prev => Math.max(0, prev - unreadDoctorMessages.length));
        
        // Send API requests to mark as read
        Promise.all(
          unreadDoctorMessages.map(msg => 
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

  // Force scroll to bottom when component mounts
  useEffect(() => {
    if (!loading) {
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        } else if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
      }, 200);
    }
  }, [loading]);

  // Send message
  const handleSendMessage = async () => {
    const textToSend = newMessage.trim();
    if (!patientId || !textToSend || !selectedRecipientId) {
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
          recipientDoctorId: selectedRecipientId,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/patient-portal');
          return;
        }
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

  if (!patientId) {
    return (
      <div className="card p-6 text-center text-gray-500">
        <p>Beteg adatok betöltése...</p>
      </div>
    );
  }

  // Detail header content
  const detailHeaderContent = (
    <>
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Üzenetek</h3>
      {doctorName && (
        <p className="text-xs sm:text-sm text-gray-500 truncate mt-1">{doctorName}</p>
      )}
      <div className="flex items-center gap-2 flex-shrink-0 mt-1 sm:mt-0">
        {isConnected && (
          <div className="w-2 h-2 bg-green-500 rounded-full animate-connection-pulse" title="Kapcsolódva" />
        )}
        {unreadCount > 0 && (
          <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
            {unreadCount}
          </span>
        )}
      </div>
    </>
  );

  // Detail content (messages + input)
  const detailContent = (
    <>
      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto bg-gradient-to-b from-gray-50 to-gray-100 p-4 space-y-4 scroll-smooth">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-base font-medium">Még nincsenek üzenetek</p>
            <p className="text-sm mt-2">Küldjön üzenetet az orvosának!</p>
          </div>
        ) : (
          messages.map((message) => {
            // Páciens portálon: beteg üzenetei JOBBRA (zöld), orvos üzenetei BALRA (fehér/kék)
            const isMyMessage = message.senderType === 'patient'; // Beteg üzenete = saját üzenet
            const isTheirMessage = message.senderType === 'doctor'; // Orvos üzenete = másik üzenet
            const isUnread = !message.readAt && isTheirMessage;
            const isPending = message.pending === true;
            const isRead = message.readAt !== null;

            const senderName = isMyMessage 
              ? (patientName || 'Én')
              : (doctorName || 'Orvos');
            const lastName = getLastName(senderName);
            const monogram = getMonogram(senderName);

            return (
              <div
                key={message.id}
                className={`flex w-full ${isMyMessage ? 'justify-end' : 'justify-start'} animate-message-pop`}
              >
                <div className={`flex gap-2 max-w-[80%] sm:max-w-[70%] ${isMyMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar - csak másik üzeneteinél */}
                  {isTheirMessage && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                      {monogram}
                    </div>
                  )}
                  
                  {/* Message Bubble */}
                  <div className={`flex flex-col ${isMyMessage ? 'items-end' : 'items-start'}`}>
                    {/* Sender name - csak másik üzeneteinél */}
                    {isTheirMessage && (
                      <div className="text-xs font-medium text-gray-600 mb-1 px-1">
                        {lastName}
                      </div>
                    )}
                    
                    {/* Message bubble */}
                    <div
                      className={`rounded-2xl px-4 py-2.5 shadow-sm transition-all duration-200 ${
                        isMyMessage
                          ? 'bg-green-500 text-white rounded-br-md'
                          : isUnread
                          ? 'bg-white text-gray-900 border-2 border-blue-400 shadow-md'
                          : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      <div className={`text-sm whitespace-pre-wrap break-words ${isMyMessage ? 'text-white' : 'text-gray-900'}`}>
                        <MessageTextRenderer 
                          text={message.message} 
                          chatType="patient-doctor"
                          patientId={patientId}
                          messageId={message.id}
                          senderId={message.senderId}
                          currentUserId={patientId}
                          onSendMessage={async (messageText) => {
                            setNewMessage(messageText);
                            await handleSendMessage();
                          }}
                        />
                      </div>
                      
                      {/* Footer with time and status */}
                      <div className={`flex items-center gap-1.5 mt-1.5 ${isMyMessage ? 'justify-end' : 'justify-start'}`}>
                        <span className={`text-[10px] ${isMyMessage ? 'text-green-100' : 'text-gray-500'}`}>
                          {format(new Date(message.createdAt), 'HH:mm', { locale: hu })}
                        </span>
                        {isMyMessage && (
                          <span className="flex items-center">
                            {isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin text-green-200" />
                            ) : isRead ? (
                              <CheckCheck className="w-3 h-3 text-green-200" />
                            ) : (
                              <Check className="w-3 h-3 text-green-200 opacity-70" />
                            )}
                          </span>
                        )}
                        {isUnread && (
                          <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold text-white bg-red-500 rounded">
                            Új
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Spacer for alignment */}
                  {isMyMessage && <div className="flex-shrink-0 w-8"></div>}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t bg-white p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4">
        {recipients.length > 1 && (
          <div className="mb-2 sm:mb-3 relative">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              Üzenet küldése:
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowRecipientSelector(!showRecipientSelector)}
                className="w-full px-3 py-2 text-left text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex items-center justify-between transition-all duration-200 mobile-touch-target"
              >
                <span className="truncate">
                  {selectedRecipientId
                    ? recipients.find(r => r.id === selectedRecipientId)?.name || 'Válasszon címzettet'
                    : 'Válasszon címzettet'}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showRecipientSelector ? 'transform rotate-180' : ''}`} />
              </button>
              {showRecipientSelector && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowRecipientSelector(false)}
                  />
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-auto">
                    {recipients.map((recipient) => (
                      <button
                        key={recipient.id}
                        type="button"
                        onClick={() => {
                          setSelectedRecipientId(recipient.id);
                          setShowRecipientSelector(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors duration-200 mobile-touch-target ${
                          selectedRecipientId === recipient.id ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{recipient.name}</span>
                          {recipient.type === 'treating_doctor' && (
                            <span className="text-xs text-gray-500">(Kezelőorvos)</span>
                          )}
                          {recipient.type === 'admin' && (
                            <span className="text-xs text-gray-500">(Admin)</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {recipients.length === 1 && (
          <div className="mb-2 sm:mb-3">
            <p className="text-xs sm:text-sm text-gray-600">
              Üzenet küldése: <span className="font-medium text-gray-900">{recipients[0].name}</span>
            </p>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="form-input flex-1 resize-none rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 min-h-[44px]"
            rows={2}
            placeholder="Írja be üzenetét..."
            disabled={sending}
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || !newMessage.trim() || !selectedRecipientId}
            className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-full w-10 h-10 sm:w-auto sm:h-auto sm:rounded-xl sm:px-6 sm:py-2.5 flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-sm hover:shadow-md"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="hidden sm:inline text-sm font-medium">{sending ? 'Küldés...' : 'Küldés'}</span>
          </button>
        </div>
      </div>
    </>
  );

  // Empty conversations list (portal has no list, only single conversation)
  const conversationsListContent = (
    <div className="p-4 text-center text-gray-500 text-sm">
      <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
      <p>Üzenetek</p>
    </div>
  );

  return (
    <div className="card">
      <MessagesShell
        listTitle="Üzenetek"
        listIcon={<MessageCircle className="w-5 h-5" />}
        unreadCount={unreadCount}
        conversationsList={conversationsListContent}
        showDetail={true}
        detailHeader={detailHeaderContent}
        detailContent={detailContent}
        detailActions={[]}
      />
    </div>
  );
}
