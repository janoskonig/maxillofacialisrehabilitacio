'use client';

import { useCallback, useState, useEffect, useRef, useMemo, type RefObject } from 'react';
import { Loader2, Users, UserPlus, Edit2, X, Trash2, CheckCheck, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { PatientMention } from './PatientMention';
import { MessageTextRenderer } from './MessageTextRenderer';
import { CreateGroupChatModal } from './CreateGroupChatModal';
import { RecipientSelector } from './RecipientSelector';
import { useSocket } from '@/contexts/SocketContext';
import { MessagesShell } from './mobile/MessagesShell';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useDoctorMessages } from '@/hooks/useDoctorMessages';
import { usePresence } from '@/hooks/usePresence';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { aggregateGroupSenderDeliveryStatus } from '@/lib/messaging/group-delivery-status';
import type { ChatBubbleMessage } from './messaging/ChatMessageBubble';
import { Avatar } from './messaging/Avatar';
import { MessageThread } from './messaging/MessageThread';
import { MessageComposer } from './messaging/MessageComposer';
import { ConversationList, type ConversationVM } from './messaging/ConversationList';
import { ReplyComposerBar } from './messaging/ReplyComposerBar';
import { DocumentLinkComposerButton } from './messaging/DocumentLinkComposerButton';
import { ContextLinkComposerButton } from './messaging/ContextLinkComposerButton';
import { PendingContextLinksBar } from './messaging/PendingContextLinksBar';
import type { PendingContextLink } from './messaging/ContextLinkAttachPicker';
import { useMessageContextActions } from '@/hooks/useMessageContextActions';
import type { MessageContextLink } from '@/lib/types/messaging';
import type { DoctorMessage } from '@/lib/types';
import { useReplyThreadCollapse } from './messaging/useReplyThreadCollapse';
import { filterMessagesByThreadCollapse } from '@/lib/messaging/reply-thread-visibility';
import { MessageSearchButton } from './messaging/MessageSearchButton';
import { useRegisterMessageSearch } from '@/hooks/useRegisterMessageSearch';
import type { MessageSearchHandler } from '@/contexts/MessageSearchContext';
import type { MessageSearchHit } from '@/lib/types/messaging';

export function DoctorMessages() {
  const { showToast } = useToast();
  const { socket, isConnected } = useSocket();

  const {
    conversations, messages, setMessages, doctors, groupParticipants, unreadCount,
    currentUserId, isGroupCreator,
    selectedDoctorId, selectedDoctorName, selectedGroupId, selectedGroupName,
    loading, sending, deletingGroup,
    replyState, startReplyTo,
    selectDoctor, selectGroup, clearSelection, sendMessage, retryMessage,
    createGroupConversation, renameGroup, deleteGroup,
    refreshConversations, refreshGroupParticipants,
  } = useDoctorMessages({ socket, isConnected });

  // Jelenlét (staff) + gépel-indikátor.
  const { isOnline } = usePresence(socket, isConnected);
  const typingConversation = useMemo(
    () =>
      selectedGroupId
        ? { groupId: selectedGroupId }
        : selectedDoctorId
          ? { recipientId: selectedDoctorId }
          : null,
    [selectedGroupId, selectedDoctorId],
  );
  const { typingLabel, notifyTyping } = useTypingIndicator({
    socket,
    isConnected,
    conversation: typingConversation,
    currentUserId,
    peerName: selectedGroupId ? null : selectedDoctorName,
  });

  // ── UI-only state ───────────────────────────────────────────────────
  const [newMessage, setNewMessage] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newChatRecipients, setNewChatRecipients] = useState<Array<{ id: string; name: string; email: string; intezmeny: string | null }>>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showAllParticipants, setShowAllParticipants] = useState(false);
  const [pendingContextLinks, setPendingContextLinks] = useState<PendingContextLink[]>([]);
  const { attachLink, removeLink } = useMessageContextActions('doctor');

  // ── Refs ────────────────────────────────────────────────────────────
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Responsive ──────────────────────────────────────────────────────
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  const conversationKey = useMemo(() => {
    if (selectedGroupId) return `group:${selectedGroupId}`;
    if (selectedDoctorId) return `doc:${selectedDoctorId}`;
    return null;
  }, [selectedGroupId, selectedDoctorId]);

  // Idézet / keresés kattintásra: az eredeti `data-message-id` targethez ugrunk.
  const scrollToMessage = useCallback((messageId: string): boolean => {
    const el = messagesContainerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`,
    );
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-medical-primary', 'rounded-2xl');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-medical-primary', 'rounded-2xl');
    }, 1600);
    return true;
  }, []);

  const searchHandler = useMemo<MessageSearchHandler>(() => ({
    id: 'doctor-messages-inbox',
    channel: 'doctor',
    scope: {
      recipientId: selectedGroupId ? undefined : selectedDoctorId ?? undefined,
      groupId: selectedGroupId ?? undefined,
    },
    messagesContainerRef: messagesContainerRef as RefObject<HTMLElement | null>,
    scrollToMessage,
    focusComposer: () => textareaRef.current?.focus(),
    prepareHit: async (hit: MessageSearchHit) => {
      if (hit.channel !== 'doctor') return;
      if (hit.groupId) {
        if (selectedGroupId !== hit.groupId) {
          const conv = conversations.find(
            (c) => c.type === 'group' && c.groupId === hit.groupId,
          );
          selectGroup(hit.groupId, conv?.groupName ?? null);
          await new Promise((r) => setTimeout(r, 400));
        }
        return;
      }
      const peerId =
        hit.senderId === currentUserId ? hit.recipientId : hit.senderId;
      if (peerId && selectedDoctorId !== peerId) {
        const conv = conversations.find(
          (c) => c.type === 'individual' && c.doctorId === peerId,
        );
        selectDoctor(peerId, conv?.doctorName ?? 'Orvos');
        await new Promise((r) => setTimeout(r, 400));
      }
    },
  }), [
    conversations,
    currentUserId,
    scrollToMessage,
    selectDoctor,
    selectGroup,
    selectedDoctorId,
    selectedGroupId,
  ]);

  useRegisterMessageSearch(searchHandler);

  const { collapsedRoots, isCollapsed, toggleThread, resetThreads } = useReplyThreadCollapse();

  const visibleMessages = useMemo(
    () => filterMessagesByThreadCollapse(messages, collapsedRoots),
    [messages, collapsedRoots],
  );

  const messageById = useMemo(() => {
    const map = new Map<string, DoctorMessage>();
    for (const msg of messages) map.set(msg.id, msg);
    return map;
  }, [messages]);

  const scrollToFirstReply = useCallback(
    (parentId: string) => {
      const firstReply = messages.find((m) => m.replyToMessageId === parentId);
      if (firstReply) scrollToMessage(firstReply.id);
    },
    [messages, scrollToMessage],
  );

  const handleReplyThreadToggle = useCallback(
    (parentId: string) => {
      const wasCollapsed = isCollapsed(parentId);
      toggleThread(parentId);
      if (wasCollapsed) {
        scrollToFirstReply(parentId);
      }
    },
    [isCollapsed, toggleThread, scrollToFirstReply],
  );

  useEffect(() => {
    resetThreads();
  }, [conversationKey, resetThreads]);

  // ── Bubble adapter (csatorna-független shape) ───────────────────────
  const bubbleMessages = useMemo<ChatBubbleMessage[]>(
    () =>
      visibleMessages.map((message) => {
        const isFromMe = currentUserId ? message.senderId === currentUserId : false;
        const isPending = message.pending === true;
        const senderName = message.senderName || message.senderEmail || 'Ismeretlen';

        const effectiveDeliveryStatus = isPending
          ? ('pending' as const)
          : message.deliveryStatus === 'failed'
            ? ('failed' as const)
            : selectedGroupId && isFromMe
              ? aggregateGroupSenderDeliveryStatus(message, currentUserId ?? '', groupParticipants)
              : message.deliveryStatus ?? (message.readAt ? 'read' : 'sent');

        return {
          id: message.id,
          message: message.message,
          createdAt: message.createdAt,
          senderId: message.senderId,
          senderName,
          isFromMe,
          replyToMessageId: message.replyToMessageId ?? null,
          quotedMessage: message.quotedMessage ?? null,
          replyCount: message.replyCount ?? 0,
          deliveryStatus: effectiveDeliveryStatus,
          readAt: message.readAt ?? null,
          contextLinks: message.contextLinks ?? [],
        };
      }),
    [visibleMessages, currentUserId, selectedGroupId, groupParticipants],
  );

  // ── Event handlers ──────────────────────────────────────────────────

  const handleSendMessage = async (messageText?: string) => {
    const textToSend = messageText || newMessage.trim();
    if (!textToSend || (!selectedDoctorId && !selectedGroupId)) {
      if (!messageText) {
        showToast('Kérjük, válasszon beszélgetést és írjon üzenetet', 'error');
      }
      return;
    }

    const pendingSnapshot = [...pendingContextLinks];
    const messageId = await sendMessage(textToSend);
    if (messageId) {
      if (pendingSnapshot.length > 0) {
        const attached: MessageContextLink[] = [];
        for (const p of pendingSnapshot) {
          const link = await attachLink(messageId, p.entityType, p.entityId);
          if (link) attached.push(link);
        }
        if (attached.length > 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, contextLinks: [...(m.contextLinks ?? []), ...attached] }
                : m,
            ),
          );
        }
        setPendingContextLinks([]);
      }
      if (!messageText) {
        setNewMessage('');
      }
      replyState.clearReply();
    }
  };

  const handleRemoveContextLink = async (messageId: string, linkId: string) => {
    const ok = await removeLink(messageId, linkId);
    if (!ok) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, contextLinks: (m.contextLinks ?? []).filter((l) => l.id !== linkId) }
          : m,
      ),
    );
  };

  const handleSelectDoctor = (doctorId: string, doctorName: string) => {
    selectDoctor(doctorId, doctorName);
  };

  const handleSelectGroup = (groupId: string, groupName: string | null) => {
    selectGroup(groupId, groupName);
    setShowNewChat(false);
    setNewChatRecipients([]);
  };

  const handleConversationSelect = (id: string) => {
    if (id.startsWith('group:')) {
      const gid = id.slice('group:'.length);
      const conv = conversations.find((c) => c.type === 'group' && c.groupId === gid);
      handleSelectGroup(gid, conv?.groupName ?? null);
    } else if (id.startsWith('doc:')) {
      const did = id.slice('doc:'.length);
      const conv = conversations.find((c) => c.type === 'individual' && c.doctorId === did);
      handleSelectDoctor(did, conv?.doctorName ?? 'Orvos');
    }
  };

  const handleStartNewChat = () => {
    setShowNewChat(true);
    clearSelection();
    setNewChatRecipients([]);
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
      const result = await createGroupConversation(newChatRecipients.map((r) => r.id));
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

  // ── Group read-status footer ────────────────────────────────────────
  const renderBubbleFooter = useCallback(
    (bubble: ChatBubbleMessage) => {
      if (!bubble.isFromMe || !selectedGroupId || groupParticipants.length === 0) return null;
      const message = messageById.get(bubble.id);
      if (!message) return null;

      const readUserIds = new Set(message.readBy?.map((r) => r.userId) || []);
      const unreadParticipants = groupParticipants.filter(
        (p) => p.userId !== currentUserId && p.userId !== message.senderId && !readUserIds.has(p.userId),
      );

      return (
        <div className="text-xs text-blue-100 mt-2 px-1 space-y-1">
          {message.readBy && message.readBy.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">Olvasták:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {message.readBy.map((reader) => (
                  <div
                    key={reader.userId}
                    className="flex items-center gap-1 bg-blue-500/30 rounded-full px-2 py-0.5"
                    title={`${reader.userName || 'Ismeretlen'} - ${format(new Date(reader.readAt), 'HH:mm', { locale: hu })}`}
                  >
                    <CheckCheck className="w-3 h-3 text-green-300 flex-shrink-0" />
                    <span className="opacity-90">{reader.userName || 'Ismeretlen'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {unreadParticipants.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">Nem olvasták:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {unreadParticipants.map((participant) => (
                  <div
                    key={participant.userId}
                    className="flex items-center gap-1 bg-blue-500/20 rounded-full px-2 py-0.5 opacity-70"
                    title={participant.userName || participant.userEmail}
                  >
                    <div className="w-3 h-3 rounded-full bg-gray-400 border border-gray-500 flex-shrink-0" />
                    <span>{participant.userName || participant.userEmail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    },
    [selectedGroupId, groupParticipants, messageById, currentUserId],
  );

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-medical-primary mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Betöltés...</p>
          </div>
        </div>
      </div>
    );
  }

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

  // Conversations → view model
  const conversationItems: ConversationVM[] = conversations.map((conv) => {
    if (conv.type === 'group') {
      return {
        id: `group:${conv.groupId}`,
        title: conv.groupName || `Csoport (${conv.participantCount || 0} résztvevő)`,
        subtitle: conv.participantCount ? `${conv.participantCount} résztvevő` : null,
        preview: conv.lastMessage?.message ?? null,
        timestamp: conv.lastMessage?.createdAt ?? null,
        unreadCount: conv.unreadCount,
        avatar: { group: true, name: conv.groupName },
      };
    }
    return {
      id: `doc:${conv.doctorId}`,
      title: conv.doctorName,
      preview: conv.lastMessage?.message ?? null,
      timestamp: conv.lastMessage?.createdAt ?? null,
      unreadCount: conv.unreadCount,
      avatar: {
        name: conv.doctorName,
        seed: conv.doctorId ?? conv.doctorName,
        presence: isOnline(conv.doctorId) ? ('online' as const) : undefined,
      },
    };
  });

  const selectedConversationId = selectedGroupId
    ? `group:${selectedGroupId}`
    : selectedDoctorId
      ? `doc:${selectedDoctorId}`
      : null;

  const conversationsListContent = (
    <ConversationList
      items={conversationItems}
      selectedId={selectedConversationId}
      onSelect={handleConversationSelect}
      emptyState={
        <span>
          Még nincsenek beszélgetések
          <span className="block text-xs mt-2 text-gray-400 dark:text-gray-500">
            Kattintson az „Új beszélgetés” gombra egy orvos kiválasztásához
          </span>
        </span>
      }
    />
  );

  // Detail header
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
        <button onClick={handleRenameGroup} className="btn-primary px-3 py-1 text-sm flex-1 sm:flex-none mobile-touch-target">
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
    <div className="flex items-center gap-3 min-w-0">
      <Avatar
        name={selectedDoctorId ? selectedDoctorName : selectedGroupName}
        seed={selectedDoctorId ?? selectedGroupId ?? ''}
        group={!!selectedGroupId}
        presence={selectedDoctorId && isOnline(selectedDoctorId) ? 'online' : undefined}
        sizeClass="h-9 w-9 hidden sm:flex"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 truncate min-w-0">
            {selectedGroupId && <Users className="w-4 h-4 text-medical-primary flex-shrink-0 sm:hidden" />}
            <span className="truncate">{selectedDoctorId ? selectedDoctorName : (selectedGroupName || 'Csoportos beszélgetés')}</span>
          </h3>
          <MessageSearchButton channel="doctor" />
        </div>
        {(() => {
          const hasGroupName = Boolean(selectedGroupName?.trim());
          return selectedGroupId && groupParticipants.length > 0 && (!isMobile || !hasGroupName) ? (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-600 dark:text-gray-400">Résztvevők:</span>
              {(showAllParticipants ? groupParticipants : groupParticipants.slice(0, 2)).map((participant) => (
                <span
                  key={participant.userId}
                  className="text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full"
                  title={participant.userEmail}
                >
                  {participant.userName || participant.userEmail}
                </span>
              ))}
              {groupParticipants.length > 2 && (
                <button
                  onClick={() => setShowAllParticipants(!showAllParticipants)}
                  className="text-xs text-medical-primary hover:text-medical-primary-dark font-medium"
                >
                  {showAllParticipants ? 'Kevesebb' : `+${groupParticipants.length - 2} több`}
                </button>
              )}
            </div>
          ) : null;
        })()}
      </div>
    </div>
  );

  // Detail content: thread + composer
  const detailContent = (
    <>
      <MessageThread
        containerRef={messagesContainerRef}
        messages={bubbleMessages}
        currentUserId={currentUserId}
        loading={loading}
        scrollAnchorKey={conversationKey}
        typingLabel={typingLabel}
        showSenderName={!!selectedGroupId}
        canRemoveContextLinks
        onRemoveContextLink={handleRemoveContextLink}
        emptyState={
          <div className="text-center text-gray-500 dark:text-gray-400">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p>Még nincsenek üzenetek</p>
          </div>
        }
        renderAvatar={(bubble) => (
          <Avatar name={bubble.senderName} seed={bubble.senderId} sizeClass="h-7 w-7" textClass="text-[10px]" />
        )}
        renderBubbleFooter={renderBubbleFooter}
        renderText={(text, bubble) => (
          <MessageTextRenderer
            text={text}
            chatType="doctor-doctor"
            patientId={null}
            messageId={bubble.id}
            senderId={bubble.senderId}
            currentUserId={currentUserId}
            contextLinks={bubble.contextLinks}
            onSendMessage={async (messageText) => {
              await handleSendMessage(messageText);
            }}
          />
        )}
        onReply={(bubble) => {
          const orig = messageById.get(bubble.id);
          if (orig && !orig.pending) startReplyTo(orig);
        }}
        onQuoteClick={scrollToMessage}
        onReplyThreadToggle={handleReplyThreadToggle}
        isThreadCollapsed={isCollapsed}
        onRetry={(bubble) => {
          const orig = messageById.get(bubble.id);
          if (orig) retryMessage(orig);
        }}
      />

      <MessageComposer
        value={newMessage}
        onChange={setNewMessage}
        onSend={() => handleSendMessage()}
        sending={sending}
        sendOnEnter={!isMobile}
        autoFocusKey={conversationKey}
        textareaRef={textareaRef}
        onCursorChange={setCursorPosition}
        onTyping={notifyTyping}
        onEscape={replyState.isReplying ? replyState.clearReply : undefined}
        placeholder="Írja be üzenetét... (@ jellel beteget jelölhet)"
        replyBar={
          replyState.isReplying && replyState.replyTarget ? (
            <ReplyComposerBar
              quote={replyState.replyTarget}
              onClose={replyState.clearReply}
              senderLabelOverride={
                replyState.replyTarget.senderId === currentUserId
                  ? 'Te'
                  : replyState.replyTarget.senderName ?? undefined
              }
            />
          ) : undefined
        }
        pendingBar={
          pendingContextLinks.length > 0 ? (
            <PendingContextLinksBar
              links={pendingContextLinks}
              onRemove={(i) => setPendingContextLinks((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ) : undefined
        }
        attachSlot={
          <>
            <DocumentLinkComposerButton
              chatType="doctor-doctor"
              messageText={newMessage}
              disabled={sending}
              onInsert={setNewMessage}
            />
            <ContextLinkComposerButton
              pendingLinks={pendingContextLinks}
              disabled={sending}
              onAddPending={(link) => setPendingContextLinks((prev) => [...prev, link])}
            />
          </>
        }
        overlay={
          <PatientMention
            text={newMessage}
            cursorPosition={cursorPosition}
            onSelect={(mentionFormat) => {
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
        }
      />
    </>
  );

  // New chat content
  const newChatContent = (
    <>
      <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Új beszélgetés</h3>
          <button
            onClick={() => {
              setShowNewChat(false);
              setNewChatRecipients([]);
            }}
            aria-label="Bezárás"
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors mobile-touch-target"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <RecipientSelector
          selectedRecipients={newChatRecipients}
          onRecipientsChange={setNewChatRecipients}
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
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <p>Válasszon címzett(ek)et a beszélgetéshez</p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <MessagesShell
        listTitle="Orvosok"
        listIcon={<Users className="w-5 h-5" />}
        unreadCount={unreadCount}
        onNewChat={handleStartNewChat}
        conversationsList={conversationsListContent}
        showDetail={!!(selectedDoctorId || selectedGroupId)}
        onBack={() => clearSelection()}
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
