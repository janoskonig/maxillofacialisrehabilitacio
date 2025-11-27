'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout } from '@/lib/auth';
import { TimeSlotsManager } from '@/components/TimeSlotsManager';
import { LogOut, ArrowLeft, Shield, Settings, CalendarDays } from 'lucide-react';
import { Logo } from '@/components/Logo';

export default function TimeSlotsPage() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos'>('viewer');
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <Logo width={80} height={92} />
              <div>
                <h1 className="text-2xl font-bold text-medical-primary">
                  Maxillofaciális Rehabilitáció
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  IDŐPONTKEZELÉS
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900">Szabad időpontok kezelése</h2>
              <p className="text-gray-600 mt-1">
                Hozzon létre és kezeljen szabad időpontokat a betegfogadáshoz
              </p>
            </div>
            <div className="flex gap-2">
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
              <button
                onClick={() => router.push('/')}
                className="btn-secondary flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Vissza
              </button>
            </div>
          </div>

          {/* Time Slots Manager */}
          <div className="card p-6">
            <TimeSlotsManager />
          </div>
        </div>
      </main>
    </div>
  );
}

