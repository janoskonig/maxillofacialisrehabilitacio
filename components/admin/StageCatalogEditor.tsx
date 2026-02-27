'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const REASONS = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'] as const;

type Stage = {
  code: string;
  reason: string;
  labelHu: string;
  orderIndex: number;
  isTerminal: boolean;
  defaultDurationDays: number | null;
};

export function StageCatalogEditor() {
  const router = useRouter();
  const [items, setItems] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [editing, setEditing] = useState<{ code: string; reason: string } | null>(null);
  const [editLabelHu, setEditLabelHu] = useState('');
  const [editOrderIndex, setEditOrderIndex] = useState(0);
  const [editIsTerminal, setEditIsTerminal] = useState(false);
  const [auditReason, setAuditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newReason, setNewReason] = useState<typeof REASONS[number]>('onkológiai kezelés utáni állapot');
  const [newLabelHu, setNewLabelHu] = useState('');
  const [newOrderIndex, setNewOrderIndex] = useState(0);
  const [newIsTerminal, setNewIsTerminal] = useState(false);
  const [createAuditReason, setCreateAuditReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = reasonFilter
        ? `/api/stage-catalog?reason=${encodeURIComponent(reasonFilter)}`
        : '/api/stage-catalog';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Betöltési hiba');
      const data = await res.json();
      setItems(data.catalog ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, [reasonFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleEdit = (item: Stage) => {
    setEditing({ code: item.code, reason: item.reason });
    setEditLabelHu(item.labelHu);
    setEditOrderIndex(item.orderIndex);
    setEditIsTerminal(item.isTerminal);
    setAuditReason('');
  };

  const handleSaveEdit = async () => {
    if (!editing || !auditReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stage-catalog/${encodeURIComponent(editing.code)}?reason=${encodeURIComponent(editing.reason)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            labelHu: editLabelHu.trim(),
            orderIndex: editOrderIndex,
            isTerminal: editIsTerminal,
            auditReason: auditReason.trim(),
          }),
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

  const handleDelete = async (item: Stage) => {
    if (!confirm(`Törli: ${item.code} (${item.reason})?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stage-catalog/${encodeURIComponent(item.code)}?reason=${encodeURIComponent(item.reason)}&auditReason=${encodeURIComponent('Admin törlés')}`,
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
    if (!newCode.trim() || !newLabelHu.trim() || !createAuditReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/stage-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: newCode.trim(),
          reason: newReason,
          labelHu: newLabelHu.trim(),
          orderIndex: newOrderIndex,
          isTerminal: newIsTerminal,
          auditReason: createAuditReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setCreating(false);
      setNewCode('');
      setNewLabelHu('');
      setNewOrderIndex(0);
      setNewIsTerminal(false);
      setCreateAuditReason('');
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
      <h3 className="text-lg font-semibold">Stádiumok</h3>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
          {error}
        </div>
      )}
      <div className="flex gap-4 items-center">
        <label className="text-sm font-medium text-gray-700">Szűrő (reason):</label>
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="form-input text-sm w-64"
        >
          <option value="">— Összes</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">code</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">reason</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">label_hu</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">order</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">terminal</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item) => (
              <tr key={`${item.code}-${item.reason}`}>
                <td className="px-4 py-2 text-sm font-mono">{item.code}</td>
                <td className="px-4 py-2 text-sm text-gray-600">{item.reason}</td>
                <td className="px-4 py-2 text-sm">
                  {editing?.code === item.code && editing?.reason === item.reason ? (
                    <input
                      type="text"
                      value={editLabelHu}
                      onChange={(e) => setEditLabelHu(e.target.value)}
                      className="form-input text-sm w-full max-w-xs"
                    />
                  ) : (
                    item.labelHu
                  )}
                </td>
                <td className="px-4 py-2 text-sm">
                  {editing?.code === item.code && editing?.reason === item.reason ? (
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
                <td className="px-4 py-2 text-sm">
                  {editing?.code === item.code && editing?.reason === item.reason ? (
                    <input
                      type="checkbox"
                      checked={editIsTerminal}
                      onChange={(e) => setEditIsTerminal(e.target.checked)}
                    />
                  ) : (
                    item.isTerminal ? 'igen' : 'nem'
                  )}
                </td>
                <td className="px-4 py-2">
                  {editing?.code === item.code && editing?.reason === item.reason ? (
                    <div className="flex gap-2 items-center flex-wrap">
                      <input
                        type="text"
                        placeholder="Indoklás (kötelező)"
                        value={auditReason}
                        onChange={(e) => setAuditReason(e.target.value)}
                        className="form-input text-sm w-40"
                      />
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving || !auditReason.trim()}
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
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              className="form-input text-sm w-32"
            />
            <select
              value={newReason}
              onChange={(e) => setNewReason(e.target.value as typeof REASONS[number])}
              className="form-input text-sm w-56"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="label_hu"
              value={newLabelHu}
              onChange={(e) => setNewLabelHu(e.target.value)}
              className="form-input text-sm w-48"
            />
            <input
              type="number"
              placeholder="orderIndex"
              value={newOrderIndex}
              onChange={(e) => setNewOrderIndex(parseInt(e.target.value, 10) || 0)}
              className="form-input text-sm w-20"
            />
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={newIsTerminal}
                onChange={(e) => setNewIsTerminal(e.target.checked)}
              />
              terminal
            </label>
            <input
              type="text"
              placeholder="Indoklás (kötelező)"
              value={createAuditReason}
              onChange={(e) => setCreateAuditReason(e.target.value)}
              className="form-input text-sm w-40"
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCreate}
              disabled={saving || !newCode.trim() || !newLabelHu.trim() || !createAuditReason.trim()}
              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Létrehoz
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewCode('');
                setNewLabelHu('');
                setCreateAuditReason('');
              }}
              className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
            >
              Mégse
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-2 bg-medical-primary text-white rounded text-sm hover:bg-medical-primary-dark"
        >
          + Új stádium
        </button>
      )}
    </div>
  );
}
