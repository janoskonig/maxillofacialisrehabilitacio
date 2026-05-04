'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Activity } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import { BusynessOMeter } from '@/components/widgets/BusynessOMeter';
import { WipForecastWidget } from '@/components/widgets/WipForecastWidget';

const ALLOWED_ROLES: Array<AuthUser['role']> = ['admin', 'fogpótlástanász', 'beutalo_orvos'];

export default function WorkloadPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }
        if (!ALLOWED_ROLES.includes(user.role)) {
          router.push('/');
          return;
        }
        setAuthorized(true);
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    check();
  }, [router]);

  const handleBack = () => router.push('/');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Betöltés…</div>
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <Logo width={50} height={58} />
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-medical-primary" />
                <h1 className="text-lg sm:text-xl font-bold text-medical-primary">
                  Orvosi terhelés
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBack}
                className="btn-secondary flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Vissza</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-mobile-nav-staff md:pb-6 space-y-4">
        <p className="text-sm text-gray-600">
          Összefoglaló orvosi terhelési kép a következő időszakra. A jobb oldali
          panel a folyamatban lévő protetikai esetek várható befejezését mutatja
          (P50/P80), a bal oldali a foglalt + hold percek alapján számol
          utilizációt a heti penzumhoz képest.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BusynessOMeter />
          <WipForecastWidget />
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
