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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-800/60 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Betöltés...</p>
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
          {/* Google Naptár info — egységes, bal-akcentes infosáv */}
          <div className="card relative overflow-hidden !p-3 flex items-start gap-3">
            <span className="absolute left-0 top-0 h-full w-1 bg-medical-primary" aria-hidden />
            <span className="p-1.5 rounded-md bg-medical-primary/10 text-medical-primary flex-shrink-0">
              <CalendarDays className="w-4 h-4" />
            </span>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">
              A Google Naptár szinkron beállítása a{' '}
              <button
                onClick={() => router.push('/settings')}
                className="text-medical-primary hover:underline font-semibold"
              >
                Beállítások
              </button>
              {' '}oldalon érhető el.
            </p>
          </div>

          {/* Időablak-kezelő */}
          <section className="space-y-3">
            <h2 className="text-heading-4 text-gray-900 dark:text-gray-100">Foglalható időablakok</h2>
            <div className="card p-4 md:p-6">
              <TimeSlotsManager />
            </div>
          </section>

          {/* Kapacitás-pool — csak admin */}
          {userRole === 'admin' && (
            <section className="space-y-3">
              <h2 className="text-heading-4 text-gray-900 dark:text-gray-100">Kapacitás-pool beállítás</h2>
              <CapacityPoolConfigManager />
            </section>
          )}
        </div>
    </AppShell>
  );
}

