'use client';

import { useState, useEffect } from 'react';
import { DoctorMessage, DoctorConversation } from '@/lib/types';
import { getCurrentUser } from '@/lib/auth';
import { useToast } from '@/contexts/ToastContext';
import type { Socket } from 'socket.io-client';

export interface Doctor {
  id: string;
  name: string;
  email: string;
  intezmeny: string | null;
}

export interface GroupParticipant {
  userId: string;
  userName: string;
  userEmail: string;
}

interface UseDoctorMessagesOptions {
  socket: Socket | null;
  isConnected: boolean;
}

export interface UseDoctorMessagesReturn {
  conversations: DoctorConversation[];
  messages: DoctorMessage[];
  doctors: Doctor[];
  groupParticipants: GroupParticipant[];
  unreadCount: number;
  currentUserId: string | null;
  isGroupCreator: boolean;

  selectedDoctorId: string | null;
  selectedDoctorName: string | null;
  selectedGroupId: string | null;
  selectedGroupName: string | null;

  loading: boolean;
  sending: boolean;
  deletingGroup: boolean;
  pendingMessageId: string | null;

  selectDoctor: (doctorId: string, doctorName: string) => void;
  selectGroup: (groupId: string, groupName: string | null) => void;
  clearSelection: () => void;
  sendMessage: (text: string) => Promise<boolean>;
  createGroupConversation: (participantIds: string[]) => Promise<{ groupId: string } | null>;
  renameGroup: (newName: string) => Promise<boolean>;
  deleteGroup: () => Promise<boolean>;
  refreshConversations: () => Promise<void>;
  refreshGroupParticipants: () => Promise<void>;
  setSelectedGroupName: React.Dispatch<React.SetStateAction<string | null>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useDoctorMessages({ socket, isConnected }: UseDoctorMessagesOptions): UseDoctorMessagesReturn {
  const { showToast } = useToast();

  // ── Data state ──────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<DoctorConversation[]>([]);
  const [messages, setMessages] = useState<DoctorMessage[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isGroupCreator, setIsGroupCreator] = useState(false);

  // ── Selection state ─────────────────────────────────────────────────
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDoctorName, setSelectedDoctorName] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);

  // ── Loading state ───────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);

  // ── Fetch helpers ───────────────────────────────────────────────────

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
      const msgs = (data.messages || []) as DoctorMessage[];
      setMessages(msgs.filter((m: DoctorMessage) => !m.pending));

      if (currentUserId) {
        setTimeout(() => {
          const unreadMessages = msgs.filter(m => {
            if (m.pending || m.id.startsWith('pending-')) return false;
            if (!UUID_RE.test(m.id)) return false;
            return m.recipientId === currentUserId && !m.readAt;
          });

          if (unreadMessages.length > 0) {
            unreadMessages.forEach(msg => {
              fetch(`/api/doctor-messages/${msg.id}/read`, {
                method: 'PUT',
                credentials: 'include',
              }).catch(err => console.error(`Hiba az üzenet ${msg.id} olvasottnak jelölésekor:`, err));
            });

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
      const msgs = (data.messages || []) as DoctorMessage[];
      const filteredMessages = msgs.filter((m: DoctorMessage) => !m.pending);
      setMessages(filteredMessages);

      if (currentUserId) {
        setTimeout(() => {
          const unreadMessages = filteredMessages.filter(m => {
            if (m.pending || m.id.startsWith('pending-')) return false;
            if (!UUID_RE.test(m.id)) return false;
            const isUnread = m.senderId !== currentUserId &&
                   (!m.readBy || m.readBy.length === 0 || !m.readBy.some(r => r.userId === currentUserId));
            return isUnread;
          });

          if (unreadMessages.length > 0) {
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
                      userName: null,
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

  // ── Effects ─────────────────────────────────────────────────────────

  // Initial load + 5-second polling
  useEffect(() => {
    const loadData = async () => {
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

    const interval = setInterval(async () => {
      const user = await getCurrentUser();
      if (!user || !user.id) return;

      fetchConversations();
      fetchUnreadCount();
      if (selectedDoctorId) {
        fetchMessages();
      } else if (selectedGroupId) {
        fetchGroupMessages();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctorId, selectedGroupId]);

  // Fetch messages when doctor/group selection changes
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctorId, selectedGroupId]);

  // Fetch doctors list + identify current user on mount
  useEffect(() => {
    fetchDoctors();
    const loadCurrentUser = async () => {
      const user = await getCurrentUser();
      if (user && user.id) {
        setCurrentUserId(user.id);
      }
    };
    loadCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-mark messages as read when a conversation is open
  useEffect(() => {
    if (!currentUserId || loading || messages.length === 0) return;
    if (!selectedDoctorId && !selectedGroupId) return;

    const timeoutId = setTimeout(() => {
      const unreadMessages = messages.filter(m => {
        if (m.pending || m.id.startsWith('pending-')) return false;
        if (!UUID_RE.test(m.id)) return false;

        if (selectedDoctorId && !selectedGroupId) {
          return m.recipientId === currentUserId && !m.readAt;
        }

        if (selectedGroupId) {
          return m.senderId !== currentUserId &&
            (!m.readBy || m.readBy.length === 0 || !m.readBy.some(r => r.userId === currentUserId));
        }

        return false;
      });

      if (unreadMessages.length > 0) {
        // Optimistic update
        setMessages(prevMessages =>
          prevMessages.map(m => {
            const isUnread = unreadMessages.some(um => um.id === m.id);
            if (!isUnread) return m;

            if (selectedGroupId) {
              const alreadyRead = m.readBy?.some(r => r.userId === currentUserId);
              if (alreadyRead) return m;

              return {
                ...m,
                readBy: [
                  ...(m.readBy || []),
                  {
                    userId: currentUserId,
                    userName: null,
                    readAt: new Date(),
                  }
                ]
              };
            } else {
              return { ...m, readAt: new Date() };
            }
          })
        );

        // Fire API calls in parallel
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

              if (selectedGroupId) {
                const resp = await fetch(`/api/doctor-messages?groupId=${selectedGroupId}`, {
                  credentials: 'include',
                });
                if (resp.ok) {
                  const data = await resp.json();
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
              // Rollback optimistic update
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
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctorId, selectedGroupId, loading, currentUserId, messages.length]);

  // WebSocket: listen for doctor-message-read events in group chats
  useEffect(() => {
    if (!socket || !isConnected || !selectedGroupId) return;

    const handleDoctorMessageRead = (data: { messageId: string; groupId: string; userId: string; userName: string | null }) => {
      if (data.groupId !== selectedGroupId) return;

      setMessages(prevMessages =>
        prevMessages.map(m => {
          if (m.id === data.messageId) {
            const existingReadBy = m.readBy || [];
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

    socket.emit('join-room', { groupId: `doctor-group:${selectedGroupId}` });
    socket.on('doctor-message-read', handleDoctorMessageRead);

    return () => {
      socket.off('doctor-message-read', handleDoctorMessageRead);
      socket.emit('leave-room', { groupId: `doctor-group:${selectedGroupId}` });
    };
  }, [socket, isConnected, selectedGroupId]);

  // ── Actions ─────────────────────────────────────────────────────────

  const selectDoctor = (doctorId: string, doctorName: string) => {
    setSelectedDoctorId(doctorId);
    setSelectedDoctorName(doctorName);
    setSelectedGroupId(null);
    setSelectedGroupName(null);
    setGroupParticipants([]);
    setLoading(true);
  };

  const selectGroup = (groupId: string, groupName: string | null) => {
    setSelectedGroupId(groupId);
    setSelectedGroupName(groupName);
    setSelectedDoctorId(null);
    setSelectedDoctorName(null);
    setLoading(true);
  };

  const clearSelection = () => {
    setSelectedDoctorId(null);
    setSelectedDoctorName(null);
    setSelectedGroupId(null);
    setSelectedGroupName(null);
    setGroupParticipants([]);
    setMessages([]);
  };

  const sendMessage = async (text: string): Promise<boolean> => {
    if (!text.trim() || (!selectedDoctorId && !selectedGroupId)) return false;

    try {
      setSending(true);

      const tempId = `pending-${Date.now()}`;
      const pendingMessage: DoctorMessage = {
        id: tempId,
        senderId: currentUserId || '',
        recipientId: selectedDoctorId || '',
        senderEmail: '',
        senderName: null,
        subject: null,
        message: text,
        readAt: null,
        createdAt: new Date(),
        pending: true,
      };

      setMessages(prev => [...prev, pendingMessage]);
      setPendingMessageId(tempId);

      const response = await fetch('/api/doctor-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recipientId: selectedDoctorId || undefined,
          groupId: selectedGroupId || undefined,
          subject: null,
          message: text,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setPendingMessageId(null);
        throw new Error(error.error || 'Hiba az üzenet küldésekor');
      }

      const data = await response.json();

      setMessages(prev =>
        prev.map(m => m.id === tempId ? { ...data.message, pending: false } : m)
      );
      setPendingMessageId(null);

      showToast('Üzenet sikeresen elküldve', 'success');

      setTimeout(() => {
        if (selectedDoctorId) {
          fetchMessages();
        } else if (selectedGroupId) {
          fetchGroupMessages();
        }
        fetchConversations();
      }, 500);

      return true;
    } catch (error: any) {
      console.error('Hiba az üzenet küldésekor:', error);
      showToast(error.message || 'Hiba történt az üzenet küldésekor', 'error');
      return false;
    } finally {
      setSending(false);
    }
  };

  const createGroupConversation = async (participantIds: string[]): Promise<{ groupId: string } | null> => {
    try {
      setLoading(true);
      const response = await fetch('/api/doctor-messages/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          participantIds,
          name: null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba a csoportos beszélgetés létrehozásakor');
      }

      const data = await response.json();
      showToast('Csoportos beszélgetés létrehozva', 'success');
      return { groupId: data.groupId };
    } catch (error: any) {
      console.error('Hiba a beszélgetés indításakor:', error);
      showToast(error.message || 'Hiba történt a beszélgetés indításakor', 'error');
      setLoading(false);
      return null;
    }
  };

  const renameGroup = async (newName: string): Promise<boolean> => {
    if (!selectedGroupId) return false;

    try {
      const response = await fetch(`/api/doctor-messages/groups/${selectedGroupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newName.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba a csoportos beszélgetés átnevezésekor');
      }

      setSelectedGroupName(newName.trim() || null);
      showToast('Csoportos beszélgetés átnevezve', 'success');
      fetchConversations();
      return true;
    } catch (error: any) {
      console.error('Hiba a csoportos beszélgetés átnevezésekor:', error);
      showToast(error.message || 'Hiba történt a csoportos beszélgetés átnevezésekor', 'error');
      return false;
    }
  };

  const deleteGroup = async (): Promise<boolean> => {
    if (!selectedGroupId) return false;

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
      return true;
    } catch (error: any) {
      console.error('Hiba a csoportos beszélgetés törlésekor:', error);
      showToast(error.message || 'Hiba történt a csoportos beszélgetés törlésekor', 'error');
      return false;
    } finally {
      setDeletingGroup(false);
    }
  };

  // ── Return ──────────────────────────────────────────────────────────

  return {
    conversations,
    messages,
    doctors,
    groupParticipants,
    unreadCount,
    currentUserId,
    isGroupCreator,

    selectedDoctorId,
    selectedDoctorName,
    selectedGroupId,
    selectedGroupName,

    loading,
    sending,
    deletingGroup,
    pendingMessageId,

    selectDoctor,
    selectGroup,
    clearSelection,
    sendMessage,
    createGroupConversation,
    renameGroup,
    deleteGroup,
    refreshConversations: fetchConversations,
    refreshGroupParticipants: fetchGroupParticipants,
    setSelectedGroupName,
  };
}
