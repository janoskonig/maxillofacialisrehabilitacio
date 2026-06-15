'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Betöltés…</div>
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <AppShell title="Orvosi terhelés" backTo="/" maxWidth="xl">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Összefoglaló orvosi terhelési kép a következő időszakra. A jobb oldali
          panel a folyamatban lévő protetikai esetek várható befejezését mutatja
          (P50/P80), a bal oldali a foglalt + hold percek alapján számol
          utilizációt a heti penzumhoz képest.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BusynessOMeter />
          <WipForecastWidget />
        </div>
      </div>
    </AppShell>
  );
}
