'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ArrowLeft, Clock, Calendar, User } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { Logo } from '@/components/Logo';
import { MobileMenu } from '@/components/MobileMenu';

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

  const handleBack = () => {
    router.push('/');
  };

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Betöltés...</div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  const currentData = activeTab === 'elso_konzultacio' ? elsoKonzultacioData : munkafazisData;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <Logo width={50} height={58} />
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-medical-primary">
                  Várakozási idők
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MobileMenu showBackButton={true} />
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-1" aria-label="Várakozási idők fülök">
            <button
              onClick={() => setActiveTab('elso_konzultacio')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'elso_konzultacio'
                  ? 'border-medical-primary text-medical-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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

        {/* Content */}
        {loadingData ? (
          <div className="text-center py-12 text-gray-500">
            <div className="animate-pulse">Adatok betöltése...</div>
          </div>
        ) : currentData.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>Nincs elérhető adat</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Beteg
                    </th>
                    {activeTab === 'elso_konzultacio' ? (
                      <>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Jelenlegi dátum
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Első konzultáció időpontja
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Várakozási idő
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Legutolsó időpont
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Következő munkafázis időpontja
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Várakozási idő
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {currentData.map((item, index) => {
                    const isLongWaiting = activeTab === 'elso_konzultacio' && item.waitingTimeDays > 31;
                    return (
                      <tr
                        key={item.patientId}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                          isLongWaiting ? 'bg-red-50 hover:bg-red-100' : ''
                        }`}
                        onClick={() => handlePatientClick(item.patientId)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                              isLongWaiting ? 'bg-red-100' : 'bg-medical-primary/10'
                            }`}>
                              <User className={`w-5 h-5 ${isLongWaiting ? 'text-red-600' : 'text-medical-primary'}`} />
                            </div>
                            <div className="ml-4">
                              <div className={`text-sm font-medium ${
                                isLongWaiting ? 'text-red-700 font-bold' : 'text-gray-900'
                              }`}>
                                {item.patientName || 'Névtelen beteg'}
                              </div>
                              {item.patientTaj && (
                                <div className="text-sm text-gray-500">
                                  TAJ: {item.patientTaj}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        {activeTab === 'elso_konzultacio' ? (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {formatDateOnly(item.currentDate)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {item.firstConsultationDate
                                ? formatDate(item.firstConsultationDate)
                                : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${
                                  isLongWaiting ? 'text-red-600' : 'text-medical-primary'
                                }`}>
                                  {item.waitingTimeDays.toFixed(1)} nap
                                </span>
                              </div>
                            </td>
                          </>
                        ) : (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.lastAppointmentDate
                              ? formatDate(item.lastAppointmentDate)
                              : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.nextWorkPhaseDate
                              ? formatDate(item.nextWorkPhaseDate)
                              : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-green-700">
                                {item.waitingTimeDays.toFixed(1)} nap
                              </span>
                            </div>
                          </td>
                        </>
                      )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

