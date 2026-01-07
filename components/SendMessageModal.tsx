'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Search, User, Clock, Mail, ArrowLeft } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

interface Patient {
  id: string;
  nev: string | null;
  taj: string | null;
  email: string | null;
}

interface RecentMessage {
  id: string;
  patientId: string;
  patientName: string | null;
  patientTaj: string | null;
  senderType: 'doctor' | 'patient';
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

interface SendMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SendMessageModal({ isOpen, onClose }: SendMessageModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [recentMessages, setRecentMessages] = useState<RecentMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [conversationMessages, setConversationMessages] = useState<RecentMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [activeTab, setActiveTab] = useState<'send' | 'recent'>('send');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchPatients();
      fetchRecentMessages();
    } else {
      // Reset form when closing
      setSelectedPatient(null);
      setMessage('');
      setSearchQuery('');
      setActiveTab('send');
      setConversationMessages([]);
    }
  }, [isOpen]);

  // Fetch conversation when patient is selected
  useEffect(() => {
    if (selectedPatient && activeTab === 'send') {
      fetchConversation(selectedPatient.id);
    }
  }, [selectedPatient, activeTab]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversationMessages]);

  const fetchConversation = async (patientId: string) => {
    try {
      setLoadingConversation(true);
      const response = await fetch(`/api/messages?patientId=${patientId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a beszélgetés betöltésekor');
      }

      const data = await response.json();
      // Reverse to show oldest first (for chat view)
      const messages = (data.messages || []).reverse();
      setConversationMessages(messages);
    } catch (error) {
      console.error('Hiba a beszélgetés betöltésekor:', error);
      showToast('Hiba történt a beszélgetés betöltésekor', 'error');
    } finally {
      setLoadingConversation(false);
    }
  };

  const fetchRecentMessages = async () => {
    try {
      setLoadingMessages(true);
      const response = await fetch('/api/messages/all?limit=10', {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          return; // Nincs jogosultság
        }
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      const messages = data.messages || [];
      setRecentMessages(messages);
      
      // Olvasatlan üzenetek száma
      const unread = messages.filter((m: RecentMessage) => !m.readAt).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleMessageClick = async (message: RecentMessage) => {
    // Olvasottnak jelölés
    if (!message.readAt) {
      try {
        await fetch(`/api/messages/${message.id}/read`, {
          method: 'PUT',
          credentials: 'include',
        });
        // Frissítjük a helyi állapotot
        setRecentMessages(recentMessages.map(m => 
          m.id === message.id ? { ...m, readAt: new Date() } : m
        ));
        setUnreadCount(Math.max(0, unreadCount - 1));
      } catch (error) {
        console.error('Hiba az üzenet olvasottnak jelölésekor:', error);
      }
    }
    
    // Navigálás a beteg részletek oldalra
    router.push(`/patients/${message.patientId}`);
    onClose();
  };

  const fetchPatients = async () => {
    try {
      setLoading(true);
      // A /api/patients endpoint automatikusan szűri a betegeket a jogosultságok alapján
      const response = await fetch('/api/patients?limit=1000', {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          showToast('Nincs jogosultsága a betegek megtekintéséhez', 'error');
          return;
        }
        throw new Error('Hiba a betegek betöltésekor');
      }

      const data = await response.json();
      setPatients(data.patients || []);
    } catch (error) {
      console.error('Hiba a betegek betöltésekor:', error);
      showToast('Hiba történt a betegek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredPatients = patients.filter((patient) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      patient.nev?.toLowerCase().includes(query) ||
      patient.taj?.toLowerCase().includes(query) ||
      patient.email?.toLowerCase().includes(query)
    );
  });

  const handleSendMessage = async () => {
    if (!selectedPatient) {
      showToast('Kérjük, válasszon beteget', 'error');
      return;
    }

    if (!message.trim()) {
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
          patientId: selectedPatient.id,
          subject: null,
          message: message.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba az üzenet küldésekor');
      }

      const data = await response.json();
      showToast('Üzenet sikeresen elküldve', 'success');
      // Reset form
      setMessage('');
      // Frissítjük a beszélgetést és az üzenetek listáját
      if (selectedPatient) {
        fetchConversation(selectedPatient.id);
      }
      fetchRecentMessages();
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-soft-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <MessageCircle className="w-5 h-5 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-900">Üzenetek</h2>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                  {unreadCount} olvasatlan
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b">
            <button
              onClick={() => setActiveTab('send')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'send'
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              }`}
            >
              <Send className="w-4 h-4 inline mr-2" />
              Üzenet küldése
            </button>
            <button
              onClick={() => setActiveTab('recent')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors relative ${
                activeTab === 'recent'
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              }`}
            >
              <Mail className="w-4 h-4 inline mr-2" />
              Legutóbbi üzenetek
              {unreadCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {activeTab === 'send' ? (
            <>
              {!selectedPatient ? (
                <div className="p-6 space-y-4 overflow-y-auto">
                  {/* Patient Selection */}
                  <div>
                    <label className="form-label flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Beteg kiválasztása
                    </label>
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="form-input pl-10"
                          placeholder="Keresés név, TAJ vagy email alapján..."
                          disabled={loading}
                        />
                      </div>
                      {loading ? (
                        <div className="text-center py-4 text-gray-500">Betöltés...</div>
                      ) : (
                        <div className="border rounded-lg max-h-96 overflow-y-auto">
                          {filteredPatients.length === 0 ? (
                            <div className="text-center py-4 text-gray-500">
                              {searchQuery ? 'Nincs találat' : 'Nincsenek betegek'}
                            </div>
                          ) : (
                            filteredPatients.map((patient) => (
                              <button
                                key={patient.id}
                                onClick={() => setSelectedPatient(patient)}
                                className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b last:border-b-0 transition-colors"
                              >
                                <div className="font-medium text-gray-900">
                                  {patient.nev || 'Név nélküli beteg'}
                                </div>
                                <div className="text-sm text-gray-500 mt-1">
                                  {patient.taj && `TAJ: ${patient.taj}`}
                                  {patient.taj && patient.email && ' • '}
                                  {patient.email && `Email: ${patient.email}`}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Chat Header */}
                  <div className="border-b px-6 py-3 bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSelectedPatient(null)}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        <ArrowLeft className="w-4 h-4 text-gray-600" />
                      </button>
                      <div>
                        <div className="font-semibold text-gray-900">
                          {selectedPatient.nev || 'Név nélküli beteg'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {selectedPatient.taj && `TAJ: ${selectedPatient.taj}`}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Chat Messages */}
                  <div className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-3">
                    {loadingConversation ? (
                      <div className="text-center py-8 text-gray-500">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mx-auto mb-2"></div>
                        Betöltés...
                      </div>
                    ) : conversationMessages.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                        <p>Még nincsenek üzenetek ebben a beszélgetésben</p>
                      </div>
                    ) : (
                      conversationMessages.map((msg) => {
                        const isDoctor = msg.senderType === 'doctor';
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${isDoctor ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[75%] rounded-lg px-4 py-2 ${
                                isDoctor
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white text-gray-900 border border-gray-200'
                              }`}
                            >
                              <div className="text-sm whitespace-pre-wrap break-words">
                                {msg.message}
                              </div>
                              <div className={`text-xs mt-1 ${
                                isDoctor ? 'text-blue-100' : 'text-gray-500'
                              }`}>
                                {format(new Date(msg.createdAt), 'HH:mm', { locale: hu })}
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
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="form-input flex-1 resize-none"
                        rows={2}
                        placeholder="Írja be üzenetét..."
                        disabled={sending}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (message.trim() && !sending) {
                              handleSendMessage();
                            }
                          }
                        }}
                      />
                      <button
                        onClick={handleSendMessage}
                        disabled={!message.trim() || sending}
                        className="btn-primary flex items-center gap-2 px-4 self-end"
                      >
                        <Send className="w-4 h-4" />
                        {sending ? '...' : 'Küldés'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            /* Recent Messages Tab */
            <div className="space-y-3 overflow-y-auto p-6">
              {loadingMessages ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mx-auto mb-2"></div>
                  Betöltés...
                </div>
              ) : recentMessages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Mail className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>Még nincsenek üzenetek</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentMessages.map((message) => (
                    <button
                      key={message.id}
                      onClick={() => handleMessageClick(message)}
                      className={`w-full text-left p-4 rounded-lg border transition-colors ${
                        !message.readAt
                          ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900">
                              {message.patientName || 'Név nélküli beteg'}
                            </span>
                            {!message.readAt && (
                              <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded">
                                Olvasatlan
                              </span>
                            )}
                          </div>
                          {message.patientTaj && (
                            <div className="text-xs text-gray-500 mb-1">TAJ: {message.patientTaj}</div>
                          )}
                          {message.subject && (
                            <div className="text-sm font-medium text-gray-700 mb-1">{message.subject}</div>
                          )}
                          <div className="text-sm text-gray-600 line-clamp-2">
                            {message.message}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock className="w-3 h-3" />
                            {format(new Date(message.createdAt), 'MM.dd HH:mm', { locale: hu })}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

