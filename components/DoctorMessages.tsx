'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { MessageCircle, Send, Check, CheckCheck, Loader2, Users, UserPlus, Edit2, X, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { PatientMention } from './PatientMention';
import { MessageTextRenderer } from './MessageTextRenderer';
import { CreateGroupChatModal } from './CreateGroupChatModal';
import { RecipientSelector } from './RecipientSelector';
import { getMonogram, getLastName } from '@/lib/utils';
import { useSocket } from '@/contexts/SocketContext';
import { MessagesShell } from './mobile/MessagesShell';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useDoctorMessages } from '@/hooks/useDoctorMessages';

export function DoctorMessages() {
  const { showToast } = useToast();
  const { socket, isConnected } = useSocket();

  const {
    conversations, messages, doctors, groupParticipants, unreadCount,
    currentUserId, isGroupCreator,
    selectedDoctorId, selectedDoctorName, selectedGroupId, selectedGroupName,
    loading, sending, deletingGroup,
    selectDoctor, selectGroup, clearSelection, sendMessage,
    createGroupConversation, renameGroup, deleteGroup,
    refreshConversations, refreshGroupParticipants, setSelectedGroupName,
  } = useDoctorMessages({ socket, isConnected });

  // ── UI-only state ───────────────────────────────────────────────────
  const [newMessage, setNewMessage] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showDoctorSelector, setShowDoctorSelector] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [doctorSearchQuery, setDoctorSearchQuery] = useState('');
  const [newChatRecipients, setNewChatRecipients] = useState<Array<{ id: string; name: string; email: string; intezmeny: string | null }>>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showAllParticipants, setShowAllParticipants] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll state and refs
  const [isNearBottom, setIsNearBottom] = useState(false);
  const shouldAutoScrollRef = useRef(false);
  const prevConversationKeyRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef<number>(0);
  const hasInitializedScrollRef = useRef(false);
  const thresholdPx = 100;
  const isNearBottomRef = useRef(false);

  // ── Responsive ──────────────────────────────────────────────────────
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  const conversationKey = useMemo(() => {
    if (selectedGroupId) return `group:${selectedGroupId}`;
    if (selectedDoctorId) return `doc:${selectedDoctorId}`;
    return null;
  }, [selectedGroupId, selectedDoctorId]);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // ── Scroll effects ──────────────────────────────────────────────────

  // Scroll listener: tracks if user is near bottom
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom < thresholdPx;
      isNearBottomRef.current = nearBottom;
      setIsNearBottom(nearBottom);
      hasInitializedScrollRef.current = true;
    };

    handleScroll();
    hasInitializedScrollRef.current = true;

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [conversationKey]);

  // New conversation selected: always scroll to bottom
  useEffect(() => {
    if (!conversationKey || loading) return;

    if (prevConversationKeyRef.current !== conversationKey) {
      prevConversationKeyRef.current = conversationKey;

      shouldAutoScrollRef.current = true;
      prevMessageCountRef.current = 0;
      hasInitializedScrollRef.current = false;
      setIsNearBottom(true);

      queueMicrotask(() => requestAnimationFrame(() => scrollToBottom("auto")));
    }
  }, [conversationKey, loading]);

  // Messages list changed: only scroll if justified
  useEffect(() => {
    if (loading) return;
    if (!messagesContainerRef.current) return;

    const currentCount = messages?.length ?? 0;
    const prevCount = prevMessageCountRef.current;
    const messageAppended = currentCount > prevCount;
    prevMessageCountRef.current = currentCount;

    if (!messageAppended) return;

    const el = messagesContainerRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const currentlyNearBottom = distanceFromBottom < thresholdPx;

    if (currentlyNearBottom && hasInitializedScrollRef.current) {
      shouldAutoScrollRef.current = false;
      requestAnimationFrame(() => scrollToBottom("auto"));
      return;
    }

    if (shouldAutoScrollRef.current) {
      shouldAutoScrollRef.current = false;
      requestAnimationFrame(() => scrollToBottom("smooth"));
    }
  }, [messages, loading]);

  // ── Event handlers (thin wrappers) ──────────────────────────────────

  const handleSendMessage = async (messageText?: string) => {
    const textToSend = messageText || newMessage.trim();
    if (!textToSend || (!selectedDoctorId && !selectedGroupId)) {
      if (!messageText) {
        showToast('Kérjük, válasszon beszélgetést és írjon üzenetet', 'error');
      }
      return;
    }

    shouldAutoScrollRef.current = true;
    const success = await sendMessage(textToSend);
    if (success && !messageText) {
      setNewMessage('');
    }
  };

  const handleSelectDoctor = (doctorId: string, doctorName: string) => {
    selectDoctor(doctorId, doctorName);
    setShowDoctorSelector(false);
    setDoctorSearchQuery('');
  };

  const handleSelectGroup = (groupId: string, groupName: string | null) => {
    selectGroup(groupId, groupName);
    setShowDoctorSelector(false);
    setDoctorSearchQuery('');
    setShowNewChat(false);
    setNewChatRecipients([]);
  };

  const handleStartNewChat = () => {
    setShowNewChat(true);
    clearSelection();
    setNewChatRecipients([]);
  };

  const handleNewChatRecipientsChange = (recipients: Array<{ id: string; name: string; email: string; intezmeny: string | null }>) => {
    setNewChatRecipients(recipients);
  };

  const handleStartConversation = async () => {
    if (newChatRecipients.length === 0) {
      showToast('Kérjük, válasszon legalább egy címzettet', 'error');
      return;
    }

    if (newChatRecipients.length === 1) {
      handleSelectDoctor(newChatRecipients[0].id, newChatRecipients[0].name);
      setShowNewChat(false);
      setNewChatRecipients([]);
    } else {
      const result = await createGroupConversation(newChatRecipients.map(r => r.id));
      if (result) {
        handleSelectGroup(result.groupId, null);
        setShowNewChat(false);
        setNewChatRecipients([]);
      }
    }
  };

  const handleRenameGroup = async () => {
    const success = await renameGroup(newGroupName);
    if (success) {
      setEditingGroupName(false);
      setNewGroupName('');
    }
  };

  const handleDeleteGroup = async () => {
    if (!confirm('Biztosan törölni szeretné ezt a csoportos beszélgetést? Ez a művelet nem visszavonható, és az összes üzenet törlődik.')) {
      return;
    }
    await deleteGroup();
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    setCursorPosition(e.target.selectionStart);
  };

  const handleTextareaKeyDown = (_e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter adds a newline (default textarea behavior); send via button only
  };

  const handleTextareaSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPosition((e.target as HTMLTextAreaElement).selectionStart);
  };

  // ── Derived state ───────────────────────────────────────────────────

  const filteredDoctors = doctors.filter(doctor => {
    if (!doctorSearchQuery) return true;
    const query = doctorSearchQuery.toLowerCase();
    return (
      doctor.name.toLowerCase().includes(query) ||
      doctor.email.toLowerCase().includes(query) ||
      (doctor.intezmeny && doctor.intezmeny.toLowerCase().includes(query))
    );
  });

  // ── Render ──────────────────────────────────────────────────────────

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
  const detailActions = selectedGroupId && !editingGroupName ? [
    {
      label: 'Átnevezés',
      icon: <Edit2 className="w-4 h-4" />,
      onClick: () => {
        setEditingGroupName(true);
        setNewGroupName(selectedGroupName || '');
      },
    },
    {
      label: 'Résztvevők hozzáadása',
      icon: <UserPlus className="w-4 h-4" />,
      onClick: () => setShowCreateGroupModal(true),
    },
    ...(isGroupCreator ? [{
      label: 'Törlés',
      icon: deletingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />,
      onClick: handleDeleteGroup,
      destructive: true,
    }] : []),
  ] : [];

  // Conversations list content
  const conversationsListContent = conversations.length === 0 && !loading ? (
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
  );

  // Detail header content
  const detailHeaderContent = editingGroupName && selectedGroupId ? (
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
          className="btn-primary px-3 py-1 text-sm flex-1 sm:flex-none mobile-touch-target"
        >
          Mentés
        </button>
        <button
          onClick={() => {
            setEditingGroupName(false);
            setNewGroupName('');
          }}
          className="btn-secondary px-3 py-1 text-sm flex-1 sm:flex-none mobile-touch-target"
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
      {(() => {
        const hasGroupName = Boolean(selectedGroupName?.trim());
        return selectedGroupId && groupParticipants.length > 0 && (!isMobile || !hasGroupName) ? (
          <div className="mt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Users className="w-3 h-3 text-blue-600 flex-shrink-0" />
              <span className="text-xs text-gray-600">Résztvevők:</span>
              {(showAllParticipants ? groupParticipants : groupParticipants.slice(0, 2)).map((participant) => (
                <span
                  key={participant.userId}
                  className="text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full"
                  title={participant.userEmail}
                >
                  {participant.userName || participant.userEmail}
                </span>
              ))}
              {groupParticipants.length > 2 && (
                <button
                  onClick={() => setShowAllParticipants(!showAllParticipants)}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  {showAllParticipants ? 'Kevesebb' : `+${groupParticipants.length - 2} több`}
                </button>
              )}
            </div>
          </div>
        ) : null;
      })()}
    </>
  );

  // Detail content (messages + input)
  const detailContent = (
    <>
      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 sm:p-4 bg-gray-50 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>Még nincsenek üzenetek</p>
          </div>
        ) : (
          messages.map((message) => {
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
                  {isFromMe && selectedGroupId && groupParticipants.length > 0 && (
                    <div className="text-xs text-blue-100 mt-2 px-1 space-y-1">
                      {message.readBy && message.readBy.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium">Olvasták:</span>
                          <div className="flex items-center gap-1 flex-wrap">
                            {message.readBy.map((reader) => {
                              const participant = groupParticipants.find(p => p.userId === reader.userId);
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
      <div className="border-t bg-white p-2 sm:p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-4 relative">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={newMessage}
              onChange={handleTextareaChange}
              onKeyDown={handleTextareaKeyDown}
              onSelect={handleTextareaSelect}
              className="form-input flex-1 resize-none w-full min-h-[44px]"
              rows={2}
              placeholder="Írja be üzenetét... (használjon @ jelet beteg jelöléséhez)"
              disabled={sending}
            />
            <PatientMention
              text={newMessage}
              cursorPosition={cursorPosition}
              onSelect={(mentionFormat, patientName) => {
                const textBefore = newMessage.substring(0, cursorPosition);
                const lastAtIndex = textBefore.lastIndexOf('@');
                if (lastAtIndex !== -1) {
                  const textAfter = newMessage.substring(cursorPosition);
                  const newText = `${newMessage.substring(0, lastAtIndex)}${mentionFormat} ${textAfter}`;
                  setNewMessage(newText);
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
            className="flex-shrink-0 bg-medical-primary hover:bg-medical-primary-dark text-white rounded-full w-10 h-10 sm:w-auto sm:h-auto sm:rounded-lg sm:px-4 sm:py-2.5 flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-soft"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">{sending ? '...' : 'Küldés'}</span>
          </button>
        </div>
      </div>
    </>
  );

  // New chat content
  const newChatContent = (
    <>
      <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">Új beszélgetés</h3>
          <button
            onClick={() => {
              setShowNewChat(false);
              setNewChatRecipients([]);
            }}
            className="p-1 hover:bg-gray-200 rounded transition-colors mobile-touch-target"
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
            className="mt-3 w-full btn-primary flex items-center justify-center gap-2 mobile-touch-target"
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
  );

  // List header content (search)
  const listHeaderContent = showDoctorSelector ? (
    <div>
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
  ) : null;

  return (
    <>
      <MessagesShell
        listTitle="Orvosok"
        listIcon={<Users className="w-5 h-5" />}
        unreadCount={unreadCount}
        onNewChat={handleStartNewChat}
        conversationsList={conversationsListContent}
        listHeaderContent={listHeaderContent}
        showDetail={!!(selectedDoctorId || selectedGroupId)}
        onBack={() => {
          clearSelection();
        }}
        detailHeader={detailHeaderContent}
        detailContent={detailContent}
        detailActions={detailActions}
        showNewChat={showNewChat}
        newChatContent={newChatContent}
      />

      <CreateGroupChatModal
        isOpen={showCreateGroupModal}
        onClose={() => setShowCreateGroupModal(false)}
        onGroupCreated={() => {
          refreshConversations();
          if (selectedGroupId) {
            refreshGroupParticipants();
          }
          setShowCreateGroupModal(false);
        }}
        existingGroupId={selectedGroupId}
      />
    </>
  );
}
