'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { TreatmentPlanGantt } from '@/components/TreatmentPlanGantt';
import { CapacityForecastChart } from '@/components/charts/CapacityForecastChart';
import { BarChart3, Calendar, TrendingUp } from 'lucide-react';

type Tab = 'timeline' | 'capacity';

export default function TreatmentPlansPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('timeline');

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        if (!u) {
          router.push('/login');
          return;
        }
        if (!['admin', 'sebészorvos', 'fogpótlástanász'].includes(u.role)) {
          router.push('/');
          return;
        }
        setUser(u);
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-medical-primary/10 rounded-lg">
          <Calendar className="w-5 h-5 text-medical-primary" />
        </div>
        <div>
          <h1 className="text-heading-2">Kezelési tervek</h1>
          <p className="text-sm text-gray-500">Idővonal, kapacitás-előrejelzés és demand projection</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1" aria-label="Treatment plan tabs">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === 'timeline'
                ? 'text-medical-primary border-medical-primary'
                : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Idővonal
          </button>
          <button
            onClick={() => setActiveTab('capacity')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === 'capacity'
                ? 'text-medical-primary border-medical-primary'
                : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Kapacitás
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'timeline' && <TreatmentPlanGantt />}
      {activeTab === 'capacity' && <CapacityForecastChart />}
    </div>
  );
}
