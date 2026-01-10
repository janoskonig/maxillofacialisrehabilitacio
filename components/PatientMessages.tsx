'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, Clock, User, Mail, Check, CheckCheck, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { getMonogram, getLastName } from '@/lib/utils';

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
  pending?: boolean; // Küldés alatt
}

interface PatientMessagesProps {
  patientId: string;
  patientName?: string | null;
}

export function PatientMessages({ patientId, patientName }: PatientMessagesProps) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMessages();
    // Frissítés 5 másodpercenként (státuszok frissítéséhez)
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [patientId]);

  // Automatikus olvasottnak jelölés, amikor betöltjük az üzeneteket
  useEffect(() => {
    if (messages.length > 0 && !loading) {
      // Keresünk olvasatlan beteg üzeneteket
      const unreadPatientMessages = messages.filter(
        m => m.senderType === 'patient' && !m.readAt && !m.pending
      );
      
      // Jelöljük olvasottnak őket (csak ha van ilyen)
      if (unreadPatientMessages.length > 0) {
        unreadPatientMessages.forEach(msg => {
          // Aszinkron hívás, de nem várjuk meg
          fetch(`/api/messages/${msg.id}/read`, {
            method: 'PUT',
            credentials: 'include',
          }).catch(err => console.error('Hiba az üzenet olvasottnak jelölésekor:', err));
        });
        
        // Frissítjük a helyi állapotot
        setMessages(messages.map(m => 
          unreadPatientMessages.some(um => um.id === m.id) 
            ? { ...m, readAt: new Date() } 
            : m
        ));
        
        // Frissítjük az olvasatlan számlálót
        setUnreadCount(0);
      }
    }
  }, [messages.length, loading]); // Csak akkor fut le, ha az üzenetek száma vagy a loading állapot változik

  const fetchMessages = async () => {
    try {
      const response = await fetch(`/api/messages?patientId=${patientId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      // Reverse to show oldest first (for chat view)
      const messages = (data.messages || []).reverse();
      
      // Eltávolítjuk a pending üzeneteket, mert most már vannak valódi üzenetek
      setMessages(messages.filter((m: Message) => !m.pending));
      
      // Olvasatlan üzenetek száma (orvos számára csak a betegtől érkező olvasatlan üzenetek)
      const unread = (data.messages || []).filter(
        (m: Message) => m.senderType === 'patient' && !m.readAt
      ).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim()) {
      showToast('Kérjük, írjon üzenetet', 'error');
      return;
    }

    try {
      setSending(true);
      
      // Hozzáadunk egy pending üzenetet azonnal
      const tempId = `pending-${Date.now()}`;
      const pendingMessage: Message = {
        id: tempId,
        patientId: patientId,
        senderType: 'doctor',
        senderId: '',
        senderEmail: '',
        subject: null,
        message: newMessage.trim(),
        readAt: null,
        createdAt: new Date(),
        pending: true,
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
          patientId,
          subject: null,
          message: newMessage.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        // Eltávolítjuk a pending üzenetet, ha hiba történt
        setMessages(messages.filter(m => m.id !== tempId));
        setPendingMessageId(null);
        throw new Error(error.error || 'Hiba az üzenet küldésekor');
      }

      const data = await response.json();
      
      // Frissítjük a pending üzenetet a valódi üzenettel
      setMessages(messages.map(m => 
        m.id === tempId ? { ...data.message, pending: false } : m
      ));
      setPendingMessageId(null);
      
      setNewMessage('');
      showToast('Üzenet sikeresen elküldve', 'success');
      
      // Frissítjük az üzeneteket késleltetve
      setTimeout(() => {
        fetchMessages();
      }, 500);
      
      // Email értesítés automatikusan küldve
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleMarkAsRead = async (messageId: string) => {
    try {
      const response = await fetch(`/api/messages/${messageId}/read`, {
        method: 'PUT',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az üzenet olvasottnak jelölésekor');
      }

      // Frissítjük a helyi állapotot
      setMessages(messages.map(m => 
        m.id === messageId ? { ...m, readAt: new Date() } : m
      ));
      
      const unread = messages.filter(
        m => m.senderType === 'patient' && !m.readAt && m.id !== messageId
      ).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Hiba az üzenet olvasottnak jelölésekor:', error);
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
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            Üzenetek {patientName && `- ${patientName}`}
          </h3>
          {unreadCount > 0 && (
            <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
              {unreadCount} olvasatlan
            </span>
          )}
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>Még nincsenek üzenetek</p>
          </div>
        ) : (
          messages.map((message) => {
            // Orvos oldalon: orvos üzenetei jobbra kék, beteg üzenetei balra fehér/kék
            const isFromDoctor = message.senderType === 'doctor';
            const isFromPatient = message.senderType === 'patient';
            const isUnread = !message.readAt && isFromPatient;
            const isPending = message.pending === true;
            const isRead = message.readAt !== null;
            
            // Csak a saját üzeneteinknek mutatjuk a státuszt (orvos üzenetei)
            const showStatus = isFromDoctor;

            const senderName = isFromDoctor 
              ? (message.senderEmail || 'Orvos')
              : (patientName || 'Beteg');
            const lastName = getLastName(senderName);
            const monogram = getMonogram(senderName);

            return (
              <div
                key={message.id}
                className={`flex flex-col ${isFromDoctor ? 'items-end' : 'items-start'}`}
                onClick={() => {
                  if (isUnread) {
                    handleMarkAsRead(message.id);
                  }
                }}
              >
                {/* Sender name and monogram */}
                <div className={`flex items-center gap-1.5 mb-1 px-1 ${isFromDoctor ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                    isFromDoctor 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {monogram}
                  </div>
                  <span className="text-xs font-medium text-gray-700">{lastName}</span>
                </div>
                <div
                  className={`max-w-[75%] rounded-lg px-4 py-2 ${
                    isFromDoctor
                      ? 'bg-blue-600 text-white'
                      : isUnread
                      ? 'bg-blue-100 text-gray-900 border-2 border-blue-300'
                      : 'bg-white text-gray-900 border border-gray-200'
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {message.message}
                  </div>
                  <div className={`text-xs mt-1 flex items-center gap-1.5 ${
                    isFromDoctor ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    <span>{format(new Date(message.createdAt), 'HH:mm', { locale: hu })}</span>
                    {showStatus && (
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
                    {isUnread && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs font-semibold text-white bg-red-500 rounded">
                        Olvasatlan
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
      <div className="border-t bg-white p-4">
        <div className="flex gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="form-input flex-1 resize-none"
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
            className="btn-primary flex items-center gap-2 px-4 self-end"
          >
            <Send className="w-4 h-4" />
            {sending ? '...' : 'Küldés'}
          </button>
        </div>
      </div>
    </div>
  );
}

