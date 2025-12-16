'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { 
  Users, 
  UserCheck, 
  Calendar, 
  Clock, 
  Activity, 
  MessageSquare, 
  FileText,
  TrendingUp,
  ArrowLeft
} from 'lucide-react';
import { MedicalStatisticsSection } from '@/components/MedicalStatisticsSection';

type Stats = {
  betegek: {
    osszes: number;
    ebbenAHonapban: number;
    multHonapban: number;
    nemSzerint: Array<{ nem: string; darab: number }>;
    etiologiaSzerint: Array<{ etiologia: string; darab: number }>;
    orvosSzerint: Array<{ orvos: string; darab: number }>;
  };
  felhasznalok: {
    osszes: number;
    aktiv: number;
    inaktiv: number;
    utolso30Napban: number;
    szerepkorSzerint: Array<{ szerepkor: string; osszes: number; aktiv: number }>;
  };
  idopontfoglalasok: {
    osszes: number;
    jovobeli: number;
    multbeli: number;
    ebbenAHonapban: number;
    statusSzerint: Array<{ status: string; darab: number }>;
  };
  idoslotok: {
    osszes: number;
    elerheto: number;
    lefoglalt: number;
  };
  aktivitas: {
    osszes: number;
    utolso7Nap: number;
    utolso30Nap: number;
    muveletSzerint: Array<{ muvelet: string; darab: number }>;
    felhasznaloSzerint: Array<{ felhasznalo: string; darab: number }>;
  };
  visszajelzesek: {
    osszes: number;
    statusSzerint: Array<{ status: string; darab: number }>;
    tipusSzerint: Array<{ tipus: string; darab: number }>;
  };
  dokumentumok: {
    osszes: number;
    utolso30Napban: number;
  };
};

export default function StatsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);
      setAuthorized(user.role === 'admin');
      setLoading(false);
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    const loadStats = async () => {
      if (!authorized) return;
      setStatsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/stats', {
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
        console.error('Error loading stats:', e);
        setError('Hiba történt az adatok betöltésekor');
      } finally {
        setStatsLoading(false);
      }
    };
    loadStats();
  }, [authorized]);

  const formatActionName = (action: string): string => {
    const actionMap: Record<string, string> = {
      'login': 'Bejelentkezés',
      'heartbeat': 'Oldal megtekintés',
      'patient_created': 'Beteg létrehozása',
      'patient_updated': 'Beteg módosítása',
      'patient_deleted': 'Beteg törlése',
      'patient_viewed': 'Beteg megtekintése',
      'register': 'Regisztráció',
      'password_change': 'Jelszó változtatás',
      'patient_search': 'Beteg keresés',
      'patients_list_viewed': 'Beteglista megtekintés'
    };
    return actionMap[action] || action;
  };

  const formatStatusName = (status: string): string => {
    const statusMap: Record<string, string> = {
      'pending': 'Függőben',
      'approved': 'Jóváhagyva',
      'rejected': 'Elutasítva',
      'open': 'Nyitott',
      'in_progress': 'Folyamatban',
      'resolved': 'Megoldva',
      'closed': 'Lezárva'
    };
    return statusMap[status] || status;
  };

  const formatTypeName = (type: string): string => {
    const typeMap: Record<string, string> = {
      'bug': 'Hibajelentés',
      'error': 'Hiba',
      'crash': 'Összeomlás',
      'suggestion': 'Javaslat',
      'other': 'Egyéb'
    };
    return typeMap[type] || type;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Betöltés...</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white shadow rounded-lg p-6 max-w-md w-full text-center">
          <p className="text-gray-700">Nincs jogosultsága a statisztikák megtekintéséhez.</p>
          <button
            className="btn-secondary mt-4"
            onClick={() => router.push('/')}
          >
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <Logo width={60} height={69} />
              <h1 className="text-2xl font-bold text-medical-primary">Statisztikák</h1>
            </div>
            {currentUser && (
              <p className="text-sm text-gray-500">Bejelentkezve: {currentUser.email}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Vissza az admin felületre
          </button>
        </div>

        {statsLoading ? (
          <div className="card text-center py-12">
            <p className="text-gray-600">Statisztikák betöltése...</p>
          </div>
        ) : error ? (
          <div className="card bg-red-50 border-red-200 text-center py-12">
            <p className="text-red-800">{error}</p>
          </div>
        ) : stats ? (
          <div className="space-y-6">
            {/* Összesítő kártyák */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card bg-blue-50 border-blue-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-blue-600 font-medium">Betegek</p>
                    <p className="text-3xl font-bold text-blue-900">{stats.betegek.osszes}</p>
                  </div>
                  <Users className="w-12 h-12 text-blue-400" />
                </div>
              </div>
              <div className="card bg-green-50 border-green-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-600 font-medium">Felhasználók</p>
                    <p className="text-3xl font-bold text-green-900">{stats.felhasznalok.osszes}</p>
                  </div>
                  <UserCheck className="w-12 h-12 text-green-400" />
                </div>
              </div>
              <div className="card bg-purple-50 border-purple-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-purple-600 font-medium">Időpontfoglalások</p>
                    <p className="text-3xl font-bold text-purple-900">{stats.idopontfoglalasok.osszes}</p>
                  </div>
                  <Calendar className="w-12 h-12 text-purple-400" />
                </div>
              </div>
              <div className="card bg-orange-50 border-orange-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-orange-600 font-medium">Aktivitások</p>
                    <p className="text-3xl font-bold text-orange-900">{stats.aktivitas.osszes}</p>
                  </div>
                  <Activity className="w-12 h-12 text-orange-400" />
                </div>
              </div>
            </div>

            {/* Betegek részletek */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-medical-primary" />
                <h2 className="text-xl font-semibold">Betegek statisztikái</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Ebben a hónapban</p>
                  <p className="text-2xl font-bold">{stats.betegek.ebbenAHonapban}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Múlt hónapban</p>
                  <p className="text-2xl font-bold">{stats.betegek.multHonapban}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Változás</p>
                  <p className={`text-2xl font-bold flex items-center gap-1 ${
                    stats.betegek.ebbenAHonapban >= stats.betegek.multHonapban 
                      ? 'text-green-600' 
                      : 'text-red-600'
                  }`}>
                    <TrendingUp className="w-5 h-5" />
                    {stats.betegek.multHonapban > 0 
                      ? Math.round(((stats.betegek.ebbenAHonapban - stats.betegek.multHonapban) / stats.betegek.multHonapban) * 100)
                      : stats.betegek.ebbenAHonapban > 0 ? 100 : 0
                    }%
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <h3 className="font-medium mb-2">Nem szerint</h3>
                  <div className="space-y-1">
                    {stats.betegek.nemSzerint.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{item.nem}</span>
                        <span className="font-medium">{item.darab}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Etiológia szerint</h3>
                  <div className="space-y-1">
                    {stats.betegek.etiologiaSzerint.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="truncate">{item.etiologia}</span>
                        <span className="font-medium ml-2">{item.darab}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Orvos szerint (top 10)</h3>
                  <div className="space-y-1">
                    {stats.betegek.orvosSzerint.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="truncate">{item.orvos}</span>
                        <span className="font-medium ml-2">{item.darab}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Felhasználók részletek */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <UserCheck className="w-5 h-5 text-medical-primary" />
                <h2 className="text-xl font-semibold">Felhasználók statisztikái</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Aktív</p>
                  <p className="text-2xl font-bold text-green-600">{stats.felhasznalok.aktiv}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Inaktív</p>
                  <p className="text-2xl font-bold text-red-600">{stats.felhasznalok.inaktiv}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Utolsó 30 napban</p>
                  <p className="text-2xl font-bold">{stats.felhasznalok.utolso30Napban}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Összes</p>
                  <p className="text-2xl font-bold">{stats.felhasznalok.osszes}</p>
                </div>
              </div>
              <div>
                <h3 className="font-medium mb-2">Szerepkör szerint</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Szerepkör</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Összes</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Aktív</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {stats.felhasznalok.szerepkorSzerint.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 text-sm">{item.szerepkor}</td>
                          <td className="px-4 py-2 text-sm">{item.osszes}</td>
                          <td className="px-4 py-2 text-sm text-green-600">{item.aktiv}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Időpontfoglalások részletek */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-medical-primary" />
                <h2 className="text-xl font-semibold">Időpontfoglalások statisztikái</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Jövőbeli</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.idopontfoglalasok.jovobeli}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Múltbeli</p>
                  <p className="text-2xl font-bold text-gray-600">{stats.idopontfoglalasok.multbeli}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Ebben a hónapban</p>
                  <p className="text-2xl font-bold">{stats.idopontfoglalasok.ebbenAHonapban}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Összes</p>
                  <p className="text-2xl font-bold">{stats.idopontfoglalasok.osszes}</p>
                </div>
              </div>
              <div>
                <h3 className="font-medium mb-2">Státusz szerint</h3>
                <div className="space-y-1">
                  {stats.idopontfoglalasok.statusSzerint.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span>{formatStatusName(item.status)}</span>
                      <span className="font-medium">{item.darab}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Időslotok */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-medical-primary" />
                <h2 className="text-xl font-semibold">Időslotok statisztikái</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Elérhető</p>
                  <p className="text-2xl font-bold text-green-600">{stats.idoslotok.elerheto}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Lefoglalt</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.idoslotok.lefoglalt}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Összes</p>
                  <p className="text-2xl font-bold">{stats.idoslotok.osszes}</p>
                </div>
              </div>
            </div>

            {/* Aktivitás részletek */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-medical-primary" />
                <h2 className="text-xl font-semibold">Aktivitás statisztikái</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Utolsó 7 nap</p>
                  <p className="text-2xl font-bold">{stats.aktivitas.utolso7Nap}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Utolsó 30 nap</p>
                  <p className="text-2xl font-bold">{stats.aktivitas.utolso30Nap}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Összes</p>
                  <p className="text-2xl font-bold">{stats.aktivitas.osszes}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-medium mb-2">Művelet szerint (top 10)</h3>
                  <div className="space-y-1">
                    {stats.aktivitas.muveletSzerint.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{formatActionName(item.muvelet)}</span>
                        <span className="font-medium">{item.darab}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Felhasználó szerint (top 10)</h3>
                  <div className="space-y-1">
                    {stats.aktivitas.felhasznaloSzerint.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="truncate">{item.felhasznalo}</span>
                        <span className="font-medium ml-2">{item.darab}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Visszajelzések */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="w-5 h-5 text-medical-primary" />
                <h2 className="text-xl font-semibold">Visszajelzések statisztikái</h2>
              </div>
              <div className="mb-4">
                <p className="text-2xl font-bold mb-4">{stats.visszajelzesek.osszes} összesen</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-medium mb-2">Státusz szerint</h3>
                  <div className="space-y-1">
                    {stats.visszajelzesek.statusSzerint.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{formatStatusName(item.status)}</span>
                        <span className="font-medium">{item.darab}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Típus szerint</h3>
                  <div className="space-y-1">
                    {stats.visszajelzesek.tipusSzerint.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{formatTypeName(item.tipus)}</span>
                        <span className="font-medium">{item.darab}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Dokumentumok */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-medical-primary" />
                <h2 className="text-xl font-semibold">Dokumentumok statisztikái</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Összes</p>
                  <p className="text-2xl font-bold">{stats.dokumentumok.osszes}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Utolsó 30 napban</p>
                  <p className="text-2xl font-bold">{stats.dokumentumok.utolso30Napban}</p>
                </div>
              </div>
            </div>

            {/* Szakmai statisztikák */}
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="w-6 h-6 text-medical-primary" />
                <h2 className="text-2xl font-bold">Szakmai statisztikák</h2>
              </div>
              <MedicalStatisticsSection />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}



