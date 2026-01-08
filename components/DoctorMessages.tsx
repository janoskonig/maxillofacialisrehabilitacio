'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, Check, CheckCheck, Loader2, Users, Search } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { DoctorMessage, DoctorConversation } from '@/lib/types';
import { PatientMention } from './PatientMention';
import { MessageTextRenderer } from './MessageTextRenderer';
import { getCurrentUser, AuthUser } from '@/lib/auth';

export function DoctorMessages() {
  const { showToast } = useToast();
  const [conversations, setConversations] = useState<DoctorConversation[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDoctorName, setSelectedDoctorName] = useState<string | null>(null);
  const [messages, setMessages] = useState<DoctorMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [doctors, setDoctors] = useState<Array<{ id: string; name: string; email: string; intezmeny: string | null }>>([]);
  const [showDoctorSelector, setShowDoctorSelector] = useState(false);
  const [doctorSearchQuery, setDoctorSearchQuery] = useState('');
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
      if (selectedDoctorId) {
        fetchMessages();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch messages when doctor is selected
  useEffect(() => {
    if (selectedDoctorId) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [selectedDoctorId]);

  // Fetch doctors list and current user
  useEffect(() => {
    fetchDoctors();
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
    if (messages.length > 0 && !loading && selectedDoctorId && currentUserId) {
      // Csak a valódi üzeneteket jelöljük olvasottnak (nem pending-eket)
      const unreadMessages = messages.filter(
        m => m.recipientId === currentUserId && !m.readAt && !m.pending && !m.id.startsWith('pending-')
      );
      
      if (unreadMessages.length > 0) {
        unreadMessages.forEach(msg => {
          // Csak UUID formátumú ID-kat próbálunk meg olvasottnak jelölni
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(msg.id)) {
            fetch(`/api/doctor-messages/${msg.id}/read`, {
              method: 'PUT',
              credentials: 'include',
            }).catch(err => console.error('Hiba az üzenet olvasottnak jelölésekor:', err));
          }
        });
        
        setMessages(messages.map(m => 
          unreadMessages.some(um => um.id === m.id) 
            ? { ...m, readAt: new Date() } 
            : m
        ));
      }
    }
  }, [messages.length, loading, selectedDoctorId, currentUserId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const response = await fetch('/api/doctor-messages?conversations=true', {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API error:', errorData);
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
      const messages = (data.messages || []) as DoctorMessage[];
      setMessages(messages.filter((m: DoctorMessage) => !m.pending));
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchDoctors = async () => {
    try {
      const response = await fetch('/api/users/doctors', {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Doctors API error:', errorData);
        throw new Error(errorData.error || 'Hiba az orvosok betöltésekor');
      }

      const data = await response.json();
      setDoctors(data.doctors || []);
    } catch (error) {
      console.error('Hiba az orvosok betöltésekor:', error);
      showToast('Hiba történt az orvosok betöltésekor', 'error');
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedDoctorId) {
      showToast('Kérjük, válasszon orvost és írjon üzenetet', 'error');
      return;
    }

    try {
      setSending(true);
      
      // Pending message - beállítjuk a senderId-t a currentUserId-re, hogy azonnal jobb oldalon jelenjen meg
      const tempId = `pending-${Date.now()}`;
      const pendingMessage: DoctorMessage = {
        id: tempId,
        senderId: currentUserId || '',
        recipientId: selectedDoctorId,
        senderEmail: '',
        senderName: null,
        subject: null,
        message: newMessage.trim(),
        readAt: null,
        createdAt: new Date(),
        pending: true,
      };
      
      setMessages([...messages, pendingMessage]);
      setPendingMessageId(tempId);
      
      const response = await fetch('/api/doctor-messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          recipientId: selectedDoctorId,
          subject: null,
          message: newMessage.trim(),
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
        m.id === tempId ? { ...data.message, pending: false } : m
      ));
      setPendingMessageId(null);
      
      setNewMessage('');
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

  const handleSelectDoctor = (doctorId: string, doctorName: string) => {
    setSelectedDoctorId(doctorId);
    setSelectedDoctorName(doctorName);
    setLoading(true);
    setShowDoctorSelector(false);
    setDoctorSearchQuery('');
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

  const filteredDoctors = doctors.filter(doctor => {
    if (!doctorSearchQuery) return true;
    const query = doctorSearchQuery.toLowerCase();
    return (
      doctor.name.toLowerCase().includes(query) ||
      doctor.email.toLowerCase().includes(query) ||
      (doctor.intezmeny && doctor.intezmeny.toLowerCase().includes(query))
    );
  });

  if (loading) {
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
    <div className="flex h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Conversations List */}
      <div className="w-80 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Orvosok
            </h3>
            {unreadCount > 0 && (
              <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowDoctorSelector(!showDoctorSelector)}
            className="w-full btn-secondary flex items-center gap-2 justify-center"
          >
            <Search className="w-4 h-4" />
            Új beszélgetés
          </button>
          {showDoctorSelector && (
            <div className="mt-2">
              <input
                type="text"
                value={doctorSearchQuery}
                onChange={(e) => setDoctorSearchQuery(e.target.value)}
                placeholder="Orvos keresése..."
                className="form-input w-full mb-2"
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded">
                {filteredDoctors.map((doctor) => (
                  <div
                    key={doctor.id}
                    onClick={() => handleSelectDoctor(doctor.id, doctor.name)}
                    className={`p-2 cursor-pointer hover:bg-gray-50 ${
                      selectedDoctorId === doctor.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="font-medium text-sm">{doctor.name}</div>
                    {doctor.intezmeny && (
                      <div className="text-xs text-gray-500">{doctor.intezmeny}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && !loading ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              Még nincsenek beszélgetések
              <p className="text-xs mt-2 text-gray-400">Kattintson az "Új beszélgetés" gombra egy orvos kiválasztásához</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.doctorId}
                onClick={() => handleSelectDoctor(conv.doctorId, conv.doctorName)}
                className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                  selectedDoctorId === conv.doctorId ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{conv.doctorName}</div>
                  {conv.unreadCount > 0 && (
                    <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
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
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedDoctorId ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">
                {selectedDoctorName}
              </h3>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>Még nincsenek üzenetek</p>
                </div>
              ) : (
                messages.map((message) => {
                  // Check if message is from current user
                  const isFromMe = currentUserId ? message.senderId === currentUserId : false;
                  const isPending = message.pending === true;
                  const isRead = message.readAt !== null;

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-lg px-4 py-2 ${
                          isFromMe
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-gray-900 border border-gray-200'
                        }`}
                      >
                        <div className="text-sm">
                          <MessageTextRenderer text={message.message} />
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
            <div className="border-t bg-white p-4 relative">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={newMessage}
                    onChange={handleTextareaChange}
                    onKeyDown={handleTextareaKeyDown}
                    onSelect={handleTextareaSelect}
                    className="form-input flex-1 resize-none"
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
                  onClick={handleSendMessage}
                  disabled={sending || !newMessage.trim()}
                  className="btn-primary flex items-center gap-2 px-4 self-end"
                >
                  <Send className="w-4 h-4" />
                  {sending ? '...' : 'Küldés'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>Válasszon egy orvost a beszélgetéshez</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

