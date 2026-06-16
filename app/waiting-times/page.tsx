'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Clock, Calendar, User, TrendingUp, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { AppShell } from '@/components/layout/AppShell';
import { StatCard } from '@/components/ui/StatCard';
import { MobileTable } from '@/components/mobile/MobileTable';
import { MobileKeyValueGrid } from '@/components/mobile/MobileKeyValueGrid';

interface WaitingTimeDetail {
  patientId: string;
  patientName: string;
  patientTaj: string | null;
  currentDate: string;
  firstConsultationDate?: string;
  lastAppointmentDate?: string;
  nextWorkPhaseDate?: string;
  waitingTimeDays: number;
}

interface WaitingTimeDetailsResponse {
  type: 'elso_konzultacio' | 'munkafazis';
  data: WaitingTimeDetail[];
}

export default function WaitingTimesPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'elso_konzultacio' | 'munkafazis'>('elso_konzultacio');
  const [elsoKonzultacioData, setElsoKonzultacioData] = useState<WaitingTimeDetail[]>([]);
  const [munkafazisData, setMunkafazisData] = useState<WaitingTimeDetail[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        setAuthorized(true);
      } catch (error) {
        console.error('Auth check error:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!authorized) return;

      setLoadingData(true);
      try {
        // Fetch both types of data
        const [elsoKonzultacioRes, munkafazisRes] = await Promise.all([
          fetch('/api/dashboard/waiting-times/details?type=elso_konzultacio', {
            credentials: 'include',
          }),
          fetch('/api/dashboard/waiting-times/details?type=munkafazis', {
            credentials: 'include',
          }),
        ]);

        if (elsoKonzultacioRes.ok) {
          const elsoKonzultacioData: WaitingTimeDetailsResponse = await elsoKonzultacioRes.json();
          setElsoKonzultacioData(elsoKonzultacioData.data);
        }

        if (munkafazisRes.ok) {
          const munkafazisData: WaitingTimeDetailsResponse = await munkafazisRes.json();
          setMunkafazisData(munkafazisData.data);
        }
      } catch (error) {
        console.error('Error fetching waiting times details:', error);
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, [authorized]);

  const handlePatientClick = (patientId: string) => {
    router.push(`/patients/${patientId}/view`);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    try {
      return format(new Date(dateString), 'yyyy.MM.dd HH:mm', { locale: hu });
    } catch {
      return dateString;
    }
  };

  const formatDateOnly = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    try {
      return format(new Date(dateString), 'yyyy.MM.dd', { locale: hu });
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Betöltés...</div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  const currentData = activeTab === 'elso_konzultacio' ? elsoKonzultacioData : munkafazisData;
  const days = currentData.map((d) => d.waitingTimeDays).filter((n) => typeof n === 'number');
  const avgDays = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
  const maxDays = days.length ? Math.max(...days) : 0;
  const over30 = days.filter((n) => n > 31).length;

  return (
    <AppShell title="Várakozási idők" backTo="/" maxWidth="xl">
      <div>
        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-800">
          <nav className="flex gap-1" aria-label="Várakozási idők fülök">
            <button
              onClick={() => setActiveTab('elso_konzultacio')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'elso_konzultacio'
                  ? 'border-medical-primary text-medical-primary'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Első konzultáció
              {elsoKonzultacioData.length > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-medical-primary/10 text-medical-primary rounded-full">
                  {elsoKonzultacioData.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('munkafazis')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'munkafazis'
                  ? 'border-medical-primary text-medical-primary'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <Clock className="w-4 h-4" />
              Munkafázis
              {munkafazisData.length > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-medical-primary/10 text-medical-primary rounded-full">
                  {munkafazisData.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* KPI-k */}
        {!loadingData && currentData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <StatCard label="Átlagos várakozás" value={`${avgDays.toFixed(1)} nap`} icon={Clock} tone="primary" />
            <StatCard label="Leghosszabb" value={`${maxDays.toFixed(1)} nap`} icon={TrendingUp} tone="warning" />
            <StatCard
              label="30+ nap óta vár"
              value={over30}
              icon={AlertTriangle}
              tone={over30 > 0 ? 'error' : 'neutral'}
              delta={over30 > 0 ? 'figyelmet igényel' : undefined}
            />
          </div>
        )}

        {/* Content */}
        {loadingData ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <div className="animate-pulse">Adatok betöltése...</div>
          </div>
        ) : (
          <MobileTable
            items={currentData}
            renderRow={(item) => {
              const isLongWaiting = activeTab === 'elso_konzultacio' && item.waitingTimeDays > 31;
              return (
                <>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                        isLongWaiting ? 'bg-red-100 dark:bg-red-950/50' : 'bg-medical-primary/10'
                      }`}>
                        <User className={`w-5 h-5 ${isLongWaiting ? 'text-red-600 dark:text-red-300' : 'text-medical-primary'}`} />
                      </div>
                      <div className="ml-4">
                        <div className={`text-sm font-medium ${
                          isLongWaiting ? 'text-red-700 dark:text-red-300 font-bold' : 'text-gray-900 dark:text-gray-100'
                        }`}>
                          {item.patientName || 'Névtelen beteg'}
                        </div>
                        {item.patientTaj && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            TAJ: {item.patientTaj}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {activeTab === 'elso_konzultacio' ? (
                    <>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {formatDateOnly(item.currentDate)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {item.firstConsultationDate
                          ? formatDate(item.firstConsultationDate)
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${
                            isLongWaiting ? 'text-red-600 dark:text-red-300' : 'text-medical-primary'
                          }`}>
                            {item.waitingTimeDays.toFixed(1)} nap
                          </span>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {item.lastAppointmentDate
                          ? formatDate(item.lastAppointmentDate)
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {item.nextWorkPhaseDate
                          ? formatDate(item.nextWorkPhaseDate)
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                            {item.waitingTimeDays.toFixed(1)} nap
                          </span>
                        </div>
                      </td>
                    </>
                  )}
                </>
              );
            }}
            renderCard={(item) => {
              const isLongWaiting = activeTab === 'elso_konzultacio' && item.waitingTimeDays > 31;
              return (
                <div
                  className={`mobile-card cursor-pointer ${isLongWaiting ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' : ''}`}
                  onClick={() => handlePatientClick(item.patientId)}
                >
                  {/* Top row: Beteg név + Várakozási idő */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                        isLongWaiting ? 'bg-red-100 dark:bg-red-950/50' : 'bg-medical-primary/10'
                      }`}>
                        <User className={`w-5 h-5 ${isLongWaiting ? 'text-red-600 dark:text-red-300' : 'text-medical-primary'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={`text-base font-semibold truncate ${
                          isLongWaiting ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'
                        }`}>
                          {item.patientName || 'Névtelen beteg'}
                        </h3>
                        {item.patientTaj && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            TAJ: {item.patientTaj}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      <span className={`text-sm font-semibold ${
                        isLongWaiting ? 'text-red-600 dark:text-red-300' : activeTab === 'elso_konzultacio' ? 'text-medical-primary' : 'text-green-700 dark:text-green-300'
                      }`}>
                        {item.waitingTimeDays.toFixed(1)} nap
                      </span>
                    </div>
                  </div>

                  {/* Middle: Key-value sorok */}
                  <MobileKeyValueGrid
                    items={
                      activeTab === 'elso_konzultacio' 
                        ? [
                            { key: 'Foglalás dátuma', value: formatDateOnly(item.currentDate) },
                            { key: 'Első konzultáció', value: item.firstConsultationDate ? formatDate(item.firstConsultationDate) : '-' },
                          ]
                        : [
                            { key: 'Foglalás dátuma', value: item.lastAppointmentDate ? formatDate(item.lastAppointmentDate) : '-' },
                            { key: 'Következő munkafázis', value: item.nextWorkPhaseDate ? formatDate(item.nextWorkPhaseDate) : '-' },
                          ]
                    }
                  />
                </div>
              );
            }}
            keyExtractor={(item) => item.patientId}
            emptyState={
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <p>Nincs elérhető adat</p>
              </div>
            }
            loading={loadingData}
            renderHeader={() => (
              <>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Beteg
                </th>
                {activeTab === 'elso_konzultacio' ? (
                  <>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Foglalás dátuma
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Első konzultáció időpontja
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Várakozási idő
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Foglalás dátuma
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Következő munkafázis időpontja
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Várakozási idő
                    </th>
                  </>
                )}
              </>
            )}
            rowClassName={(item) => {
              const isLongWaiting = activeTab === 'elso_konzultacio' && item.waitingTimeDays > 31;
              return `hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors ${
                isLongWaiting ? 'bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40' : ''
              }`;
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

