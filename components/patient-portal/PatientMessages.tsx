'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, Clock, Check, CheckCheck, Loader2, ChevronDown, Users, Search, X } from 'lucide-react';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesLoadedRef = useRef<Set<string>>(new Set());
  
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

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
  const fetchMessages = useCallback(async () => {
    if (!patientId || !selectedDoctorId) return;

    try {
      setMessagesLoading(true);
      const response = await fetch(
        `/api/messages?patientId=${patientId}&doctorId=${selectedDoctorId}`,
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
          return [...prev, {
            ...data.message,
            createdAt: new Date(data.message.createdAt),
            readAt: data.message.readAt ? new Date(data.message.readAt) : null,
          }];
        });
      }

      fetchConversations();
    };

    const handleMessageRead = (data: { messageId: string; patientId: string }) => {
      if (data.patientId !== patientId) return;

      setMessages(prev =>
        prev.map(m =>
          m.id === data.messageId ? { ...m, readAt: new Date() } : m
        )
      );
    };

    socket.on('new-message', handleNewMessage);
    socket.on('message-read', handleMessageRead);

    return () => {
      socket.off('new-message', handleNewMessage);
      socket.off('message-read', handleMessageRead);
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

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!messagesLoading && selectedDoctorId) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          }
        }, 50);
      });
    }
  }, [messages, messagesLoading, selectedDoctorId]);

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

  // Send message
  const handleSendMessage = async () => {
    const textToSend = newMessage.trim();
    if (!patientId || !textToSend || !selectedDoctorId) {
      showToast('Kérjük, írjon üzenetet', 'error');
      return;
    }

    try {
      setSending(true);
      
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId,
          subject: null,
          message: textToSend,
          recipientDoctorId: selectedDoctorId,
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
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, {
            ...data.message,
            createdAt: new Date(data.message.createdAt),
            readAt: data.message.readAt ? new Date(data.message.readAt) : null,
          }];
        });
      }
      
      setNewMessage('');
      showToast('Üzenet sikeresen elküldve', 'success');

      setTimeout(() => fetchConversations(), 500);
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
    } finally {
      setSending(false);
    }
  };

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
        <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Betöltés...</p>
          </div>
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

  const formatConversationTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, 'HH:mm');
    if (isYesterday(d)) return 'Tegnap';
    return format(d, 'MM.dd.');
  };

  // Conversations list
  const conversationsListContent = conversations.length === 0 && !loading ? (
    <div className="p-4 text-center text-gray-500 text-sm">
      Még nincsenek beszélgetések
      <p className="text-xs mt-2 text-gray-400">Kattintson az &quot;Új beszélgetés&quot; gombra egy orvos kiválasztásához</p>
    </div>
  ) : (
    conversations.map((conv) => {
      const isSelected = selectedDoctorId === conv.doctorId;
      const monogram = getMonogram(conv.doctorName);
      const recipient = recipients.find(r => r.id === conv.doctorId);
      
      return (
        <div
          key={conv.doctorId}
          onClick={() => handleSelectDoctor(conv.doctorId, conv.doctorName)}
          className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
            isSelected ? 'bg-blue-100 border-l-4 border-l-blue-600' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
              conv.unreadCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {monogram}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-sm truncate ${conv.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}`}>
                    {conv.doctorName}
                  </span>
                  {recipient?.type === 'treating_doctor' && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">Kezelőorvos</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {conv.lastMessage && (
                    <span className="text-xs text-gray-400">{formatConversationTime(conv.lastMessage.createdAt)}</span>
                  )}
                  {conv.unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full min-w-[20px] text-center">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
              {conv.lastMessage && (
                <p className={`text-xs mt-0.5 truncate ${conv.unreadCount > 0 ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                  {conv.lastMessage.senderType === 'patient' ? 'Ön: ' : ''}
                  {conv.lastMessage.message.substring(0, 50)}
                  {conv.lastMessage.message.length > 50 ? '...' : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    })
  );

  // Detail header
  const detailHeaderContent = (
    <>
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
        {selectedDoctorName || 'Üzenetek'}
      </h3>
      {(() => {
        const recipient = recipients.find(r => r.id === selectedDoctorId);
        if (recipient?.type === 'treating_doctor') {
          return <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mt-1 inline-block">Kezelőorvos</span>;
        }
        if (recipient?.type === 'admin') {
          return <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full mt-1 inline-block">Admin</span>;
        }
        return null;
      })()}
      <div className="flex items-center gap-2 flex-shrink-0 mt-1 sm:mt-0">
        {isConnected && (
          <div className="w-2 h-2 bg-green-500 rounded-full animate-connection-pulse" title="Kapcsolódva" />
        )}
      </div>
    </>
  );

  // Detail content (messages + input)
  const detailContent = (
    <>
      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto bg-gradient-to-b from-gray-50 to-gray-100 p-4 space-y-4 scroll-smooth">
        {messagesLoading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 mx-auto mb-2 text-gray-300 animate-spin" />
            <p className="text-sm text-gray-500">Üzenetek betöltése...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-base font-medium">Még nincsenek üzenetek</p>
            <p className="text-sm mt-2">Küldjön üzenetet!</p>
          </div>
        ) : (
          messages.map((message, index) => {
            const isMyMessage = message.senderType === 'patient';
            const isTheirMessage = message.senderType === 'doctor';
            const isUnread = !message.readAt && isTheirMessage;
            const isPending = message.pending === true;
            const isRead = message.readAt !== null;

            const senderName = isMyMessage 
              ? (patientName || 'Én')
              : (selectedDoctorName || 'Orvos');
            const lastName = getLastName(senderName);
            const monogram = getMonogram(senderName);

            const msgDate = new Date(message.createdAt);
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const showDateSeparator = !prevMsg || !isSameDay(msgDate, new Date(prevMsg.createdAt));

            const dateSeparatorLabel = isToday(msgDate)
              ? 'Ma'
              : isYesterday(msgDate)
              ? 'Tegnap'
              : format(msgDate, 'yyyy. MMMM d.', { locale: hu });

            return (
              <div key={message.id}>
                {showDateSeparator && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 border-t border-gray-300" />
                    <span className="text-xs font-medium text-gray-500 whitespace-nowrap">{dateSeparatorLabel}</span>
                    <div className="flex-1 border-t border-gray-300" />
                  </div>
                )}
              <div
                className={`flex w-full ${isMyMessage ? 'justify-end' : 'justify-start'} animate-message-pop`}
              >
                <div className={`flex gap-2 max-w-[80%] sm:max-w-[70%] ${isMyMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                  {isTheirMessage && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                      {monogram}
                    </div>
                  )}
                  
                  <div className={`flex flex-col ${isMyMessage ? 'items-end' : 'items-start'}`}>
                    {isTheirMessage && (
                      <div className="text-xs font-medium text-gray-600 mb-1 px-1">
                        {lastName}
                      </div>
                    )}
                    
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
                  
                  {isMyMessage && <div className="flex-shrink-0 w-8"></div>}
                </div>
              </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 border-t bg-white p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4">
        <div className="flex items-end gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            className="form-input flex-1 resize-none rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 min-h-[44px]"
            rows={2}
            placeholder="Írja be üzenetét..."
            disabled={sending}
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || !newMessage.trim() || !selectedDoctorId}
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

  // New chat content
  const newChatContent = (
    <>
      <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">Új beszélgetés</h3>
          <button
            onClick={() => {
              setShowNewChat(false);
              setDoctorSearchQuery('');
            }}
            className="p-1 hover:bg-gray-200 rounded transition-colors mobile-touch-target"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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
          <div className="p-4 text-center text-gray-500 text-sm">
            {doctorSearchQuery ? 'Nincs találat' : 'Minden orvossal van már beszélgetése'}
          </div>
        ) : (
          filteredRecipients.map((recipient) => (
            <div
              key={recipient.id}
              onClick={() => handleSelectDoctor(recipient.id, recipient.name)}
              className="p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {getMonogram(recipient.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-900 truncate">{recipient.name}</span>
                    {recipient.type === 'treating_doctor' && (
                      <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">Kezelőorvos</span>
                    )}
                    {recipient.type === 'admin' && (
                      <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full flex-shrink-0">Admin</span>
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

  return (
    <div className="card">
      <MessagesShell
        listTitle="Üzenetek"
        listIcon={<MessageCircle className="w-5 h-5" />}
        unreadCount={totalUnreadCount}
        onNewChat={handleStartNewChat}
        conversationsList={conversationsListContent}
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
  );
}
