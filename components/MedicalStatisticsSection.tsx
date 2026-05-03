'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { MedicalStats } from '@/lib/types';

// Lazy load heavy chart components (recharts is large)
const BNOChart = dynamic(() => import('./charts/BNOChart').then(mod => ({ default: mod.BNOChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const ReferringDoctorsChart = dynamic(() => import('./charts/ReferringDoctorsChart').then(mod => ({ default: mod.ReferringDoctorsChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const DMFDistributionChart = dynamic(() => import('./charts/DMFDistributionChart').then(mod => ({ default: mod.DMFDistributionChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const ToothPositionsChart = dynamic(() => import('./charts/ToothPositionsChart').then(mod => ({ default: mod.ToothPositionsChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const ImplantPositionsChart = dynamic(() => import('./charts/ImplantPositionsChart').then(mod => ({ default: mod.ImplantPositionsChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const WaitingTimeChart = dynamic(() => import('./charts/WaitingTimeChart').then(mod => ({ default: mod.WaitingTimeChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const DoctorWorkloadChart = dynamic(() => import('./charts/DoctorWorkloadChart').then(mod => ({ default: mod.DoctorWorkloadChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const OHIP14StatsChart = dynamic(() => import('./charts/OHIP14StatsChart').then(mod => ({ default: mod.OHIP14StatsChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

const TreatmentPlanStatsChart = dynamic(() => import('./charts/TreatmentPlanStatsChart').then(mod => ({ default: mod.TreatmentPlanStatsChart })), {
  loading: () => <div className="h-64 flex items-center justify-center"><p className="text-gray-500">Diagram betöltése...</p></div>
});

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

      <div className="card">
        <h2 className="text-xl font-semibold mb-4">OHIP-14 (minőségélet / szájhigiénés hatás)</h2>
        <p className="text-sm text-gray-500 mb-4">
          Kitöltések és összpontszám-statisztikák időpontonként (T0–T3). Az átlag és a medián csak olyan
          kitöltéseknél számított, ahol a teljes pontszám rögzítve van.
        </p>
        <OHIP14StatsChart ohip14={stats.ohip14} />

        {/* T0 → T3 javulás összegzés */}
        <div className="mt-6 rounded-xl border border-gray-200/80 bg-gradient-to-br from-emerald-50/40 to-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">T0 → T3 változás</h3>
          {stats.ohip14.t0t3Delta.parosSzam === 0 ? (
            <p className="text-xs text-gray-500">
              Még nincs olyan beteg, akinél T0 és T3 is kitöltött; a delta nem számítható.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-gray-500">Páros (T0+T3)</p>
                  <p className="text-xl font-bold tabular-nums text-gray-900">
                    {stats.ohip14.t0t3Delta.parosSzam}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Medián Δ</p>
                  <p className="text-xl font-bold tabular-nums text-emerald-700">
                    {stats.ohip14.t0t3Delta.medianDelta ?? '—'}
                  </p>
                  <p className="text-[10px] text-gray-400">negatív = javulás</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Javulók</p>
                  <p className="text-xl font-bold tabular-nums text-emerald-700">
                    {stats.ohip14.t0t3Delta.javulokSzama}
                    {stats.ohip14.t0t3Delta.parosSzam > 0 ? (
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        ({Math.round((stats.ohip14.t0t3Delta.javulokSzama / stats.ohip14.t0t3Delta.parosSzam) * 100)}%)
                      </span>
                    ) : null}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Romlók</p>
                  <p className="text-xl font-bold tabular-nums text-rose-700">
                    {stats.ohip14.t0t3Delta.romlokSzama}
                    {stats.ohip14.t0t3Delta.parosSzam > 0 ? (
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        ({Math.round((stats.ohip14.t0t3Delta.romlokSzama / stats.ohip14.t0t3Delta.parosSzam) * 100)}%)
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Átlag Δ: {stats.ohip14.t0t3Delta.atlagDelta ?? '—'} · szórás:{' '}
                {stats.ohip14.t0t3Delta.szorasDelta ?? '—'} · tartomány:{' '}
                {stats.ohip14.t0t3Delta.minDelta ?? '—'} … {stats.ohip14.t0t3Delta.maxDelta ?? '—'}
              </p>
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-semibold text-gray-700">Δ hisztogram</h4>
                <ul className="space-y-1.5">
                  {stats.ohip14.t0t3Delta.hisztogram.map((b) => {
                    const max = Math.max(
                      ...stats.ohip14.t0t3Delta.hisztogram.map((x) => x.darab),
                    );
                    const pct = max > 0 ? Math.round((b.darab / max) * 100) : 0;
                    const isImprovement = b.savIdx <= 3;
                    const isWorsening = b.savIdx >= 5;
                    return (
                      <li key={b.savIdx}>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-700">{b.sav}</span>
                          <span className="tabular-nums font-semibold text-gray-900">{b.darab}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ${
                              isImprovement
                                ? 'bg-emerald-500/80'
                                : isWorsening
                                  ? 'bg-rose-500/80'
                                  : 'bg-gray-400/70'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Kiosztott kezelési tervek</h2>
        <p className="text-sm text-gray-500 mb-4">
          A <code className="text-xs bg-gray-100 px-1 rounded">patient_treatment_plans</code> táblában tárolt
          felső / alsó állcsonti és arcot érintő tervsorok összesítése; fogpótlás típusok a törzs alapján felcímkézve.
        </p>
        <TreatmentPlanStatsChart treatmentPlans={stats.treatmentPlans} />

        {/* Készültség per beteg */}
        <div className="mt-6 rounded-xl border border-gray-200/80 bg-gradient-to-br from-violet-50/40 to-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">Készültség per beteg</h3>
          <p className="mb-3 text-xs text-gray-500">
            (kész elem / összes elem) per beteg arány aggregátuma — csak azok a betegek, akiknél van
            legalább 1 elem az adott rácsban.
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50/90">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Rács</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Minta (beteg)</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Átlag %</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Medián %</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Teljesen kész</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {(['felso', 'also', 'arcot'] as const).map((key) => {
                  const row = stats.treatmentPlans.keszultseg[key];
                  const label = key === 'felso' ? 'Felső állcsont' : key === 'also' ? 'Alsó állcsont' : 'Arcot érintő';
                  return (
                    <tr key={key}>
                      <td className="px-3 py-2 text-gray-800">{label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.mintaSzam}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">
                        {row.atlagPct ?? '—'}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.medianPct ?? '—'}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.teljesenKesz}
                        {row.mintaSzam > 0 ? (
                          <span className="ml-1 text-xs text-gray-500">
                            ({Math.round((row.teljesenKesz / row.mintaSzam) * 100)}%)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
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
          szorasNapokban={stats.waitingTime.szorasNapokban}
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
    </div>
  );
}
