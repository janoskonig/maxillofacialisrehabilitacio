'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ArrowLeft, BarChart3, User, Users } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { MobileMenu } from '@/components/MobileMenu';
import { StagesGanttChart, type GanttEpisode, type GanttInterval, type GanttVirtualWindow } from '@/components/StagesGanttChart';
import type { StageCatalogEntry } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'onkológiai kezelés utáni állapot', label: 'Onkológiai kezelés utáni állapot' },
  { value: 'traumás sérülés', label: 'Traumás sérülés' },
  { value: 'veleszületett rendellenesség', label: 'Veleszületett rendellenesség' },
];

type ViewMode = 'cohort' | 'patient';

interface PatientOption {
  id: string;
  nev: string | null;
}

export default function StagesGanttPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('cohort');
  const [reason, setReason] = useState<string>(REASON_OPTIONS[0].value);
  const [status, setStatus] = useState<string>('all');
  const [patientId, setPatientId] = useState<string>('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([]);
  const [episodes, setEpisodes] = useState<GanttEpisode[]>([]);
  const [intervals, setIntervals] = useState<GanttInterval[]>([]);
  const [catalog, setCatalog] = useState<StageCatalogEntry[]>([]);
  const [ganttVirtualWindows, setGanttVirtualWindows] = useState<GanttVirtualWindow[]>([]);
  const [includeVirtual, setIncludeVirtual] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }
        if (user.role !== 'admin' && user.role !== 'sebészorvos' && user.role !== 'fogpótlástanász') {
          showToast('Nincs jogosultsága az oldal megtekintéséhez', 'error');
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
    checkAuth();
  }, [router, showToast]);

  const fetchGanttData = useCallback(async () => {
    if (viewMode === 'patient' && !patientId) {
      setEpisodes([]);
      setIntervals([]);
      setGanttVirtualWindows([]);
      return;
    }
    if (viewMode === 'cohort' && !reason) return;

    setDataLoading(true);
    try {
      const params = new URLSearchParams();
      if (viewMode === 'patient') params.set('patientId', patientId);
      else params.set('reason', reason);
      if (status !== 'all') params.set('status', status);
      if (includeVirtual) params.set('includeVirtual', 'true');

      const res = await fetch(`/api/patients/stages/gantt?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Hiba a GANTT adatok betöltésekor', 'error');
        setEpisodes([]);
        setIntervals([]);
        setGanttVirtualWindows([]);
        return;
      }
      const data = await res.json();
      setEpisodes(data.episodes ?? []);
      setIntervals(data.intervals ?? []);
      setGanttVirtualWindows(data.virtualWindows ?? []);
    } catch {
      showToast('Hiba a GANTT adatok betöltésekor', 'error');
      setEpisodes([]);
      setIntervals([]);
      setGanttVirtualWindows([]);
    } finally {
      setDataLoading(false);
    }
  }, [viewMode, patientId, reason, status, includeVirtual, showToast]);

  const fetchCatalog = useCallback(async (reasonFilter: string | null) => {
    try {
      const url = reasonFilter
        ? `/api/stage-catalog?reason=${encodeURIComponent(reasonFilter)}`
        : '/api/stage-catalog';
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCatalog(data.catalog ?? []);
      }
    } catch {
      setCatalog([]);
    }
  }, []);

  useEffect(() => {
    if (!authorized) return;
    if (viewMode === 'cohort') fetchCatalog(reason);
    else fetchCatalog(null);
  }, [authorized, viewMode, reason, fetchCatalog]);

  const catalogForChart = viewMode === 'patient' && catalog.length > 0
    ? Array.from(
        catalog
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .reduce((acc, c) => {
            if (!acc.has(c.code)) acc.set(c.code, c);
            return acc;
          }, new Map<string, StageCatalogEntry>())
          .values()
      )
    : catalog;

  useEffect(() => {
    if (!authorized) return;
    fetchGanttData();
  }, [authorized, fetchGanttData]);

  useEffect(() => {
    if (viewMode !== 'patient' || !patientSearch.trim()) {
      setPatientOptions([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/patients?limit=100&q=${encodeURIComponent(patientSearch.trim())}`, {
        credentials: 'include',
      })
        .then((r) => r.json())
        .then((d) => setPatientOptions(d.patients ?? []))
        .catch(() => setPatientOptions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [viewMode, patientSearch]);

  const handleBack = () => router.back();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary" />
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                aria-label="Vissza"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Logo />
            </div>
            <MobileMenu />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-medical-primary" />
            Stádiumok GANTT
          </h1>
          <p className="text-gray-600 mt-1">
            Ellátási epizódok és stádium intervallumok idővonala (kohorsz vagy egy beteg)
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-gray-700">Nézet:</span>
            <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              <button
                type="button"
                onClick={() => setViewMode('cohort')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'cohort'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users className="w-4 h-4" />
                Kohorsz
              </button>
              <button
                type="button"
                onClick={() => setViewMode('patient')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'patient'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <User className="w-4 h-4" />
                Egy beteg
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeVirtual}
              onChange={(e) => setIncludeVirtual(e.target.checked)}
              className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-sm text-gray-700">Virtuális időpontok (foglalásra vár)</span>
          </label>

          {viewMode === 'cohort' && (
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Étiológia:</span>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:ring-medical-primary focus:border-medical-primary"
                >
                  {REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Státusz:</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:ring-medical-primary focus:border-medical-primary"
                >
                  <option value="all">Összes</option>
                  <option value="open">Nyitott</option>
                  <option value="closed">Zárt</option>
                </select>
              </label>
            </div>
          )}

          {viewMode === 'patient' && (
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">Beteg keresése / kiválasztása</span>
                <input
                  type="text"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="Név vagy azonosító..."
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm w-64 focus:ring-medical-primary focus:border-medical-primary"
                />
              </label>
              {patientOptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-gray-600">Válassz beteget:</span>
                  <select
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm min-w-[220px] focus:ring-medical-primary focus:border-medical-primary"
                  >
                    <option value="">–</option>
                    {patientOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nev || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {patientId && (
                <button
                  type="button"
                  onClick={() => fetchGanttData()}
                  className="px-3 py-1.5 rounded-md bg-medical-primary text-white text-sm font-medium hover:bg-medical-primary-dark"
                >
                  Frissítés
                </button>
              )}
            </div>
          )}

          {viewMode === 'cohort' && (
            <button
              type="button"
              onClick={() => fetchGanttData()}
              disabled={dataLoading}
              className="px-3 py-1.5 rounded-md bg-medical-primary text-white text-sm font-medium hover:bg-medical-primary-dark disabled:opacity-50"
            >
              {dataLoading ? 'Betöltés…' : 'Frissítés'}
            </button>
          )}
        </div>

        {/* Chart */}
        {dataLoading && episodes.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">
            GANTT adatok betöltése…
          </div>
        ) : (
          <StagesGanttChart
            episodes={episodes}
            intervals={intervals}
            catalog={catalogForChart.map((c) => ({ code: c.code, labelHu: c.labelHu, orderIndex: c.orderIndex }))}
            virtualWindows={includeVirtual ? ganttVirtualWindows : []}
          />
        )}
      </main>
    </div>
  );
}
