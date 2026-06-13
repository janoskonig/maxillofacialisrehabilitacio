'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import {
  ArrowLeft,
  Loader2,
  Users,
  AlertTriangle,
  ClipboardCheck,
  FlaskConical,
  UserRound,
  CheckCircle,
  RefreshCw,
  ExternalLink,
  Gauge,
  BadgeCheck,
} from 'lucide-react';

type MissingItem = { key: string; label: string; group: 'clinical' | 'research' };

type CompletenessRow = {
  patientId: string;
  patientName: string | null;
  kezeleoorvos: string | null;
  etiologia: string | null;
  clinicalMissing: MissingItem[];
  researchMissing: MissingItem[];
  clinicalComplete: boolean;
  researchComplete: boolean;
  applicableCount: number;
  completenessScore: number;
  researchReady: boolean;
};

type FieldGap = { key: string; label: string; group: 'clinical' | 'research'; count: number };

type Report = {
  patients: CompletenessRow[];
  summary: {
    total: number;
    clinicalComplete: number;
    clinicalIncomplete: number;
    researchComplete: number;
    researchReady: number;
    avgCompletenessScore: number;
    missingOhipT0: number;
    byField: FieldGap[];
  };
};

/** Teljességi pontszám → badge színosztály (zöld ≥90, sárga ≥70, piros alatta). */
function scoreColor(score: number): string {
  if (score >= 90) return 'bg-green-50 text-green-700 border-green-200';
  if (score >= 70) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

type GroupFilter = 'clinical' | 'research' | 'all';

const GROUP_LABELS: Record<GroupFilter, string> = {
  clinical: 'Klinikai minimum',
  research: 'Kutatási mezők',
  all: 'Mind',
};

/** Hiányzó mező → a betegűrlap megfelelő füle + szekció-horgonya. */
const FIELD_TARGET: Record<string, { tab: string; anchor: string }> = {
  nev: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  nem: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  szuletesiDatum: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  taj: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  email: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  'doc:op': { tab: 'adminisztracio', anchor: 'section-adminisztracio' },
  kezelesreErkezesIndoka: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  diagnozis: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  meglevoFogak: { tab: 'anamnezis', anchor: 'section-betegvizsgalat' },
  ohipT0: { tab: 'anamnezis', anchor: 'section-ohip14' },
  tnmStaging: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  brownFuggoleges: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  brownVizszintes: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  kovacsDobak: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  radioterapiaDozis: { tab: 'anamnezis', anchor: 'section-anamnezis' },
};

function editHref(patientId: string, fieldKey: string): string {
  const target = FIELD_TARGET[fieldKey] ?? { tab: 'anamnezis', anchor: 'section-anamnezis' };
  return `/patients/${patientId}/view?tab=${target.tab}#${target.anchor}`;
}

export default function DataCompletenessPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<Report | null>(null);

  const [group, setGroup] = useState<GroupFilter>('clinical');
  const [search, setSearch] = useState('');
  const [fieldFilter, setFieldFilter] = useState<string>('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/patients/data-completeness', { credentials: 'include' });
    if (!res.ok) throw new Error('Betöltés sikertelen');
    setData((await res.json()) as Report);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* a meglévő adat marad */
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      if (user.role !== 'admin') {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      try {
        await load();
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /** Az adott csoportszűrő szerinti hiánylista egy beteghez. */
  const missingFor = useCallback(
    (p: CompletenessRow): MissingItem[] => {
      if (group === 'clinical') return p.clinicalMissing;
      if (group === 'research') return p.researchMissing;
      return [...p.clinicalMissing, ...p.researchMissing];
    },
    [group],
  );

  const visibleFieldGaps = useMemo(() => {
    if (!data) return [];
    return data.summary.byField.filter((f) => (group === 'all' ? true : f.group === group));
  }, [data, group]);

  const filteredPatients = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.patients.filter((p) => {
      const missing = missingFor(p);
      if (onlyIncomplete && missing.length === 0) return false;
      if (fieldFilter && !missing.some((m) => m.key === fieldFilter)) return false;
      if (!q) return true;
      return (
        (p.patientName ?? '').toLowerCase().includes(q) ||
        (p.kezeleoorvos ?? '').toLowerCase().includes(q)
      );
    });
  }, [data, search, fieldFilter, onlyIncomplete, missingFor]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          Betöltés…
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="card max-w-md w-full text-center p-6">
          <p className="text-gray-700">Nincs jogosultságod a vezetői nézethez.</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/')}>
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-gray-50 pb-mobile-nav-staff md:pb-6">
      <header className="bg-white border-b sticky top-0 z-30 max-md:mobile-safe-top">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => router.push('/')} className="btn-secondary p-2" aria-label="Vissza">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Logo width={32} height={37} />
          <h1 className="text-lg font-semibold text-gray-900">Vezetői nézet — adathiány</h1>
        </div>
        {/* Aloldal-navigáció */}
        <div className="max-w-6xl mx-auto px-4 flex gap-1">
          <Link
            href="/tasks/overview"
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
          >
            Feladatok
          </Link>
          <span className="px-4 py-2 text-sm font-medium text-medical-primary border-b-2 border-medical-primary">
            Adathiány
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Összegző kártyák */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="card p-4 flex items-center gap-3">
            <Users className="w-8 h-8 text-medical-primary" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{summary?.total ?? 0}</p>
              <p className="text-sm text-gray-500">Beteg összesen</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500" />
            <div>
              <p className="text-2xl font-bold text-red-600">{summary?.clinicalIncomplete ?? 0}</p>
              <p className="text-sm text-gray-500">Klinikailag hiányos</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <FlaskConical className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-2xl font-bold text-amber-600">{summary?.missingOhipT0 ?? 0}</p>
              <p className="text-sm text-gray-500">OHIP-14 T0 hiányzik</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <ClipboardCheck className="w-8 h-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold text-green-700">{summary?.clinicalComplete ?? 0}</p>
              <p className="text-sm text-gray-500">Klinikailag teljes</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <Gauge className="w-8 h-8 text-medical-primary" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{summary?.avgCompletenessScore ?? 0}%</p>
              <p className="text-sm text-gray-500">Átlagos teljesség</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <BadgeCheck className="w-8 h-8 text-emerald-600" />
            <div>
              <p className="text-2xl font-bold text-emerald-700">{summary?.researchReady ?? 0}</p>
              <p className="text-sm text-gray-500">Elemzésre kész</p>
            </div>
          </div>
        </div>

        {/* Csoport-váltó */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['clinical', 'research', 'all'] as GroupFilter[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(g);
                  setFieldFilter('');
                }}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  group === g ? 'bg-medical-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="form-input flex-1 min-w-[200px] text-sm"
            placeholder="Keresés: beteg vagy kezelőorvos neve…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              checked={onlyIncomplete}
              onChange={(e) => setOnlyIncomplete(e.target.checked)}
            />
            Csak hiányos
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="btn-secondary text-sm flex items-center gap-1.5 px-3 py-2 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Frissítés
          </button>
        </div>

        {/* Mezőnkénti hiány-összegzés (kattintható szűrő) */}
        {visibleFieldGaps.length > 0 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">
              Hiányzó mezők gyakorisága (kattints a szűréshez)
            </h2>
            <div className="flex flex-wrap gap-2">
              {visibleFieldGaps.map((f) => {
                const active = fieldFilter === f.key;
                const isClinical = f.group === 'clinical';
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFieldFilter(active ? '' : f.key)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors inline-flex items-center gap-1.5 ${
                      active
                        ? 'bg-medical-primary text-white border-medical-primary'
                        : isClinical
                          ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                          : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                    }`}
                  >
                    {f.label}
                    <span className="font-semibold">{f.count}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Beteglista */}
        {filteredPatients.length === 0 ? (
          <div className="card text-center py-12 text-gray-600">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" />
            <p>Nincs a szűrőnek megfelelő beteg.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredPatients.map((p) => {
              const missing = missingFor(p);
              return (
                <li
                  key={p.patientId}
                  className={`card p-4 ${missing.length > 0 ? 'border-l-4 border-red-400' : 'border-l-4 border-green-400'}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/patients/${p.patientId}/view`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {p.patientName || 'Névtelen beteg'}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        {p.kezeleoorvos && (
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="w-3.5 h-3.5" />
                            {p.kezeleoorvos}
                          </span>
                        )}
                        {p.etiologia && <span>{p.etiologia}</span>}
                      </div>
                      {missing.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {missing.map((m) => (
                            <Link
                              key={m.key}
                              href={editHref(p.patientId, m.key)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Pótlás a betegűrlapon (új lapon)"
                              className={`text-xs rounded-full px-2 py-0.5 border inline-flex items-center gap-1 transition-colors ${
                                m.group === 'clinical'
                                  ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                  : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                              }`}
                            >
                              {m.label}
                              <ExternalLink className="w-3 h-3 opacity-60" />
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-green-700 inline-flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {group === 'research'
                            ? 'Kutatási mezők rendben'
                            : group === 'all'
                              ? 'Minden mező rendben'
                              : 'Klinikai minimum teljes'}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-right shrink-0 flex flex-col items-end gap-1">
                      <span
                        title="Adat-teljességi pontszám (meglévő / értelmezhető mezők)"
                        className={`font-semibold rounded-full border px-2 py-0.5 ${scoreColor(p.completenessScore)}`}
                      >
                        {p.completenessScore}%
                      </span>
                      {missing.length > 0 && (
                        <span className="font-semibold text-red-600">{missing.length} hiány</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <MobileBottomNav />
    </div>
  );
}
