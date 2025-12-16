'use client';

import { useState, useEffect } from 'react';
import { BNOChart } from './charts/BNOChart';
import { ReferringDoctorsChart } from './charts/ReferringDoctorsChart';
import { DMFDistributionChart } from './charts/DMFDistributionChart';
import { ToothPositionsChart } from './charts/ToothPositionsChart';
import { ImplantPositionsChart } from './charts/ImplantPositionsChart';
import { WaitingTimeChart } from './charts/WaitingTimeChart';
import { DoctorWorkloadChart } from './charts/DoctorWorkloadChart';
import { WaitingPatientsList } from './WaitingPatientsList';
import type { MedicalStats } from '@/lib/types';

export function MedicalStatisticsSection() {
  const [stats, setStats] = useState<MedicalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/stats/medical', {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        } else {
          const errorData = await res.json();
          setError(errorData.error || 'Hiba történt az adatok betöltésekor');
        }
      } catch (e) {
        console.error('Error loading medical stats:', e);
        setError('Hiba történt az adatok betöltésekor');
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-600">Szakmai statisztikák betöltése...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-red-50 border-red-200 text-center py-12">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-8">
      {/* BNO statisztikák */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">BNO kódok előfordulása</h2>
        <BNOChart data={stats.bno.data} />
      </div>

      {/* Beutaló orvosok */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Beutaló orvosok eloszlása</h2>
        <ReferringDoctorsChart data={stats.referringDoctors.data} />
      </div>

      {/* DMF eloszlás */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">DMF index eloszlása</h2>
        <DMFDistributionChart 
          data={stats.dmfDistribution.data} 
          stats={stats.dmfDistribution.stats}
        />
      </div>

      {/* Fogak pozíciói */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Fogak helyzete (Zsigmondy rendszer)</h2>
        <ToothPositionsChart data={stats.toothPositions.data} />
      </div>

      {/* Implantátumok pozíciói */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Implantátumok helyzete (Zsigmondy rendszer)</h2>
        <ImplantPositionsChart data={stats.implantPositions.data} />
      </div>

      {/* Várakozási idő */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Átlagos első időpontra való várakozási idő</h2>
        <WaitingTimeChart
          atlagNapokban={stats.waitingTime.atlagNapokban}
          medianNapokban={stats.waitingTime.medianNapokban}
          minNapokban={stats.waitingTime.minNapokban}
          maxNapokban={stats.waitingTime.maxNapokban}
          betegSzamaIdoponttal={stats.waitingTime.betegSzamaIdoponttal}
        />
      </div>

      {/* Orvosok leterheltsége */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Orvosok leterheltsége</h2>
        <DoctorWorkloadChart data={stats.doctorWorkload.data} />
      </div>

      {/* Kezelőorvosra vár betegek */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Kezelőorvosra vár státuszú betegek</h2>
        <WaitingPatientsList
          osszes={stats.waitingPatients.osszes}
          pending={stats.waitingPatients.pending}
          nincsIdopont={stats.waitingPatients.nincsIdopont}
          betegek={stats.waitingPatients.betegek}
        />
      </div>
    </div>
  );
}
