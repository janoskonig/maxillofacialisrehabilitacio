'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, LogOut } from 'lucide-react';
import type { AuthUser } from '@/lib/auth';
import { visibleGroups, visibleFooter, type Role, type NavItem } from '@/lib/navigation';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  FeladataimIndicators,
  feladataimTasksAriaLabel,
} from '@/components/staff/FeladataimIndicators';
import { UzenetekIndicators, uzenetekAriaLabel } from '@/components/staff/UzenetekIndicators';
import type { StaffTaskSummaryState } from '@/hooks/useStaffTaskSummary';
import type { StaffInboxSummaryState } from '@/hooks/useStaffInboxSummary';

interface SidebarProps {
  user: AuthUser;
  taskSummary: StaffTaskSummaryState | null;
  inboxSummary: StaffInboxSummaryState | null;
  onLogout: () => void;
  onFeedback: () => void;
}

/**
 * Állandó desktop oldalsáv (md+). A navigációs registry-ből épül, szerep szerint
 * szűrve. Mobilon rejtett — ott a MobileBottomNav veszi át a szerepét.
 */
export function Sidebar({ user, taskSummary, inboxSummary, onLogout, onFeedback }: SidebarProps) {
  const pathname = usePathname();
  const role = user.role as Role;
  const groups = visibleGroups(role);
  const footer = visibleFooter(role);

  const taskUnviewed = taskSummary?.unviewed ?? 0;
  const taskViewedOpen = taskSummary?.viewedOpen ?? 0;
  const patientUnread = inboxSummary?.patientUnread ?? 0;
  const doctorUnread = inboxSummary?.doctorUnread ?? 0;

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = item.match(pathname);
    const isTasks = item.id === 'tasks';
    const isMessages = item.id === 'messages';
    const ariaLabel = isTasks
      ? feladataimTasksAriaLabel(taskUnviewed, taskViewedOpen)
      : isMessages
        ? uzenetekAriaLabel(patientUnread, doctorUnread)
        : undefined;

    return (
      <Link
        key={item.id}
        href={item.path}
        aria-label={ariaLabel}
        aria-current={isActive ? 'page' : undefined}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-medical-primary/10 text-medical-primary dark:bg-medical-primary/20 dark:text-medical-primary-lighter font-medium'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate">{item.label}</span>
        {isTasks && (
          <FeladataimIndicators variant="inline" unviewed={taskUnviewed} viewedOpen={taskViewedOpen} />
        )}
        {isMessages && (
          <UzenetekIndicators variant="inline" patientUnread={patientUnread} doctorUnread={doctorUnread} />
        )}
      </Link>
    );
  };

  return (
    <aside className="hidden md:flex md:flex-col md:w-60 md:flex-shrink-0 sticky top-0 h-screen bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-gray-200 dark:border-gray-800">
        <Logo width={28} height={32} />
        <span className="font-semibold text-gray-900 dark:text-gray-100">MaxRehab</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Fő navigáció">
        {groups.map((group) => (
          <div
            key={group.id}
            className="pt-3 mt-3 border-t border-gray-100 dark:border-gray-800 first:border-0 first:mt-0 first:pt-0"
          >
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {group.label}
            </div>
            <div className="space-y-0.5">{group.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-200 dark:border-gray-800 px-2 py-3 space-y-0.5">
        {footer.map(renderItem)}
        <ThemeToggle variant="sidebar" />
        <button
          type="button"
          onClick={onFeedback}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
        >
          <MessageCircle className="w-5 h-5 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate text-left">Visszajelzés</span>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 transition-colors"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate text-left">Kijelentkezés</span>
        </button>
        <div className="px-3 pt-2 text-xs text-gray-400 dark:text-gray-500 truncate" title={user.email}>
          {user.name || user.email}
        </div>
      </div>
    </aside>
  );
}
