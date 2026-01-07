'use client';

import { useState, useEffect } from 'react';
import { MessageCircle, Send, Clock, User, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';

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
}

export function PatientMessages() {
  const router = useRouter();
  const { showToast } = useToast();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetchPatientInfo();
  }, []);

  useEffect(() => {
    if (patientId) {
      fetchMessages();
      // Frissítés 30 másodpercenként
      const interval = setInterval(fetchMessages, 30000);
      return () => clearInterval(interval);
    }
  }, [patientId]);

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

  const fetchMessages = async () => {
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
      setMessages(data.messages || []);
      
      // Olvasatlan üzenetek száma (beteg számára csak az orvostól érkező olvasatlan üzenetek)
      const unread = (data.messages || []).filter(
        (m: Message) => m.senderType === 'doctor' && !m.readAt
      ).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!patientId || !newMessage.trim()) {
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
          subject: newSubject.trim() || null,
          message: newMessage.trim(),
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
      setMessages([data.message, ...messages]);
      setNewMessage('');
      setNewSubject('');
      setShowForm(false);
      showToast('Üzenet sikeresen elküldve', 'success');
      
      // Email értesítés automatikusan küldve az orvosnak
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
        if (response.status === 401) {
          router.push('/patient-portal');
          return;
        }
        throw new Error('Hiba az üzenet olvasottnak jelölésekor');
      }

      // Frissítjük a helyi állapotot
      setMessages(messages.map(m => 
        m.id === messageId ? { ...m, readAt: new Date() } : m
      ));
      
      const unread = messages.filter(
        m => m.senderType === 'doctor' && !m.readAt && m.id !== messageId
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

  if (!patientId) {
    return (
      <div className="card p-6 text-center text-gray-500">
        <p>Beteg adatok betöltése...</p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-900">Üzenetek</h2>
          {unreadCount > 0 && (
            <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
              {unreadCount} olvasatlan
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary flex items-center gap-2"
        >
          <Send className="w-4 h-4" />
          Új üzenet
        </button>
      </div>

      {showForm && (
        <div className="border-t pt-4 space-y-3">
          <div>
            <label className="form-label">Tárgy (opcionális)</label>
            <input
              type="text"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              className="form-input"
              placeholder="Üzenet tárgya..."
            />
          </div>
          <div>
            <label className="form-label">Üzenet</label>
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="form-input"
              rows={4}
              placeholder="Írja be üzenetét az orvosnak..."
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSendMessage}
              disabled={sending || !newMessage.trim()}
              className="btn-primary flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Küldés...' : 'Küldés'}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setNewMessage('');
                setNewSubject('');
              }}
              className="btn-secondary"
            >
              Mégse
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>Még nincsenek üzenetek</p>
            <p className="text-sm mt-2">Küldjön üzenetet az orvosának!</p>
          </div>
        ) : (
          messages.map((message) => {
            const isPatient = message.senderType === 'patient';
            const isUnread = !message.readAt && message.senderType === 'doctor';

            return (
              <div
                key={message.id}
                className={`border rounded-lg p-4 ${
                  isUnread ? 'bg-blue-50 border-blue-200' : 'bg-white'
                } ${isPatient ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-blue-500'}`}
                onClick={() => {
                  if (isUnread) {
                    handleMarkAsRead(message.id);
                  }
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {isPatient ? (
                      <User className="w-4 h-4 text-green-600" />
                    ) : (
                      <Mail className="w-4 h-4 text-blue-600" />
                    )}
                    <span className="font-semibold text-gray-900">
                      {isPatient ? 'Ön' : 'Orvos'}
                    </span>
                    {isUnread && (
                      <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded">
                        Olvasatlan
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock className="w-3 h-3" />
                    {format(new Date(message.createdAt), 'yyyy. MM. dd. HH:mm', { locale: hu })}
                  </div>
                </div>
                {message.subject && (
                  <div className="mb-2">
                    <span className="text-sm font-medium text-gray-700">Tárgy: </span>
                    <span className="text-sm text-gray-900">{message.subject}</span>
                  </div>
                )}
                <div className="text-gray-700 whitespace-pre-wrap">{message.message}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

