'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import { useFeedback } from '@/components/FeedbackContext';
import { useStaffTaskSummary } from '@/hooks/useStaffTaskSummary';
import { useStaffInboxSummary } from '@/hooks/useStaffInboxSummary';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import { PageHeader } from '@/components/ui/PageHeader';

export type AppShellMaxWidth = 'md' | 'lg' | 'xl' | 'full';

const MAX_WIDTH_CLASS: Record<AppShellMaxWidth, string> = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-7xl',
  full: 'max-w-full',
};

interface AppShellProps {
  title: string;
  backTo?: string;
  actions?: ReactNode;
  /** Tartalmi szélesség — a korábbi per-oldal max-w-* megőrzésére. */
  maxWidth?: AppShellMaxWidth;
  children: ReactNode;
}

/**
 * A staff felület közös kerete: állandó desktop oldalsáv + egységes fejléc,
 * mobilon a megszokott alsó navigáció. Kiváltja a ~30 oldalon duplikált
 * min-h-screen/header/main markupot és a per-oldal getCurrentUser-redirectet.
 */
export function AppShell({ title, backTo, actions, maxWidth = 'lg', children }: AppShellProps) {
  const router = useRouter();
  const { openModal: openFeedback } = useFeedback();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        if (!u) {
          router.replace('/login');
          return;
        }
        setUser(u);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  const { summary: taskSummary } = useStaffTaskSummary(Boolean(user));
  const { summary: inboxSummary } = useStaffInboxSummary(Boolean(user));

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const content = (
    <main className="flex-1 pb-mobile-nav-staff md:pb-6">
      <div className={`${MAX_WIDTH_CLASS[maxWidth]} mx-auto w-full px-4 py-6`}>{children}</div>
    </main>
  );

  // Auth betöltése alatt: fejléc + tartalom keret, de oldalsáv nélkül (a user kell hozzá).
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <PageHeader title={title} backTo={backTo} actions={actions} />
        {content}
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 md:flex">
      <Sidebar
        user={user}
        taskSummary={taskSummary}
        inboxSummary={inboxSummary}
        onLogout={handleLogout}
        onFeedback={openFeedback}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <PageHeader title={title} backTo={backTo} actions={actions} />
        {content}
      </div>
      <MobileBottomNav
        user={user}
        taskSummary={taskSummary}
        inboxSummary={inboxSummary}
      />
    </div>
  );
}
