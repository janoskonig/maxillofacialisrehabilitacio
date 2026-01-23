'use client';

import { ReactNode, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MobileDrawer } from './MobileDrawer';
import { MobileBackButton } from './MobileBackButton';
import { MobileActionMenu } from './MobileActionMenu';

interface MessagesShellProps {
  // List props
  listTitle: string;
  listIcon?: ReactNode;
  unreadCount?: number;
  onNewChat?: () => void;
  conversationsList: ReactNode;
  listHeaderContent?: ReactNode; // Custom header content (search, etc.)
  
  // Detail props
  showDetail: boolean;
  onBack?: () => void;
  detailHeader: ReactNode;
  detailContent: ReactNode;
  detailActions?: Array<{
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    destructive?: boolean;
  }>;
  
  // New chat state
  showNewChat?: boolean;
  newChatContent?: ReactNode;
}

/**
 * MessagesShell - Common layout component for all message interfaces
 * - Mobile: conversations list in drawer, detail view full width
 * - Desktop: side-by-side layout
 * - Handles navigation, back button, action menu
 */
export function MessagesShell({
  listTitle,
  listIcon,
  unreadCount = 0,
  onNewChat,
  conversationsList,
  listHeaderContent,
  showDetail,
  onBack,
  detailHeader,
  detailContent,
  detailActions = [],
  showNewChat: showNewChatProp,
  newChatContent,
}: MessagesShellProps) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Conversations list content (reusable)
  const listContent = (
    <>
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {listIcon || <MessageCircle className="w-5 h-5" />}
            <h3 className="text-lg font-semibold text-gray-900">{listTitle}</h3>
          </div>
          {unreadCount > 0 && (
            <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        {onNewChat && (
          <button
            onClick={() => {
              onNewChat();
              if (isMobile) setDrawerOpen(false);
            }}
            className="w-full btn-primary flex items-center gap-2 justify-center mobile-touch-target"
          >
            <MessageCircle className="w-4 h-4" />
            Új beszélgetés
          </button>
        )}
        {listHeaderContent && (
          <div className="mt-3">
            {listHeaderContent}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversationsList}
      </div>
    </>
  );

  // Mobile: drawer for conversations list
  const conversationsDrawer = (
    <MobileDrawer
      open={drawerOpen}
      onOpenChange={setDrawerOpen}
      title={listTitle}
      side="left"
    >
      <div className="flex flex-col h-full">
        {listContent}
      </div>
    </MobileDrawer>
  );

  // Desktop: side-by-side layout
  const desktopLayout = (
    <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Conversations List */}
      <div className={`${showDetail ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 border-r border-gray-200 flex flex-col`}>
        {listContent}
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {showNewChatProp && newChatContent ? (
          newChatContent
        ) : showDetail ? (
          <>
            {/* Header */}
            <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {detailHeader}
                </div>
                <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                  {detailActions.length > 0 && (
                    <MobileActionMenu items={detailActions} />
                  )}
                </div>
              </div>
            </div>

            {/* Content */}
            {detailContent}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>Válasszon egy beszélgetést</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Mobile: drawer + full width detail
  if (isMobile) {
    return (
      <>
        {conversationsDrawer}
        
        <div className="flex h-[calc(100vh-200px)] sm:h-[700px] border border-gray-200 rounded-lg overflow-hidden bg-white">
          {showNewChatProp && newChatContent ? (
            newChatContent
          ) : showDetail ? (
            <div className="flex-1 flex flex-col w-full">
              {/* Header */}
              <div className="mobile-header">
                <div className="px-4 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {onBack && (
                      <MobileBackButton onClick={onBack} />
                    )}
                    <div className="flex-1 min-w-0">
                      {detailHeader}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setDrawerOpen(true)}
                      className="p-2 text-gray-600 hover:text-gray-900 transition-colors mobile-touch-target"
                      aria-label="Beszélgetések"
                    >
                      <MessageCircle className="w-5 h-5" />
                    </button>
                    {detailActions.length > 0 && (
                      <MobileActionMenu items={detailActions} />
                    )}
                  </div>
                </div>
              </div>

              {/* Content */}
              {detailContent}
            </div>
          ) : (
            <div className="flex-1 flex flex-col w-full">
              {/* Header with open drawer button */}
              <div className="mobile-header">
                <div className="px-4 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {listIcon || <MessageCircle className="w-5 h-5" />}
                    <h3 className="text-lg font-semibold text-gray-900">{listTitle}</h3>
                    {unreadCount > 0 && (
                      <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  {onNewChat && (
                    <button
                      onClick={onNewChat}
                      className="btn-primary flex items-center gap-2 px-3 py-2 mobile-touch-target"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span className="text-sm">Új</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Conversations list in main view when no detail */}
              <div className="flex-1 overflow-y-auto">
                {listHeaderContent && (
                  <div className="p-4 border-b border-gray-200 bg-gray-50">
                    {listHeaderContent}
                  </div>
                )}
                <div className="p-4">
                  {conversationsList}
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // Desktop: side-by-side
  return desktopLayout;
}
