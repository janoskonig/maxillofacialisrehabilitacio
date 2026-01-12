'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, Check, CheckCheck, Loader2, Users, Search } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { Message } from '@/lib/communication';
import { PatientMention } from './PatientMention';
import { MessageTextRenderer } from './MessageTextRenderer';
import { getCurrentUser } from '@/lib/auth';
import { getMonogram, getLastName } from '@/lib/utils';

interface PatientConversation {
  patientId: string;
  patientName: string;
  patientTaj: string | null;
  lastMessage: Message | null;
  unreadCount: number;
}

export function PatientMessagesList() {
  const { showToast } = useToast();
  const [conversations, setConversations] = useState<PatientConversation[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch conversations and unread count
  useEffect(() => {
    const loadData = async () => {
      await fetchConversations();
      await fetchUnreadCount();
      setLoading(false);
    };
    loadData();
    
    // Frissítés 5 másodpercenként
    const interval = setInterval(() => {
      fetchConversations();
      fetchUnreadCount();
      if (selectedPatientId) {
        fetchMessages();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch messages when patient is selected
  useEffect(() => {
    if (selectedPatientId) {
      fetchMessages();
    } else {
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatientId]);

  // Fetch current user
  useEffect(() => {
    const loadCurrentUser = async () => {
      const user = await getCurrentUser();
      if (user && user.id) {
        setCurrentUserId(user.id);
      }
    };
    loadCurrentUser();
  }, []);

  // Auto-mark as read when messages are loaded
  useEffect(() => {
    if (messages.length > 0 && !loading && selectedPatientId) {
      // Csak a betegtől érkező olvasatlan üzeneteket jelöljük olvasottnak
      const unreadPatientMessages = messages.filter(
        m => m.senderType === 'patient' && !m.readAt && !m.id.startsWith('pending-')
      );
      
      if (unreadPatientMessages.length > 0) {
        unreadPatientMessages.forEach(msg => {
          // Csak UUID formátumú ID-kat próbálunk meg olvasottnak jelölni
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(msg.id)) {
            fetch(`/api/messages/${msg.id}/read`, {
              method: 'PUT',
              credentials: 'include',
            }).catch(err => console.error('Hiba az üzenet olvasottnak jelölésekor:', err));
          }
        });
        
        setMessages(prevMessages => 
          prevMessages.map(m => 
            unreadPatientMessages.some(um => um.id === m.id) 
              ? { ...m, readAt: new Date() } 
              : m
          )
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, loading, selectedPatientId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const response = await fetch('/api/messages/conversations', {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API error:', errorData);
        throw new Error(errorData.error || 'Hiba a konverzációk betöltésekor');
      }

      const data = await response.json();
      const conversationsToSet = data.conversations || [];
      setConversations(conversationsToSet);
    } catch (error) {
      console.error('Hiba a konverzációk betöltésekor:', error);
      showToast('Hiba történt a konverzációk betöltésekor', 'error');
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const response = await fetch('/api/messages/all?unreadOnly=true', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az olvasatlan üzenetek számának lekérdezésekor');
      }

      const data = await response.json();
      setUnreadCount((data.messages || []).length);
    } catch (error) {
      console.error('Hiba az olvasatlan üzenetek számának lekérdezésekor:', error);
    }
  };

  const fetchMessages = async () => {
    if (!selectedPatientId) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/messages?patientId=${selectedPatientId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || 'Unknown error' };
        }
        throw new Error(errorData.error || 'Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      // Reverse to show oldest first (for chat view)
      const messages = (data.messages || []).reverse() as Message[];
      setMessages(messages.filter((m: Message) => !m.id.startsWith('pending-')));
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast(error instanceof Error ? error.message : 'Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (messageText?: string) => {
    const textToSend = messageText || newMessage.trim();
    if (!textToSend || !selectedPatientId) {
      if (!messageText) {
        showToast('Kérjük, válasszon beteget és írjon üzenetet', 'error');
      }
      return;
    }

    try {
      setSending(true);
      
      // Pending message
      const tempId = `pending-${Date.now()}`;
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
      };
      
      setMessages([...messages, pendingMessage]);
      setPendingMessageId(tempId);
      
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
        setMessages(messages.filter(m => m.id !== tempId));
        setPendingMessageId(null);
        throw new Error(error.error || 'Hiba az üzenet küldésekor');
      }

      const data = await response.json();
      
      setMessages(messages.map(m => 
        m.id === tempId ? { ...data.message } : m
      ));
      setPendingMessageId(null);
      
      if (!messageText) {
        setNewMessage('');
      }
      showToast('Üzenet sikeresen elküldve', 'success');
      
      setTimeout(() => {
        fetchMessages();
        fetchConversations();
      }, 500);
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleSelectPatient = (patientId: string, patientName: string) => {
    setSelectedPatientId(patientId);
    setSelectedPatientName(patientName);
    setLoading(true);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    setCursorPosition(e.target.selectionStart);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (newMessage.trim() && !sending) {
        handleSendMessage();
      }
    }
  };

  const handleTextareaSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPosition((e.target as HTMLTextAreaElement).selectionStart);
  };


  if (loading && conversations.length === 0) {
    return (
      <div className="flex h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Betöltés...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-patient-messages-list className="flex h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Conversations List */}
      <div className="w-80 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Betegek
            </h3>
            {unreadCount > 0 && (
              <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && !loading ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              Még nincsenek beszélgetések
              <p className="text-xs mt-2 text-gray-400">Még nem érkeztek üzenetek betegektől</p>
            </div>
          ) : (
              conversations.map((conv) => (
                <div
                  key={conv.patientId}
                  onClick={() => handleSelectPatient(conv.patientId, conv.patientName)}
                  className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                    selectedPatientId === conv.patientId ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{conv.patientName}</div>
                    {conv.unreadCount > 0 && (
                      <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  {conv.patientTaj && (
                    <div className="text-xs text-gray-500 mt-0.5">TAJ: {conv.patientTaj}</div>
                  )}
                  {conv.lastMessage && (
                    <div className="text-xs text-gray-500 mt-1 truncate">
                      {conv.lastMessage.message.substring(0, 50)}
                      {conv.lastMessage.message.length > 50 ? '...' : ''}
                    </div>
                  )}
                </div>
              ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`${selectedPatientId ? 'flex' : 'hidden sm:flex'} flex-1 flex flex-col`}>
        {selectedPatientId ? (
          <>
            {/* Header */}
            <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
                {selectedPatientName}
              </h3>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-2 sm:p-4 bg-gray-50 space-y-3">
              {loading ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                  <p>Betöltés...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>Még nincsenek üzenetek</p>
                </div>
              ) : (
                messages.map((message) => {
                  const isFromDoctor = message.senderType === 'doctor';
                  const isPending = message.id.startsWith('pending-');
                  const isRead = message.readAt !== null;

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isFromDoctor ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-lg px-4 py-2 ${
                          isFromDoctor
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
                            currentUserId={currentUserId}
                            onSendMessage={async (messageText) => {
                              await handleSendMessage(messageText);
                            }}
                          />
                        </div>
                        <div className={`text-xs mt-1 flex items-center gap-1.5 ${
                          isFromDoctor ? 'text-blue-100' : 'text-gray-500'
                        }`}>
                          <span>{format(new Date(message.createdAt), 'HH:mm', { locale: hu })}</span>
                          {isFromDoctor && (
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
            <div className="border-t bg-white p-2 sm:p-4 relative">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={newMessage}
                    onChange={handleTextareaChange}
                    onKeyDown={handleTextareaKeyDown}
                    onSelect={handleTextareaSelect}
                    className="form-input flex-1 resize-none w-full min-h-[60px] sm:min-h-0"
                    rows={2}
                    placeholder="Írja be üzenetét... (használjon @ jelet beteg jelöléséhez)"
                    disabled={sending}
                  />
                  <PatientMention
                    text={newMessage}
                    cursorPosition={cursorPosition}
                    onSelect={(mentionFormat, patientName) => {
                      // Replace @query with mentionFormat
                      const textBefore = newMessage.substring(0, cursorPosition);
                      const lastAtIndex = textBefore.lastIndexOf('@');
                      if (lastAtIndex !== -1) {
                        const textAfter = newMessage.substring(cursorPosition);
                        const newText = `${newMessage.substring(0, lastAtIndex)}${mentionFormat} ${textAfter}`;
                        setNewMessage(newText);
                        // Set cursor position after mention
                        setTimeout(() => {
                          if (textareaRef.current) {
                            const newPos = lastAtIndex + mentionFormat.length + 1;
                            textareaRef.current.setSelectionRange(newPos, newPos);
                            setCursorPosition(newPos);
                          }
                        }, 0);
                      }
                    }}
                  />
                </div>
                <button
                  onClick={() => handleSendMessage()}
                  disabled={sending || !newMessage.trim()}
                  className="btn-primary flex items-center justify-center gap-2 px-4 py-2 sm:self-end w-full sm:w-auto"
                >
                  <Send className="w-4 h-4" />
                  <span className="sm:inline">{sending ? '...' : 'Küldés'}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>Válasszon egy beteget a beszélgetéshez</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

