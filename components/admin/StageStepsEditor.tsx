'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

type StageStepItem = {
  stageCode: string;
  stepCode: string;
  orderIndex: number;
  stepLabelHu: string;
  stageLabelHu: string | null;
};

export function StageStepsEditor() {
  const router = useRouter();
  const [items, setItems] = useState<StageStepItem[]>([]);
  const [stageCodes, setStageCodes] = useState<string[]>([]);
  const [stepCatalog, setStepCatalog] = useState<{ stepCode: string; labelHu: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>('');
  const [editing, setEditing] = useState<{ stageCode: string; stepCode: string } | null>(null);
  const [editOrderIndex, setEditOrderIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newStageCode, setNewStageCode] = useState('');
  const [newStepCode, setNewStepCode] = useState('');
  const [newOrderIndex, setNewOrderIndex] = useState(0);

  const loadStageSteps = useCallback(async () => {
    const url = stageFilter
      ? `/api/stage-steps?stageCode=${encodeURIComponent(stageFilter)}`
      : '/api/stage-steps';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('Stage-steps betöltési hiba');
    const data = await res.json();
    setItems(data.items ?? []);
  }, [stageFilter]);

  const loadCatalogs = useCallback(async () => {
    const [stageRes, stepRes] = await Promise.all([
      fetch('/api/stage-catalog', { credentials: 'include' }),
      fetch('/api/step-catalog', { credentials: 'include' }),
    ]);
    if (stageRes.ok) {
      const stageData = await stageRes.json();
      const codes = [...new Set((stageData.catalog ?? []).map((c: { code: string }) => c.code))].sort();
      setStageCodes(codes);
    }
    if (stepRes.ok) {
      const stepData = await stepRes.json();
      setStepCatalog((stepData.items ?? []).map((i: { stepCode: string; labelHu: string }) => ({ stepCode: i.stepCode, labelHu: i.labelHu ?? i.stepCode })));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadStageSteps(), loadCatalogs()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, [loadStageSteps, loadCatalogs]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => items, [items]);

  const suggestedOrderIndex = useMemo(() => {
    if (!newStageCode) return 0;
    const maxForStage = items
      .filter((i) => i.stageCode === newStageCode)
      .reduce((max, i) => Math.max(max, i.orderIndex), -1);
    return maxForStage + 1;
  }, [items, newStageCode]);

  const handleEdit = (item: StageStepItem) => {
    setEditing({ stageCode: item.stageCode, stepCode: item.stepCode });
    setEditOrderIndex(item.orderIndex);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stage-steps/${encodeURIComponent(editing.stageCode)}/${encodeURIComponent(editing.stepCode)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ orderIndex: editOrderIndex }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setEditing(null);
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: StageStepItem) => {
    if (!confirm(`Törli: ${item.stageCode} → ${item.stepCode} (${item.stepLabelHu})?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stage-steps/${encodeURIComponent(item.stageCode)}/${encodeURIComponent(item.stepCode)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setEditing(null);
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newStageCode.trim() || !newStepCode.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/stage-steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          stageCode: newStageCode.trim(),
          stepCode: newStepCode.trim(),
          orderIndex: newOrderIndex,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setCreating(false);
      setNewStageCode('');
      setNewStepCode('');
      setNewOrderIndex(0);
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-gray-600">Betöltés...</p>;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Stádium ↔ Részlépés kapcsolatok</h3>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
          {error}
        </div>
      )}
      <div className="flex gap-4 items-center">
        <label className="text-sm font-medium text-gray-700">Szűrő (stage_code):</label>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="form-input text-sm w-48"
        >
          <option value="">— Összes</option>
          {stageCodes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">stage_code</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">step_code (címke)</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">order_index</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredItems.map((item) => (
              <tr key={`${item.stageCode}-${item.stepCode}`}>
                <td className="px-4 py-2 text-sm font-mono">{item.stageCode}</td>
                <td className="px-4 py-2 text-sm">
                  {item.stepCode} <span className="text-gray-500">({item.stepLabelHu})</span>
                </td>
                <td className="px-4 py-2 text-sm">
                  {editing?.stageCode === item.stageCode && editing?.stepCode === item.stepCode ? (
                    <input
                      type="number"
                      value={editOrderIndex}
                      onChange={(e) => setEditOrderIndex(parseInt(e.target.value, 10) || 0)}
                      className="form-input text-sm w-16"
                    />
                  ) : (
                    item.orderIndex
                  )}
                </td>
                <td className="px-4 py-2">
                  {editing?.stageCode === item.stageCode && editing?.stepCode === item.stepCode ? (
                    <div className="flex gap-2 items-center flex-wrap">
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="px-2 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        Mentés
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="px-2 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                      >
                        Mégse
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(item)}
                        className="px-2 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Szerkeszt
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        disabled={saving}
                        className="px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                      >
                        Töröl
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating ? (
        <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-2">
          <div className="flex gap-2 flex-wrap items-center">
            <select
              value={newStageCode}
              onChange={(e) => {
                setNewStageCode(e.target.value);
                setNewOrderIndex(suggestedOrderIndex);
              }}
              className="form-input text-sm w-32"
            >
              <option value="">— stage_code</option>
              {stageCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={newStepCode}
              onChange={(e) => setNewStepCode(e.target.value)}
              className="form-input text-sm w-48"
            >
              <option value="">— step_code</option>
              {stepCatalog.map((s) => (
                <option key={s.stepCode} value={s.stepCode}>
                  {s.stepCode} ({s.labelHu})
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="orderIndex"
              value={newOrderIndex}
              onChange={(e) => setNewOrderIndex(parseInt(e.target.value, 10) || 0)}
              className="form-input text-sm w-20"
            />
            <span className="text-xs text-gray-500">(javasolt: {suggestedOrderIndex})</span>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCreate}
              disabled={saving || !newStageCode.trim() || !newStepCode.trim()}
              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Létrehoz
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewStageCode('');
                setNewStepCode('');
                setNewOrderIndex(0);
              }}
              className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
            >
              Mégse
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setCreating(true);
            setNewOrderIndex(suggestedOrderIndex);
          }}
          className="px-3 py-2 bg-medical-primary text-white rounded text-sm hover:bg-medical-primary-dark"
        >
          + Új kapcsolat
        </button>
      )}
    </div>
  );
}
