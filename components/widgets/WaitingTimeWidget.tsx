'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardWidget } from '../DashboardWidget';
import { Clock } from 'lucide-react';

interface WaitingTimeStats {
  elsoKonzultacio: {
    atlag: number;
    szoras: number;
    betegSzama: number;
  } | null;
  munkafazis: {
    atlag: number;
    szoras: number;
    betegSzama: number;
  } | null;
}

interface WaitingTimeDetail {
  patientId: string;
  patientName: string;
  patientTaj: string | null;
  waitingTimeDays: number;
}

export function WaitingTimeWidget() {
  const router = useRouter();
  const [stats, setStats] = useState<WaitingTimeStats>({
    elsoKonzultacio: null,
    munkafazis: null,
  });
  const [longWaitingPatients, setLongWaitingPatients] = useState<WaitingTimeDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWaitingTimes = async () => {
      try {
        const [statsResponse, detailsResponse] = await Promise.all([
          fetch('/api/dashboard/waiting-times', {
            credentials: 'include',
          }),
          fetch('/api/dashboard/waiting-times/details?type=elso_konzultacio', {
            credentials: 'include',
          }),
        ]);

        if (statsResponse.ok) {
          const data = await statsResponse.json();
          setStats(data);
        }

        if (detailsResponse.ok) {
          const detailsData = await detailsResponse.json();
          // Szűrjük azokat, akiknek 31 napnál hosszabb a várakozási ideje
          const longWaiting = detailsData.data.filter(
            (item: WaitingTimeDetail) => item.waitingTimeDays > 31
          );
          setLongWaitingPatients(longWaiting);
        }
      } catch (error) {
        console.error('Error fetching waiting times:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWaitingTimes();
  }, []);

  if (loading) {
    return (
      <DashboardWidget title="Várakozási idők" icon={<Clock className="w-5 h-5" />}>
        <div className="text-center py-4 text-gray-500 text-sm">Betöltés...</div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget 
      title="Várakozási idők" 
      icon={<Clock className="w-5 h-5" />}
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => router.push('/waiting-times')}
    >
      <div className="space-y-4">
        {/* Első konzultáció */}
        {stats.elsoKonzultacio ? (
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="text-sm font-semibold text-gray-700 mb-1">
              Első konzultáció
            </div>
            <div className="text-lg font-bold text-medical-primary">
              {stats.elsoKonzultacio.atlag.toFixed(1)}
              {stats.elsoKonzultacio.szoras !== null && (
                <span className="text-sm font-normal text-gray-600 ml-1">
                  ± {stats.elsoKonzultacio.szoras.toFixed(1)} nap
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.elsoKonzultacio.betegSzama} beteg alapján
            </div>
            {longWaitingPatients.length > 0 && (
              <div className="mt-3 pt-3 border-t border-blue-300">
                <div className="text-xs font-semibold text-red-600 mb-1">
                  31+ nap várakozás ({longWaitingPatients.length} beteg):
                </div>
                <div className="space-y-1">
                  {longWaitingPatients.slice(0, 5).map((patient) => (
                    <div
                      key={patient.patientId}
                      className="text-xs text-red-700 font-medium truncate"
                      title={`${patient.patientName} - ${patient.waitingTimeDays.toFixed(1)} nap`}
                    >
                      • {patient.patientName || 'Névtelen beteg'} ({patient.waitingTimeDays.toFixed(1)} nap)
                    </div>
                  ))}
                  {longWaitingPatients.length > 5 && (
                    <div className="text-xs text-red-600 italic">
                      +{longWaitingPatients.length - 5} további beteg
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="text-sm font-semibold text-gray-700 mb-1">
              Első konzultáció
            </div>
            <div className="text-sm text-gray-500">Nincs elérhető adat</div>
          </div>
        )}

        {/* Munkafázis */}
        {stats.munkafazis ? (
          <div className="p-3 bg-green-50 rounded-lg border border-green-200">
            <div className="text-sm font-semibold text-gray-700 mb-1">
              Munkafázis
            </div>
            <div className="text-lg font-bold text-green-700">
              {stats.munkafazis.atlag.toFixed(1)}
              {stats.munkafazis.szoras !== null && (
                <span className="text-sm font-normal text-gray-600 ml-1">
                  ± {stats.munkafazis.szoras.toFixed(1)} nap
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.munkafazis.betegSzama} beteg alapján
            </div>
          </div>
        ) : (
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="text-sm font-semibold text-gray-700 mb-1">
              Munkafázis
            </div>
            <div className="text-sm text-gray-500">Nincs elérhető adat</div>
          </div>
        )}
      </div>
    </DashboardWidget>
  );
}


