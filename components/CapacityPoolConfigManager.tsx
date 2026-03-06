'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Plus, BarChart3 } from 'lucide-react';

interface CapacityConfig {
  weekStart: string;
  consultMin: number;
  consultTarget: number;
  workTarget: number;
  controlTarget: number;
  flexTarget: number;
  createdAt?: string;
}

interface Distribution {
  consult: number;
  work: number;
  control: number;
  flexible: number;
}

const DEFAULTS: Omit<CapacityConfig, 'weekStart'> = {
  consultMin: 2,
  consultTarget: 4,
  workTarget: 20,
  controlTarget: 6,
  flexTarget: 0,
};

function getNextMondays(count: number, startFrom: string): string[] {
  const start = new Date(startFrom);
  const mondays: string[] = [];
  const d = new Date(start);
  d.setDate(d.getDate() + 7);
  for (let i = 0; i < count; i++) {
    mondays.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return mondays;
}

export function CapacityPoolConfigManager() {
  const [configs, setConfigs] = useState<CapacityConfig[]>([]);
  const [distribution, setDistribution] = useState<Distribution>({ consult: 0, work: 0, control: 0, flexible: 0 });
  const [currentWeekStart, setCurrentWeekStart] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<CapacityConfig | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newWeekStart, setNewWeekStart] = useState('');

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/capacity-pool-config', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setConfigs(data.configs || []);
      setDistribution(data.currentDistribution || { consult: 0, work: 0, control: 0, flexible: 0 });
      setCurrentWeekStart(data.currentWeekStart || '');
    } catch (e) {
      console.error('Error loading capacity config:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async (config: CapacityConfig) => {
    setSaving(config.weekStart);
    try {
      const res = await fetch('/api/admin/capacity-pool-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          weekStart: config.weekStart,
          consultMin: config.consultMin,
          consultTarget: config.consultTarget,
          workTarget: config.workTarget,
          controlTarget: config.controlTarget,
          flexTarget: config.flexTarget,
        }),
      });

      if (res.ok) {
        await loadData();
        setEditRow(null);
        setShowAddRow(false);
      } else {
        const data = await res.json();
        alert(data.error || 'Hiba a mentéskor');
      }
    } catch (e) {
      console.error('Error saving capacity config:', e);
      alert('Hiba a mentéskor');
    } finally {
      setSaving(null);
    }
  };

  const handleAddWeek = () => {
    if (!newWeekStart) return;
    const newConfig: CapacityConfig = { weekStart: newWeekStart, ...DEFAULTS };
    handleSave(newConfig);
  };

  const existingWeeks = new Set(configs.map(c => c.weekStart));
  const suggestedWeeks = currentWeekStart
    ? [currentWeekStart, ...getNextMondays(4, currentWeekStart)].filter(w => !existingWeeks.has(w))
    : [];

  if (loading) {
    return (
      <div className="card p-6">
        <p className="text-gray-500 text-center py-4">Kapacitás konfiguráció betöltése...</p>
      </div>
    );
  }

  const totalFree = distribution.consult + distribution.work + distribution.control + distribution.flexible;

  return (
    <div className="card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-gray-600" />
          <h3 className="text-xl font-bold text-gray-900">Kapacitás kvóták</h3>
        </div>
        <button
          onClick={() => setShowAddRow(!showAddRow)}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          Új hét
        </button>
      </div>

      {/* Current distribution */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-700">
            Jelenlegi slot-eloszlás (szabad slotok, következő 7 nap)
          </h4>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white rounded-lg p-3 border">
            <div className="text-xs text-gray-500 uppercase">Konzultáció</div>
            <div className="text-2xl font-bold text-blue-700">{distribution.consult}</div>
          </div>
          <div className="bg-white rounded-lg p-3 border">
            <div className="text-xs text-gray-500 uppercase">Munkafázis</div>
            <div className="text-2xl font-bold text-purple-700">{distribution.work}</div>
          </div>
          <div className="bg-white rounded-lg p-3 border">
            <div className="text-xs text-gray-500 uppercase">Kontroll</div>
            <div className="text-2xl font-bold text-teal-700">{distribution.control}</div>
          </div>
          <div className="bg-white rounded-lg p-3 border">
            <div className="text-xs text-gray-500 uppercase">Rugalmas</div>
            <div className="text-2xl font-bold text-yellow-700">{distribution.flexible}</div>
          </div>
          <div className="bg-white rounded-lg p-3 border">
            <div className="text-xs text-gray-500 uppercase">Összesen</div>
            <div className="text-2xl font-bold text-gray-900">{totalFree}</div>
          </div>
        </div>
      </div>

      {/* Add new week */}
      {showAddRow && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-blue-900">Új heti kvóta hozzáadása</h4>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Hét kezdete (hétfő)</label>
              <input
                type="date"
                value={newWeekStart}
                onChange={(e) => setNewWeekStart(e.target.value)}
                className="form-input text-sm"
              />
            </div>
            {suggestedWeeks.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {suggestedWeeks.map(w => (
                  <button
                    key={w}
                    onClick={() => setNewWeekStart(w)}
                    className={`px-2 py-1 text-xs rounded border ${newWeekStart === w ? 'bg-blue-100 border-blue-400 text-blue-800' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={handleAddWeek}
              disabled={!newWeekStart || saving !== null}
              className="btn-primary text-sm"
            >
              Hozzáadás
            </button>
          </div>
        </div>
      )}

      {/* Config table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hét kezdete</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Konzult. min</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Konzult. cél</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Munka cél</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Kontroll cél</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Flex cél</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Művelet</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {configs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  Nincs kvóta konfigurálva. Az éjszakai rebalance alapértelmezéseket használ.
                </td>
              </tr>
            )}
            {configs.map((config) => {
              const isEditing = editRow?.weekStart === config.weekStart;
              const isCurrent = config.weekStart === currentWeekStart;
              const row = isEditing ? editRow! : config;

              return (
                <tr key={config.weekStart} className={isCurrent ? 'bg-blue-50/50' : ''}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {config.weekStart}
                    {isCurrent && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-700">aktuális</span>
                    )}
                  </td>
                  {isEditing ? (
                    <>
                      <td className="px-4 py-3 text-center">
                        <input type="number" min={0} className="w-16 form-input text-sm text-center" value={row.consultMin}
                          onChange={(e) => setEditRow({ ...row, consultMin: parseInt(e.target.value) || 0 })} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="number" min={0} className="w-16 form-input text-sm text-center" value={row.consultTarget}
                          onChange={(e) => setEditRow({ ...row, consultTarget: parseInt(e.target.value) || 0 })} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="number" min={0} className="w-16 form-input text-sm text-center" value={row.workTarget}
                          onChange={(e) => setEditRow({ ...row, workTarget: parseInt(e.target.value) || 0 })} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="number" min={0} className="w-16 form-input text-sm text-center" value={row.controlTarget}
                          onChange={(e) => setEditRow({ ...row, controlTarget: parseInt(e.target.value) || 0 })} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="number" min={0} className="w-16 form-input text-sm text-center" value={row.flexTarget}
                          onChange={(e) => setEditRow({ ...row, flexTarget: parseInt(e.target.value) || 0 })} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSave(row)}
                            disabled={saving !== null}
                            className="btn-primary text-xs flex items-center gap-1"
                          >
                            <Save className="w-3 h-3" />
                            Mentés
                          </button>
                          <button onClick={() => setEditRow(null)} className="btn-secondary text-xs">
                            Mégse
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{config.consultMin}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{config.consultTarget}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{config.workTarget}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{config.controlTarget}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{config.flexTarget}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditRow({ ...config })}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          Szerkesztés
                        </button>
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
  );
}
