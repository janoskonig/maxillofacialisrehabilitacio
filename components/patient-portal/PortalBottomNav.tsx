'use client';

import { useState } from 'react';
import { LayoutDashboard, Calendar, MessageCircle, MoreHorizontal, FileText, ClipboardList, User, LogOut } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import { MobileBottomSheet } from '@/components/mobile/MobileBottomSheet';

interface PortalBottomNavProps {
  ohipPending?: boolean;
}

export function PortalBottomNav({ ohipPending = false }: PortalBottomNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const [moreOpen, setMoreOpen] = useState(false);

  const handleLogout = async () => {
    setMoreOpen(false);
    try {
      const response = await fetch('/api/patient-portal/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        showToast('Sikeresen kijelentkezett', 'success');
      }
    } catch (error) {
      console.error('Error logging out:', error);
    }
    router.push('/patient-portal');
  };

  const handleNavigate = (path: string) => {
    setMoreOpen(false);
    router.push(path);
  };

  const tabs = [
    { id: 'dashboard', label: 'Áttekintés', icon: LayoutDashboard, path: '/patient-portal/dashboard', match: (p: string) => p === '/patient-portal/dashboard' },
    { id: 'appointments', label: 'Időpontok', icon: Calendar, path: '/patient-portal/appointments', match: (p: string) => p.startsWith('/patient-portal/appointments') },
    { id: 'messages', label: 'Üzenetek', icon: MessageCircle, path: '/patient-portal/messages', match: (p: string) => p.startsWith('/patient-portal/messages') },
    { id: 'more', label: 'Egyéb', icon: MoreHorizontal, path: null, match: () => false },
  ] as const;

  const moreItems = [
    { label: 'Dokumentumok', icon: FileText, action: () => handleNavigate('/patient-portal/documents') },
    { label: 'OHIP-14 kérdőív', icon: ClipboardList, action: () => handleNavigate('/patient-portal/ohip14'), badge: ohipPending },
    { label: 'Adataim', icon: User, action: () => handleNavigate('/patient-portal/profile') },
    { label: 'Kijelentkezés', icon: LogOut, action: handleLogout, isLogout: true },
  ];

  return (
    <>
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 mobile-safe-bottom">
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
          {moreItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={item.action}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  item.isLogout
                    ? 'text-red-700 hover:bg-red-50'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{item.label}</span>
                {item.badge && (
                  <span className="ml-auto w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </MobileBottomSheet>
    </>
  );
}
