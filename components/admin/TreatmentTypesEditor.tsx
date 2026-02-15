'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type TreatmentType = { id: string; code: string; labelHu: string };

export function TreatmentTypesEditor() {
  const router = useRouter();
  const [items, setItems] = useState<TreatmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabelHu, setEditLabelHu] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabelHu, setNewLabelHu] = useState('');
  const [auditReason, setAuditReason] = useState('');
  const [createAuditReason, setCreateAuditReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/treatment-types', { credentials: 'include' });
      if (!res.ok) throw new Error('Betöltési hiba');
      const data = await res.json();
      setItems((data.treatmentTypes ?? []).sort((a: TreatmentType, b: TreatmentType) => a.labelHu.localeCompare(b.labelHu)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleEdit = (item: TreatmentType) => {
    setEditingId(item.id);
    setEditLabelHu(item.labelHu);
    setAuditReason('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !auditReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/treatment-types/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ labelHu: editLabelHu.trim(), auditReason: auditReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setEditingId(null);
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: TreatmentType) => {
    if (!confirm(`Törli: ${item.labelHu}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/treatment-types/${item.id}?auditReason=${encodeURIComponent('Admin törlés')}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setEditingId(null);
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
      const res = await fetch('/api/treatment-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: newCode.trim().toLowerCase().replace(/\s+/g, '_'),
          labelHu: newLabelHu.trim(),
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
      <h3 className="text-lg font-semibold">Kezeléstípusok</h3>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">code</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">label_hu</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2 text-sm font-mono text-gray-700">{item.code}</td>
                <td className="px-4 py-2 text-sm">
                  {editingId === item.id ? (
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
                <td className="px-4 py-2">
                  {editingId === item.id ? (
                    <div className="flex gap-2 items-center">
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
                        onClick={() => setEditingId(null)}
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
          <input
            type="text"
            placeholder="code (a-z, 0-9, _)"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            className="form-input text-sm w-48"
          />
          <input
            type="text"
            placeholder="label_hu"
            value={newLabelHu}
            onChange={(e) => setNewLabelHu(e.target.value)}
            className="form-input text-sm w-64 ml-2"
          />
          <input
            type="text"
            placeholder="Indoklás (kötelező)"
            value={createAuditReason}
            onChange={(e) => setCreateAuditReason(e.target.value)}
            className="form-input text-sm w-48 ml-2"
          />
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
          + Új kezeléstípus
        </button>
      )}
    </div>
  );
}
