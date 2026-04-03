'use client';

import { useState, useEffect } from 'react';
import { Home, CalendarDays, MessageCircle, MoreHorizontal, Shield, Settings, LogOut, BookOpen, CalendarClock, Users, ClipboardList } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import { useFeedback } from '@/components/FeedbackContext';
import { MobileBottomSheet } from './MobileBottomSheet';

export function MobileBottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [moreOpen, setMoreOpen] = useState(false);
  const { openModal: openFeedback } = useFeedback();

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  if (user === null) return null;

  if (user === undefined) {
    return (
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 mobile-safe-bottom"
        aria-label="Navigáció betöltése"
        aria-busy="true"
      >
        <div className="flex items-center justify-around h-14">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-10 h-8 rounded-md bg-gray-100 animate-pulse" />
          ))}
        </div>
      </nav>
    );
  }

  const handleLogout = () => {
    setMoreOpen(false);
    logout();
    router.push('/login');
  };

  const handleNavigate = (path: string) => {
    setMoreOpen(false);
    router.push(path);
  };

  const tabs = [
    { id: 'home', label: 'Főoldal', icon: Home, path: '/', match: (p: string) => p === '/' },
    { id: 'calendar', label: 'Naptár', icon: CalendarDays, path: '/calendar', match: (p: string) => p.startsWith('/calendar') },
    { id: 'messages', label: 'Üzenetek', icon: MessageCircle, path: '/messages', match: (p: string) => p.startsWith('/messages') },
    { id: 'more', label: 'Egyéb', icon: MoreHorizontal, path: null, match: () => false },
  ] as const;

  const moreItems: { label: string; icon: typeof Shield; action: () => void; show: boolean }[] = [
    { label: 'Feladataim', icon: ClipboardList, action: () => handleNavigate('/tasks'), show: true },
    { label: 'Admin', icon: Shield, action: () => handleNavigate('/admin'), show: user.role === 'admin' },
    { label: 'Konzílium', icon: Users, action: () => handleNavigate('/consilium'), show: user.role !== 'technikus' },
    { label: 'Időpontok kezelése', icon: CalendarClock, action: () => handleNavigate('/time-slots'), show: user.role === 'admin' || user.role === 'fogpótlástanász' },
    { label: 'Beállítások', icon: Settings, action: () => handleNavigate('/settings'), show: true },
    { label: 'Visszajelzés', icon: MessageCircle, action: () => { setMoreOpen(false); openFeedback(); }, show: true },
    { label: 'Használati útmutató', icon: BookOpen, action: () => handleNavigate('/docs/kezelesi-ut-utmutato'), show: true },
    { label: 'Kijelentkezés', icon: LogOut, action: handleLogout, show: true },
  ];

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 mobile-safe-bottom">
        <div className="flex items-center justify-around h-14">
          {tabs.map((tab) => {
            const isActive = tab.match(pathname);
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'more') {
                    setMoreOpen(true);
                  } else if (tab.path) {
                    router.push(tab.path);
                  }
                }}
                className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors ${
                  isActive
                    ? 'text-medical-primary'
                    : 'text-gray-500 active:text-gray-700'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <MobileBottomSheet open={moreOpen} onOpenChange={setMoreOpen} type="action">
        <div className="space-y-1">
          {moreItems.filter(item => item.show).map((item) => {
            const Icon = item.icon;
            const isLogout = item.label === 'Kijelentkezés';
            return (
              <button
                key={item.label}
                onClick={item.action}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  isLogout
                    ? 'text-red-700 hover:bg-red-50'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </MobileBottomSheet>
    </>
  );
}
