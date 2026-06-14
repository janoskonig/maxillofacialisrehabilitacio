'use client';

import { useState, useEffect } from 'react';
import { MoreHorizontal, MessageCircle, LogOut } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import { useFeedback } from '@/components/FeedbackContext';
import { MobileBottomSheet } from './MobileBottomSheet';
import { useStaffTaskSummary, type StaffTaskSummaryState } from '@/hooks/useStaffTaskSummary';
import { useStaffInboxSummary, type StaffInboxSummaryState } from '@/hooks/useStaffInboxSummary';
import { FeladataimIndicators, feladataimTasksAriaLabel } from '@/components/staff/FeladataimIndicators';
import { UzenetekIndicators, uzenetekAriaLabel } from '@/components/staff/UzenetekIndicators';
import { mobileTabs, visibleGroups, visibleFooter, type Role, type NavItem } from '@/lib/navigation';

interface MobileBottomNavProps {
  /** Ha az AppShell adja, megosztott user — különben saját maga tölti be. */
  user?: AuthUser;
  taskSummary?: StaffTaskSummaryState | null;
  inboxSummary?: StaffInboxSummaryState | null;
}

export function MobileBottomNav({ user: userProp, taskSummary: taskProp, inboxSummary: inboxProp }: MobileBottomNavProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const [internalUser, setInternalUser] = useState<AuthUser | null | undefined>(userProp ?? undefined);
  const [moreOpen, setMoreOpen] = useState(false);
  const { openModal: openFeedback } = useFeedback();

  useEffect(() => {
    if (userProp) return;
    getCurrentUser()
      .then(setInternalUser)
      .catch(() => setInternalUser(null));
  }, [userProp]);

  const user = userProp ?? internalUser;
  const hasSharedSummaries = taskProp !== undefined || inboxProp !== undefined;

  const { summary: internalTaskSummary } = useStaffTaskSummary(!hasSharedSummaries && Boolean(user));
  const { summary: internalInboxSummary } = useStaffInboxSummary(!hasSharedSummaries && Boolean(user));

  const taskSummary = taskProp ?? internalTaskSummary;
  const inboxSummary = inboxProp ?? internalInboxSummary;
  const taskUnviewed = taskSummary?.unviewed ?? 0;
  const taskViewedOpen = taskSummary?.viewedOpen ?? 0;
  const patientUnread = inboxSummary?.patientUnread ?? 0;
  const doctorUnread = inboxSummary?.doctorUnread ?? 0;

  if (user === null) return null;

  if (user === undefined) {
    return (
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mobile-safe-bottom"
        aria-label="Navigáció betöltése"
        aria-busy="true"
      >
        <div className="flex items-center justify-around h-14">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-10 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      </nav>
    );
  }

  const role = user.role as Role;
  const primaryTabs = mobileTabs(role);
  // Az „Egyéb" lap a desktop oldalsávval azonos csoportokba tagolva — az
  // elsődleges fülek (Főoldal/Naptár/Üzenetek) kihagyva.
  const primaryIds = new Set(primaryTabs.map((t) => t.id));
  const sheetGroups = visibleGroups(role)
    .map((g) => ({ id: g.id, label: g.label, items: g.items.filter((item) => !primaryIds.has(item.id)) }))
    .filter((g) => g.items.length > 0);
  const footerItems = visibleFooter(role);

  const renderSheetItem = (item: NavItem) => {
    const Icon = item.icon;
    const isTasks = item.id === 'tasks';
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNavigate(item.path)}
        aria-label={isTasks ? feladataimTasksAriaLabel(taskUnviewed, taskViewedOpen) : undefined}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800 ${
          isTasks && taskUnviewed > 0 ? 'ring-2 ring-inset ring-red-400/45' : ''
        } ${isTasks && taskUnviewed === 0 && taskViewedOpen > 0 ? 'ring-2 ring-inset ring-amber-400/45' : ''}`}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span className={`font-medium ${isTasks ? 'flex-1 flex items-center min-w-0' : ''}`}>{item.label}</span>
        {isTasks && (
          <FeladataimIndicators variant="inline" unviewed={taskUnviewed} viewedOpen={taskViewedOpen} />
        )}
      </button>
    );
  };

  const handleLogout = () => {
    setMoreOpen(false);
    logout();
    router.push('/login');
  };

  const handleNavigate = (path: string) => {
    setMoreOpen(false);
    router.push(path);
  };

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mobile-safe-bottom">
        <div className="flex items-center justify-around h-14">
          {primaryTabs.map((tab) => {
            const isActive = tab.match(pathname);
            const Icon = tab.icon;
            const isMessages = tab.id === 'messages';
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => router.push(tab.path)}
                aria-label={isMessages ? uzenetekAriaLabel(patientUnread, doctorUnread) : undefined}
                className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors relative ${
                  isActive ? 'text-medical-primary dark:text-medical-primary-lighter' : 'text-gray-500 active:text-gray-700 dark:text-gray-400 dark:active:text-gray-200'
                } ${isMessages && patientUnread > 0 ? 'ring-2 ring-inset ring-red-400/40 rounded-lg' : ''} ${
                  isMessages && patientUnread === 0 && doctorUnread > 0 ? 'ring-2 ring-inset ring-amber-400/40 rounded-lg' : ''
                }`}
              >
                <span className="relative inline-flex">
                  <Icon className="w-5 h-5" />
                  {isMessages && (
                    <UzenetekIndicators patientUnread={patientUnread} doctorUnread={doctorUnread} />
                  )}
                </span>
                <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors text-gray-500 active:text-gray-700 dark:text-gray-400 dark:active:text-gray-200"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-tight">Egyéb</span>
          </button>
        </div>
      </nav>

      <MobileBottomSheet open={moreOpen} onOpenChange={setMoreOpen} type="action">
        <div className="space-y-4">
          {sheetGroups.map((group) => (
            <div key={group.id}>
              <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {group.label}
              </div>
              <div className="space-y-1">{group.items.map(renderSheetItem)}</div>
            </div>
          ))}

          <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-1">
            {footerItems.map(renderSheetItem)}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                openFeedback();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <MessageCircle className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">Visszajelzés</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <LogOut className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">Kijelentkezés</span>
            </button>
          </div>
        </div>
      </MobileBottomSheet>
    </>
  );
}
