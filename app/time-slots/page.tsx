'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout } from '@/lib/auth';
import { TimeSlotsManager } from '@/components/TimeSlotsManager';
import { CapacityPoolConfigManager } from '@/components/CapacityPoolConfigManager';
import { LogOut, Shield, Settings, CalendarDays } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';

export default function TimeSlotsPage() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'admin' | 'fogpótlástanász' | 'technikus' | 'beutalo_orvos'>('admin');
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const role = user.role;
      setUserRole(role);

      // Only fogpótlástanász and admin can access this page
      if (role !== 'fogpótlástanász' && role !== 'admin') {
        router.push('/');
        return;
      }

      setAuthorized(true);
    };
    checkAuth();
  }, [router]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  return (
    <AppShell
      title="Időpontkezelés"
      backTo="/"
      maxWidth="xl"
      actions={
        <div className="hidden md:flex gap-2">
          {userRole === 'admin' && (
            <button
              onClick={() => router.push('/admin')}
              className="btn-secondary flex items-center gap-2"
            >
              <Shield className="w-4 h-4" />
              Admin
            </button>
          )}
          <button
            onClick={() => router.push('/calendar')}
            className="btn-secondary flex items-center gap-2"
          >
            <CalendarDays className="w-4 h-4" />
            Naptár
          </button>
          <button
            onClick={() => router.push('/settings')}
            className="btn-secondary flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Beállítások
          </button>
          <button
            onClick={handleLogout}
            className="btn-secondary flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Kijelentkezés
          </button>
        </div>
      }
    >
      <div className="space-y-6">
          {/* Google Calendar Settings Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CalendarDays className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-blue-900">
                  A Google Naptár beállítása a{' '}
                  <button
                    onClick={() => router.push('/settings')}
                    className="text-blue-700 hover:text-blue-900 underline font-medium"
                  >
                    Beállítások
                  </button>
                  {' '}oldalon érhető el.
                </p>
              </div>
            </div>
          </div>

          {/* Time Slots Manager */}
          <div className="card p-6">
            <TimeSlotsManager />
          </div>

          {/* Capacity Pool Config — admin only */}
          {userRole === 'admin' && (
            <CapacityPoolConfigManager />
          )}
        </div>
    </AppShell>
  );
}

