'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, Check, CheckCheck, Loader2, Users, Search, UserPlus, Plus, Edit2, X, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { DoctorMessage, DoctorConversation } from '@/lib/types';
import { PatientMention } from './PatientMention';
import { MessageTextRenderer } from './MessageTextRenderer';
import { getCurrentUser, AuthUser } from '@/lib/auth';
import { CreateGroupChatModal } from './CreateGroupChatModal';
import { RecipientSelector } from './RecipientSelector';
import { getMonogram, getLastName } from '@/lib/utils';

export function DoctorMessages() {
  const { showToast } = useToast();
  const [conversations, setConversations] = useState<DoctorConversation[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDoctorName, setSelectedDoctorName] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [groupParticipants, setGroupParticipants] = useState<Array<{ userId: string; userName: string; userEmail: string }>>([]);
  const [messages, setMessages] = useState<DoctorMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [doctors, setDoctors] = useState<Array<{ id: string; name: string; email: string; intezmeny: string | null }>>([]);
  const [showDoctorSelector, setShowDoctorSelector] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [doctorSearchQuery, setDoctorSearchQuery] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [newChatRecipients, setNewChatRecipients] = useState<Array<{ id: string; name: string; email: string; intezmeny: string | null }>>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isGroupCreator, setIsGroupCreator] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
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
      } else if (selectedGroupId) {
        fetchGroupMessages();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch messages when doctor or group is selected
  useEffect(() => {
    if (selectedDoctorId) {
      setSelectedGroupId(null);
      setSelectedGroupName(null);
      setGroupParticipants([]);
      fetchMessages();
    } else if (selectedGroupId) {
      setSelectedDoctorId(null);
      setSelectedDoctorName(null);
      fetchGroupMessages();
      fetchGroupParticipants();
    } else {
      setMessages([]);
    }
  }, [selectedDoctorId, selectedGroupId]);

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

  // Auto-mark as read when messages are loaded (only for individual conversations)
  useEffect(() => {
    if (messages.length > 0 && !loading && selectedDoctorId && !selectedGroupId && currentUserId) {
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
  }, [messages.length, loading, selectedDoctorId, selectedGroupId, currentUserId]);

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

  // Force scroll to bottom when doctor or group is selected
  useEffect(() => {
    if ((selectedDoctorId || selectedGroupId) && !loading) {
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        } else if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
      }, 200);
    }
  }, [selectedDoctorId, selectedGroupId, loading]);

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

  const fetchGroupMessages = async () => {
    if (!selectedGroupId) return;

    try {
      const response = await fetch(`/api/doctor-messages?groupId=${selectedGroupId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a csoportos beszélgetés üzeneteinek betöltésekor');
      }

      const data = await response.json();
      const messages = (data.messages || []) as DoctorMessage[];
      setMessages(messages.filter((m: DoctorMessage) => !m.pending));
    } catch (error) {
      console.error('Hiba a csoportos beszélgetés üzeneteinek betöltésekor:', error);
      showToast('Hiba történt az üzenetek betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupParticipants = async () => {
    if (!selectedGroupId) return;

    try {
      const response = await fetch(`/api/doctor-messages/groups/${selectedGroupId}/participants`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a résztvevők betöltésekor');
      }

      const data = await response.json();
      setGroupParticipants(data.participants || []);
      
      // Check if current user is the creator
      if (data.createdBy && currentUserId) {
        setIsGroupCreator(data.createdBy === currentUserId);
      } else {
        setIsGroupCreator(false);
      }
    } catch (error) {
      console.error('Hiba a résztvevők betöltésekor:', error);
      setIsGroupCreator(false);
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

  const handleSendMessage = async (messageText?: string) => {
    const textToSend = messageText || newMessage.trim();
    if (!textToSend || (!selectedDoctorId && !selectedGroupId)) {
      if (!messageText) {
        showToast('Kérjük, válasszon beszélgetést és írjon üzenetet', 'error');
      }
      return;
    }

    try {
      setSending(true);
      
      // Pending message
      const tempId = `pending-${Date.now()}`;
      const pendingMessage: DoctorMessage = {
        id: tempId,
        senderId: currentUserId || '',
        recipientId: selectedDoctorId || '',
        senderEmail: '',
        senderName: null,
        subject: null,
        message: textToSend,
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
          recipientId: selectedDoctorId || undefined,
          groupId: selectedGroupId || undefined,
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
        m.id === tempId ? { ...data.message, pending: false } : m
      ));
      setPendingMessageId(null);
      
      if (!messageText) {
        setNewMessage('');
      }
      showToast('Üzenet sikeresen elküldve', 'success');
      
      setTimeout(() => {
        if (selectedDoctorId) {
          fetchMessages();
        } else if (selectedGroupId) {
          fetchGroupMessages();
        }
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
    setSelectedGroupId(null);
    setSelectedGroupName(null);
    setGroupParticipants([]);
    setLoading(true);
    setShowDoctorSelector(false);
    setDoctorSearchQuery('');
  };

  const handleSelectGroup = (groupId: string, groupName: string | null) => {
    setSelectedGroupId(groupId);
    setSelectedGroupName(groupName);
    setSelectedDoctorId(null);
    setSelectedDoctorName(null);
    setLoading(true);
    setShowDoctorSelector(false);
    setDoctorSearchQuery('');
    setShowNewChat(false);
    setNewChatRecipients([]);
  };

  const handleStartNewChat = () => {
    setShowNewChat(true);
    setSelectedDoctorId(null);
    setSelectedDoctorName(null);
    setSelectedGroupId(null);
    setSelectedGroupName(null);
    setNewChatRecipients([]);
    setMessages([]);
  };

  const handleNewChatRecipientsChange = (recipients: Array<{ id: string; name: string; email: string; intezmeny: string | null }>) => {
    setNewChatRecipients(recipients);
  };

  const handleStartConversation = async () => {
    if (newChatRecipients.length === 0) {
      showToast('Kérjük, válasszon legalább egy címzettet', 'error');
      return;
    }


    try {
      if (newChatRecipients.length === 1) {
        // Egy-egy beszélgetés
        handleSelectDoctor(newChatRecipients[0].id, newChatRecipients[0].name);
        setShowNewChat(false);
        setNewChatRecipients([]);
      } else {
        // Csoportos beszélgetés létrehozása
        setLoading(true);
        const response = await fetch('/api/doctor-messages/groups', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            participantIds: newChatRecipients.map(r => r.id),
            name: null, // Névtelen csoport, később át lehet nevezni
          }),
        });


        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Hiba a csoportos beszélgetés létrehozásakor');
        }

        const data = await response.json();
        handleSelectGroup(data.groupId, null);
        setShowNewChat(false);
        setNewChatRecipients([]);
        showToast('Csoportos beszélgetés létrehozva', 'success');
      }
    } catch (error: any) {
      console.error('Hiba a beszélgetés indításakor:', error);
      showToast(error.message || 'Hiba történt a beszélgetés indításakor', 'error');
      setLoading(false);
    }
  };

  const handleRenameGroup = async () => {
    if (!selectedGroupId) return;

    try {
      const response = await fetch(`/api/doctor-messages/groups/${selectedGroupId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: newGroupName.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba a csoportos beszélgetés átnevezésekor');
      }

      setSelectedGroupName(newGroupName.trim() || null);
      setEditingGroupName(false);
      setNewGroupName('');
      showToast('Csoportos beszélgetés átnevezve', 'success');
      fetchConversations();
    } catch (error: any) {
      console.error('Hiba a csoportos beszélgetés átnevezésekor:', error);
      showToast(error.message || 'Hiba történt a csoportos beszélgetés átnevezésekor', 'error');
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroupId) return;

    if (!confirm('Biztosan törölni szeretné ezt a csoportos beszélgetést? Ez a művelet nem visszavonható, és az összes üzenet törlődik.')) {
      return;
    }

    try {
      setDeletingGroup(true);
      const response = await fetch(`/api/doctor-messages/groups/${selectedGroupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba a csoportos beszélgetés törlésekor');
      }

      showToast('Csoportos beszélgetés törölve', 'success');
      setSelectedGroupId(null);
      setSelectedGroupName(null);
      setGroupParticipants([]);
      setMessages([]);
      fetchConversations();
    } catch (error: any) {
      console.error('Hiba a csoportos beszélgetés törlésekor:', error);
      showToast(error.message || 'Hiba történt a csoportos beszélgetés törlésekor', 'error');
    } finally {
      setDeletingGroup(false);
    }
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

  return (
    <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Conversations List */}
      <div className={`${selectedDoctorId || selectedGroupId ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 border-r border-gray-200 flex flex-col`}>
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
            onClick={handleStartNewChat}
            className="w-full btn-primary flex items-center gap-2 justify-center"
          >
            <Plus className="w-4 h-4" />
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
            conversations.map((conv) => {
              const isSelected = (conv.type === 'individual' && selectedDoctorId === conv.doctorId) ||
                                (conv.type === 'group' && selectedGroupId === conv.groupId);
              
              return (
                <div
                  key={conv.type === 'individual' ? conv.doctorId : conv.groupId}
                  onClick={() => {
                    if (conv.type === 'individual' && conv.doctorId) {
                      handleSelectDoctor(conv.doctorId, conv.doctorName);
                    } else if (conv.type === 'group' && conv.groupId) {
                      handleSelectGroup(conv.groupId, conv.groupName || null);
                    }
                  }}
                  className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                    isSelected ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {conv.type === 'group' && (
                        <Users className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      )}
                      <div className="font-medium text-sm truncate">
                        {conv.type === 'individual' 
                          ? conv.doctorName 
                          : (conv.groupName || `Csoport (${conv.participantCount || 0} résztvevő)`)}
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
                  {conv.type === 'group' && conv.participantCount && (
                    <div className="text-xs text-gray-400 mt-1">
                      {conv.participantCount} résztvevő
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {showNewChat ? (
          <>
            {/* New Chat Header */}
            <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900">Új beszélgetés</h3>
                <button
                  onClick={() => {
                    setShowNewChat(false);
                    setNewChatRecipients([]);
                  }}
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <RecipientSelector
                selectedRecipients={newChatRecipients}
                onRecipientsChange={handleNewChatRecipientsChange}
              />
              {newChatRecipients.length > 0 && (
                <button
                  onClick={handleStartConversation}
                  className="mt-3 w-full btn-primary flex items-center justify-center gap-2"
                >
                  Beszélgetés indítása
                </button>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>Válasszon címzett(ek)et a beszélgetéshez</p>
              </div>
            </div>
          </>
        ) : (selectedDoctorId || selectedGroupId) ? (
          <>
            {/* Header */}
            <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {editingGroupName && selectedGroupId ? (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleRenameGroup();
                          } else if (e.key === 'Escape') {
                            setEditingGroupName(false);
                            setNewGroupName('');
                          }
                        }}
                        placeholder="Csoport neve..."
                        className="form-input flex-1"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleRenameGroup}
                          className="btn-primary px-3 py-1 text-sm flex-1 sm:flex-none"
                        >
                          Mentés
                        </button>
                        <button
                          onClick={() => {
                            setEditingGroupName(false);
                            setNewGroupName('');
                          }}
                          className="btn-secondary px-3 py-1 text-sm flex-1 sm:flex-none"
                        >
                          Mégse
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center gap-2 truncate">
                        {selectedGroupId && <Users className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 flex-shrink-0" />}
                        <span className="truncate">{selectedDoctorId ? selectedDoctorName : (selectedGroupName || 'Csoportos beszélgetés')}</span>
                      </h3>
                      {selectedGroupId && groupParticipants.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <Users className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600 flex-shrink-0" />
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {groupParticipants.map((participant, idx) => (
                              <span
                                key={participant.userId}
                                className="text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full"
                                title={participant.userEmail}
                              >
                                {participant.userName || participant.userEmail}
                                {idx < groupParticipants.length - 1 && ','}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                  {selectedGroupId && !editingGroupName && (
                    <>
                      <button
                        onClick={() => {
                          setEditingGroupName(true);
                          setNewGroupName(selectedGroupName || '');
                        }}
                        className="btn-secondary flex items-center gap-1 text-sm px-2 py-1"
                        title="Csoport átnevezése"
                      >
                        <Edit2 className="w-4 h-4" />
                        <span className="hidden sm:inline">Átnevezés</span>
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateGroupModal(true);
                        }}
                        className="btn-secondary flex items-center gap-1 text-sm px-2 py-1"
                        title="Résztvevők hozzáadása"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span className="hidden sm:inline">Hozzáadás</span>
                      </button>
                      {isGroupCreator && (
                        <button
                          onClick={handleDeleteGroup}
                          disabled={deletingGroup}
                          className="btn-secondary flex items-center gap-1 text-sm px-2 py-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Csoport törlése"
                        >
                          {deletingGroup ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                          <span className="hidden sm:inline">Törlés</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 sm:p-4 bg-gray-50 space-y-3">
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
                  const senderName = message.senderName || message.senderEmail || 'Ismeretlen';
                  const lastName = getLastName(senderName);
                  const monogram = getMonogram(senderName);

                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${isFromMe ? 'items-end' : 'items-start'}`}
                    >
                      {/* Sender name and monogram */}
                      {!isFromMe && (
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-700">
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
                            chatType="doctor-doctor"
                            patientId={null}
                            messageId={message.id}
                            senderId={message.senderId}
                            currentUserId={currentUserId}
                            onSendMessage={async (messageText) => {
                              await handleSendMessage(messageText);
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
              <p>Válasszon egy beszélgetést</p>
              <p className="text-sm mt-2 text-gray-400">
                Válasszon egy orvost vagy csoportos beszélgetést
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create Group Chat Modal */}
      <CreateGroupChatModal
        isOpen={showCreateGroupModal}
        onClose={() => setShowCreateGroupModal(false)}
        onGroupCreated={() => {
          fetchConversations();
          if (selectedGroupId) {
            fetchGroupParticipants();
          }
          setShowCreateGroupModal(false);
        }}
        existingGroupId={selectedGroupId}
      />
    </div>
  );
}

