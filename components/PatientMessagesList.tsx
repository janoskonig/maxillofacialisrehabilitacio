'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, Check, CheckCheck, Loader2, Search, User, ArrowRight, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { MessageTextRenderer } from './MessageTextRenderer';
import { useSocket } from '@/contexts/SocketContext';
import { getMonogram, getLastName } from '@/lib/utils';
import { MessagesShell } from './mobile/MessagesShell';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPatientSelector, setShowPatientSelector] = useState(false);
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [availablePatients, setAvailablePatients] = useState<Patient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesLoadedRef = useRef<Set<string>>(new Set());
  
  // Hooks must be called unconditionally at the top level
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

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

  // Fetch conversations (patients with messages)
  const fetchConversations = useCallback(async () => {
    try {
      // Get all patients with email
      const patientsResponse = await fetch('/api/patients?limit=1000', {
        credentials: 'include',
      });

      if (!patientsResponse.ok) {
        throw new Error('Hiba a betegek betöltésekor');
      }

      const patientsData = await patientsResponse.json();
      const patientsWithEmail = (patientsData.patients || []).filter(
        (p: Patient) => p.email && p.email.trim() !== ''
      );

      // Get messages for each patient and build conversations
      const conversationsList: Conversation[] = [];
      
      for (const patient of patientsWithEmail) {
        try {
          const messagesResponse = await fetch(`/api/messages?patientId=${patient.id}`, {
            credentials: 'include',
          });

          if (messagesResponse.ok) {
            const messagesData = await messagesResponse.json();
            const patientMessages = (messagesData.messages || []) as Message[];
            
            if (patientMessages.length > 0) {
              // API DESC sorrendben adja vissza (legfrissebb először), így az első elem a legfrissebb
              const lastMessage = patientMessages[0];
              const unread = patientMessages.filter(
                (m: Message) => m.senderType === 'patient' && !m.readAt
              ).length;

              conversationsList.push({
                patientId: patient.id,
                patientName: patient.nev,
                lastMessage,
                unreadCount: unread,
              });
            }
          }
        } catch (error) {
          // Skip patients with errors
          console.error(`Hiba az üzenetek betöltésekor beteghez ${patient.id}:`, error);
        }
      }

      // Sort by unread count, then by last message date
      conversationsList.sort((a, b) => {
        if (a.unreadCount !== b.unreadCount) {
          return b.unreadCount - a.unreadCount;
        }
        if (a.lastMessage && b.lastMessage) {
          return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime();
        }
        if (a.lastMessage) return -1;
        if (b.lastMessage) return 1;
        return 0;
      });

      setConversations(conversationsList);
    } catch (error) {
      console.error('Hiba a konverzációk betöltésekor:', error);
      showToast('Hiba történt a konverzációk betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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
    
    // Refresh conversations periodically
    const interval = setInterval(() => {
      fetchConversations();
      if (selectedPatientId) {
        fetchMessages(selectedPatientId);
      }
    }, 5000);
    
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
      if (data.patientId !== selectedPatientId) {
        // Update conversations list if message is for another patient
        fetchConversations();
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
        
        return [...prev, {
          ...data.message,
          createdAt: new Date(data.message.createdAt),
          readAt: data.message.readAt ? new Date(data.message.readAt) : null,
        }];
      });

      if (data.message.senderType === 'patient' && !data.message.readAt) {
        setUnreadCount(prev => prev + 1);
      }
      
      // Refresh conversations to update last message
      fetchConversations();
    };

    const handleMessageRead = (data: { messageId: string; patientId: string }) => {
      if (data.patientId !== selectedPatientId) return;

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
  }, [socket, selectedPatientId, fetchConversations]);

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

  // Scroll to bottom when messages change or loading finishes
  useEffect(() => {
    if (!loadingMessages) {
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
  }, [messages, loadingMessages]);

  // Force scroll to bottom when patient is selected
  useEffect(() => {
    if (selectedPatientId && !loadingMessages) {
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        } else if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
      }, 200);
    }
  }, [selectedPatientId, loadingMessages]);

  // Send message
  const handleSendMessage = async () => {
    const textToSend = newMessage.trim();
    if (!textToSend || !selectedPatientId) {
      showToast('Kérjük, válasszon beteget és írjon üzenetet', 'error');
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
          patientId: selectedPatientId,
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
      fetchConversations(); // Refresh conversations
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
    } finally {
      setSending(false);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter(conv =>
    conv.patientName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate total unread count
  const totalUnreadCount = conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Betöltés...</p>
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

  // Conversations list content
  const conversationsListContent = filteredConversations.length === 0 ? (
    <div className="p-4 text-center text-gray-500 text-sm">
      {searchQuery ? 'Nincs találat' : 'Még nincsenek beszélgetések'}
      <p className="text-xs mt-2 text-gray-400">
        {!searchQuery && 'A betegekkel folytatott beszélgetések itt jelennek meg'}
      </p>
    </div>
  ) : (
    filteredConversations.map((conv) => {
      const isSelected = selectedPatientId === conv.patientId;
      
      return (
        <div
          key={conv.patientId}
          onClick={() => {
            setSelectedPatientId(conv.patientId);
            setSelectedPatientName(conv.patientName);
            messagesLoadedRef.current.clear();
          }}
          className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
            isSelected ? 'bg-blue-50' : ''
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="font-medium text-sm truncate">
                {conv.patientName}
              </div>
            </div>
            {conv.unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full flex-shrink-0">
                {conv.unreadCount}
              </span>
            )}
          </div>
          {conv.lastMessage && (
            <div className="text-xs text-gray-500 mt-1 truncate">
              {conv.lastMessage.message.substring(0, 50)}
              {conv.lastMessage.message.length > 50 ? '...' : ''}
            </div>
          )}
        </div>
      );
    })
  );

  // Detail header content
  const detailHeaderContent = selectedPatientId ? (
    <div className="flex items-center justify-between gap-2 w-full">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate flex-1 min-w-0">
        {selectedPatientName}
      </h3>
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
  ) : null;

  // Detail content (messages + input)
  const detailContent = selectedPatientId ? (
    <div className="flex flex-col h-full">
      {/* Messages */}
      {loadingMessages ? (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Üzenetek betöltése...</p>
          </div>
        </div>
      ) : (
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
                : (selectedPatientName || 'Beteg');
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
                        patientId={selectedPatientId}
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
      )}

      {/* Message Input */}
      <div className="border-t bg-white p-2 sm:p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-4">
        <div className="flex items-end gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
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
    </div>
  ) : (
    <div className="flex-1 flex items-center justify-center text-gray-500">
      <div className="text-center">
        <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p>Válasszon egy beszélgetést</p>
        <p className="text-sm mt-2 text-gray-400">
          Válasszon egy beteget a bal oldali listából
        </p>
      </div>
    </div>
  );

  // New chat content
  const newChatContent = showPatientSelector ? (
    <>
      {/* New Chat Header */}
      <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">Új beszélgetés</h3>
          <button
            onClick={() => {
              setShowPatientSelector(false);
              setPatientSearchQuery('');
            }}
            className="p-1 hover:bg-gray-200 rounded transition-colors mobile-touch-target"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
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
          <div className="max-h-60 overflow-y-auto border border-gray-200 rounded bg-white">
            {loadingPatients ? (
              <div className="p-4 text-center text-gray-500 text-sm">Betöltés...</div>
            ) : availablePatients.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">Nincs találat</div>
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
                    className="p-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0 mobile-touch-target"
                  >
                    <div className="font-medium text-sm">{patient.nev}</div>
                    {patient.email && (
                      <div className="text-xs text-gray-500">{patient.email}</div>
                    )}
                  </div>
                ))
            )}
          </div>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p>Válasszon beteget a beszélgetéshez</p>
        </div>
      </div>
    </>
  ) : null;

  // List header content (search)
  const listHeaderContent = (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input
        type="text"
        placeholder="Beteg keresése..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="form-input pl-10 w-full"
      />
    </div>
  );

  return (
    <MessagesShell
      listTitle="Betegek"
      listIcon={<MessageCircle className="w-5 h-5" />}
      unreadCount={totalUnreadCount}
      onNewChat={() => setShowPatientSelector(true)}
      conversationsList={conversationsListContent}
      listHeaderContent={listHeaderContent}
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
