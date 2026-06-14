'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import {
  Loader2,
  UserRound,
  AlertTriangle,
  CalendarClock,
  CalendarCheck,
  Stethoscope,
  ExternalLink,
} from 'lucide-react';

type WorklistPatient = {
  id: string;
  nev: string | null;
  doctorId: string;
  doctorName: string | null;
  intezmeny: string | null;
  assignedAt: string | null;
  assignedByName: string | null;
  openEpisodes: number;
  nextAppt: string | null;
  lastAppt: string | null;
  stalled: boolean;
};

type Scope = 'self' | 'doctor' | 'all' | 'none';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function DelegaltBetegekPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [scope, setScope] = useState<Scope>('none');
  const [patients, setPatients] = useState<WorklistPatient[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/worklists/delegated-patients', { credentials: 'include' });
    if (!res.ok) throw new Error('Betöltés sikertelen');
    const data = await res.json();
    setPatients(data.patients ?? []);
    setScope(data.scope ?? 'none');
  }, []);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      if (user.role !== 'admin' && user.role !== 'fogpótlástanász') {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      try {
        await load();
      } catch {
        setPatients([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Orvosonkénti csoportosítás (admin „all" nézet). Egyébként egy csoport.
  const groups = useMemo(() => {
    const map = new Map<string, { doctorName: string; rows: WorklistPatient[] }>();
    for (const p of patients) {
      const key = p.doctorId;
      if (!map.has(key)) map.set(key, { doctorName: p.doctorName ?? 'Ismeretlen orvos', rows: [] });
      map.get(key)!.rows.push(p);
    }
    return Array.from(map.values()).sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'hu'));
  }, [patients]);

  const stalledCount = useMemo(() => patients.filter((p) => p.stalled).length, [patients]);

  if (loading || authorized === null) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          Betöltés…
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <div className="card max-w-md w-full text-center p-6">
          <p className="text-gray-700 dark:text-gray-300">Nincs jogosultságod a munkalistához.</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/')}>
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      title={scope === 'all' ? 'Delegált betegek — orvosonként' : 'Delegált betegeim'}
      backTo="/"
      maxWidth="xl"
    >
      <div className="space-y-6">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
          <Link
            href="/tasks/overview"
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border-b-2 border-transparent"
          >
            Feladatok
          </Link>
          <span className="px-4 py-2 text-sm font-medium text-medical-primary border-b-2 border-medical-primary">
            Delegált betegek
          </span>
        </div>

        {/* Összegző */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="card p-4 flex items-center gap-3">
            <UserRound className="w-8 h-8 text-medical-primary" />
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{patients.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Delegált beteg</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <AlertTriangle className={`w-8 h-8 ${stalledCount > 0 ? 'text-amber-500 dark:text-amber-400' : 'text-gray-300'}`} />
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stalledCount}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Elakadt (nincs köv. időpont)</p>
            </div>
          </div>
          {scope === 'all' && (
            <div className="card p-4 flex items-center gap-3">
              <Stethoscope className="w-8 h-8 text-medical-primary" />
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{groups.length}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Orvos</p>
              </div>
            </div>
          )}
        </div>

        {patients.length === 0 && (
          <div className="card p-8 text-center text-gray-500 dark:text-gray-400">
            Nincs delegált beteg.
          </div>
        )}

        {groups.map((g) => (
          <section key={g.doctorName} className="card overflow-hidden">
            {scope === 'all' && (
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border-b flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-medical-primary" />
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">{g.doctorName}</h2>
                <span className="text-sm text-gray-500 dark:text-gray-400">({g.rows.length})</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b">
                    <th className="px-4 py-2 font-medium">Beteg</th>
                    <th className="px-4 py-2 font-medium">Nyitott epizód</th>
                    <th className="px-4 py-2 font-medium">Köv. időpont</th>
                    <th className="px-4 py-2 font-medium">Utolsó találkozás</th>
                    <th className="px-4 py-2 font-medium">Delegálva</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-b last:border-0 ${p.stalled ? 'bg-amber-50 dark:bg-amber-950/40' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {p.stalled && <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />}
                          <span className="font-medium text-gray-900 dark:text-gray-100">{p.nev ?? 'Név nélkül'}</span>
                        </div>
                        {p.intezmeny && <div className="text-xs text-gray-400 dark:text-gray-500">{p.intezmeny}</div>}
                      </td>
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{p.openEpisodes}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 ${p.nextAppt ? 'text-gray-700 dark:text-gray-300' : 'text-amber-600 dark:text-amber-300'}`}>
                          <CalendarClock className="w-3.5 h-3.5" />
                          {fmtDate(p.nextAppt)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                        <span className="inline-flex items-center gap-1">
                          <CalendarCheck className="w-3.5 h-3.5" />
                          {fmtDate(p.lastAppt)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-xs">
                        {fmtDate(p.assignedAt)}
                        {p.assignedByName ? ` · ${p.assignedByName}` : ''}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/patients/${p.id}/view`}
                          className="inline-flex items-center gap-1 text-medical-primary hover:underline"
                        >
                          Megnyit <ExternalLink className="w-3 h-3 opacity-60" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
