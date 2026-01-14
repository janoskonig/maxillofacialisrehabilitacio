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
import { useSocket } from '@/contexts/SocketContext';

export function DoctorMessages() {
  const { showToast } = useToast();
  const { socket, isConnected } = useSocket();
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
      // Csak akkor töltjük be az adatokat, ha van bejelentkezett felhasználó
      const user = await getCurrentUser();
      if (!user || !user.id) {
        setLoading(false);
        return;
      }
      
      await fetchConversations();
      await fetchUnreadCount();
      setLoading(false);
    };
    loadData();
    
    // Frissítés 5 másodpercenként
    const interval = setInterval(async () => {
      const user = await getCurrentUser();
      if (!user || !user.id) {
        return;
      }
      
      fetchConversations();
      fetchUnreadCount();
      if (selectedDoctorId) {
        fetchMessages();
      } else if (selectedGroupId) {
        fetchGroupMessages();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedDoctorId, selectedGroupId]);

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

  // Auto-mark as read when conversation opens and messages are loaded
  // Egyszerűbb és megbízhatóbb megoldás: amikor a beszélgetés megnyílik, jelöljük olvasottnak az összes olvasatlant
  useEffect(() => {
    // Csak akkor fut le, ha van kiválasztott beszélgetés, az üzenetek betöltődtek, és van currentUserId
    if (!currentUserId || loading || messages.length === 0) {
      return;
    }
    if (!selectedDoctorId && !selectedGroupId) {
      return;
    }

    // Várunk egy kicsit, hogy biztosan renderelődtek az üzenetek
    const timeoutId = setTimeout(() => {
      // Csak a valódi üzeneteket jelöljük olvasottnak (nem pending-eket)
      const unreadMessages = messages.filter(m => {
        if (m.pending || m.id.startsWith('pending-')) return false;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)) return false;
        
        // Egyéni beszélgetés: csak a fogadott üzeneteket
        if (selectedDoctorId && !selectedGroupId) {
          return m.recipientId === currentUserId && !m.readAt;
        }
        
        // Group chat: csak azok az üzenetek, amiket nem én küldtem és még nem olvastam
        if (selectedGroupId) {
          return m.senderId !== currentUserId && 
                 (!m.readBy || m.readBy.length === 0 || !m.readBy.some(r => r.userId === currentUserId));
        }
        
        return false;
      });
      
      
      if (unreadMessages.length > 0) {
        // Optimistic update: azonnal frissítjük a UI-t
        setMessages(prevMessages => 
          prevMessages.map(m => {
            const isUnread = unreadMessages.some(um => um.id === m.id);
            if (!isUnread) return m;
            
            if (selectedGroupId) {
              // Group chat: hozzáadjuk az olvasót
              const alreadyRead = m.readBy?.some(r => r.userId === currentUserId);
              if (alreadyRead) return m;
              
              return {
                ...m,
                readBy: [
                  ...(m.readBy || []),
                  {
                    userId: currentUserId,
                    userName: null, // Később frissül
                    readAt: new Date(),
                  }
                ]
              };
            } else {
              // Egyéni beszélgetés: csak readAt-et frissítjük
              return { ...m, readAt: new Date() };
            }
          })
        );
        
        // API hívások párhuzamosan
        Promise.all(
          unreadMessages.map(msg => {
            return fetch(`/api/doctor-messages/${msg.id}/read`, {
              method: 'PUT',
              credentials: 'include',
            })
            .then(async (response) => {
              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
              }
              
              // Group chat esetén frissítjük az olvasók listáját
              if (selectedGroupId) {
                const response = await fetch(`/api/doctor-messages?groupId=${selectedGroupId}`, {
                  credentials: 'include',
                });
                if (response.ok) {
                  const data = await response.json();
                  const updatedMessage = data.messages?.find((m: DoctorMessage) => m.id === msg.id);
                  if (updatedMessage) {
                    setMessages(prevMessages => 
                      prevMessages.map(m => 
                        m.id === msg.id ? updatedMessage : m
                      )
                    );
                  }
                }
              }
            })
            .catch(err => {
              console.error(`[DoctorMessages] Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
              // Visszaállítás hiba esetén
              setMessages(prevMessages => 
                prevMessages.map(m => {
                  if (m.id !== msg.id) return m;
                  
                  if (selectedGroupId) {
                    return {
                      ...m,
                      readBy: m.readBy?.filter(r => r.userId !== currentUserId) || []
                    };
                  } else {
                    return { ...m, readAt: null };
                  }
                })
              );
            });
          })
        );
      }
    }, 500); // 500ms delay, hogy biztosan renderelődtek az üzenetek

    return () => clearTimeout(timeoutId);
  }, [selectedDoctorId, selectedGroupId, loading, currentUserId, messages.length]);

  // Intersection Observer eltávolítva - az auto-mark elég, amikor a beszélgetés megnyílik

  // WebSocket: Listen for doctor message read events (group chats)
  useEffect(() => {
    if (!socket || !isConnected || !selectedGroupId) return;

    const handleDoctorMessageRead = (data: { messageId: string; groupId: string; userId: string; userName: string | null }) => {
      if (data.groupId !== selectedGroupId) return;

      // Frissítjük az üzenetet az olvasók listájával
      setMessages(prevMessages => 
        prevMessages.map(m => {
          if (m.id === data.messageId) {
            const existingReadBy = m.readBy || [];
            // Ha már benne van, ne adjuk hozzá újra
            if (existingReadBy.some(r => r.userId === data.userId)) {
              return m;
            }
            return {
              ...m,
              readBy: [
                ...existingReadBy,
                {
                  userId: data.userId,
                  userName: data.userName,
                  readAt: new Date(),
                }
              ]
            };
          }
          return m;
        })
      );
    };

    // Join group room
    socket.emit('join-room', { groupId: `doctor-group:${selectedGroupId}` });

    socket.on('doctor-message-read', handleDoctorMessageRead);

    return () => {
      socket.off('doctor-message-read', handleDoctorMessageRead);
      socket.emit('leave-room', { groupId: `doctor-group:${selectedGroupId}` });
    };
  }, [socket, isConnected, selectedGroupId]);

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
      
      // Automatikusan jelöljük olvasottnak az olvasatlan üzeneteket
      if (currentUserId) {
        setTimeout(() => {
          const unreadMessages = messages.filter(m => {
            if (m.pending || m.id.startsWith('pending-')) return false;
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)) return false;
            return m.recipientId === currentUserId && !m.readAt;
          });
          
          if (unreadMessages.length > 0) {
            unreadMessages.forEach(msg => {
              fetch(`/api/doctor-messages/${msg.id}/read`, {
                method: 'PUT',
                credentials: 'include',
              }).catch(err => console.error(`Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err));
            });
            
            // Optimistic update
            setMessages(prevMessages => 
              prevMessages.map(m => 
                unreadMessages.some(um => um.id === m.id) 
                  ? { ...m, readAt: new Date() } 
                  : m
              )
            );
          }
        }, 300);
      }
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
      const filteredMessages = messages.filter((m: DoctorMessage) => !m.pending);
      setMessages(filteredMessages);
      
      // Automatikusan jelöljük olvasottnak az olvasatlan üzeneteket
      if (currentUserId) {
        setTimeout(() => {
          // Csak azok az üzenetek, amiket nem én küldtem és még nem olvastam
          // Fontos: a readBy mező lehet undefined vagy üres tömb, ha még senki sem olvasta
          const unreadMessages = filteredMessages.filter(m => {
            if (m.pending || m.id.startsWith('pending-')) return false;
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)) return false;
            // Csak azok az üzenetek, amiket nem én küldtem és még nem olvastam
            const isUnread = m.senderId !== currentUserId &&
                   (!m.readBy || m.readBy.length === 0 || !m.readBy.some(r => r.userId === currentUserId));
            return isUnread;
          });
          
          if (unreadMessages.length > 0) {
            // Optimistic update: azonnal frissítjük a UI-t
            setMessages(prevMessages => 
              prevMessages.map(m => {
                const isUnread = unreadMessages.some(um => um.id === m.id);
                if (!isUnread) return m;
                
                const alreadyRead = m.readBy?.some(r => r.userId === currentUserId);
                if (alreadyRead) return m;
                
                return {
                  ...m,
                  readBy: [
                    ...(m.readBy || []),
                    {
                      userId: currentUserId,
                      userName: null, // Később frissül
                      readAt: new Date(),
                    }
                  ]
                };
              })
            );
            
            Promise.all(
              unreadMessages.map(msg => {
                return fetch(`/api/doctor-messages/${msg.id}/read`, {
                  method: 'PUT',
                  credentials: 'include',
                })
                .then(async (response) => {
                  if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                  }
                  
                  // Frissítjük az üzenetet az olvasók listájával
                  const refreshResponse = await fetch(`/api/doctor-messages?groupId=${selectedGroupId}`, {
                    credentials: 'include',
                  });
                  if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    const updatedMessage = refreshData.messages?.find((m: DoctorMessage) => m.id === msg.id);
                    if (updatedMessage) {
                      setMessages(prevMessages => 
                        prevMessages.map(m => 
                          m.id === msg.id ? updatedMessage : m
                        )
                      );
                    }
                  }
                })
                .catch(err => {
                  console.error(`[DoctorMessages] Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err);
                  // Visszaállítás hiba esetén
                  setMessages(prevMessages => 
                    prevMessages.map(m => {
                      if (m.id !== msg.id) return m;
                      return {
                        ...m,
                        readBy: m.readBy?.filter(r => r.userId !== currentUserId) || []
                      };
                    })
                  );
                });
              })
            );
          }
        }, 300);
      }
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
                      data-message-id={message.id}
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
                        {/* Group chat: ki olvasta és ki nem olvasta az üzenetet */}
                        {isFromMe && selectedGroupId && groupParticipants.length > 0 && (
                          <div className="text-xs text-blue-100 mt-2 px-1 space-y-1">
                            {/* Olvasottak */}
                            {message.readBy && message.readBy.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium">Olvasták:</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {message.readBy.map((reader) => {
                                    const participant = groupParticipants.find(p => p.userId === reader.userId);
                                    const monogram = participant ? getMonogram(participant.userName || participant.userEmail) : '?';
                                    return (
                                      <div
                                        key={reader.userId}
                                        className="flex items-center gap-1 bg-blue-500/30 rounded-full px-2 py-0.5"
                                        title={`${reader.userName || 'Ismeretlen'} - ${format(new Date(reader.readAt), 'HH:mm', { locale: hu })}`}
                                      >
                                        <CheckCheck className="w-3 h-3 text-green-300 flex-shrink-0" />
                                        <span className="opacity-90">{reader.userName || 'Ismeretlen'}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            
                            {/* Nem olvasottak */}
                            {(() => {
                              const readUserIds = new Set(message.readBy?.map(r => r.userId) || []);
                              const unreadParticipants = groupParticipants.filter(
                                p => p.userId !== currentUserId && p.userId !== message.senderId && !readUserIds.has(p.userId)
                              );
                              
                              if (unreadParticipants.length > 0) {
                                return (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium">Nem olvasták:</span>
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {unreadParticipants.map((participant) => {
                                        const monogram = getMonogram(participant.userName || participant.userEmail);
                                        return (
                                          <div
                                            key={participant.userId}
                                            className="flex items-center gap-1 bg-blue-500/20 rounded-full px-2 py-0.5 opacity-70"
                                            title={participant.userName || participant.userEmail}
                                          >
                                            <div className="w-3 h-3 rounded-full bg-gray-400 border border-gray-500 flex-shrink-0"></div>
                                            <span>{participant.userName || participant.userEmail}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}
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

