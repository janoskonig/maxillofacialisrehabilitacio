'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type CatalogItem = {
  code: string;
  labelHu: string;
  labelEn: string | null;
  defaultCarePathwayId: string | null;
  sortOrder: number;
  isActive: boolean;
};

type Pathway = { id: string; name: string };

type EditState = {
  labelHu: string;
  labelEn: string;
  sortOrder: number;
  isActive: boolean;
  defaultCarePathwayId: string;
};

export function ToothTreatmentCatalogEditor() {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabelHu, setNewLabelHu] = useState('');
  const [newSortOrder, setNewSortOrder] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, pwRes] = await Promise.all([
        fetch('/api/tooth-treatment-catalog?all=true', { credentials: 'include' }),
        fetch('/api/care-pathways', { credentials: 'include' }),
      ]);
      if (!catRes.ok) throw new Error('Betöltési hiba');
      const catData = await catRes.json();
      setItems(catData.items ?? []);
      if (pwRes.ok) {
        const pwData = await pwRes.json();
        setPathways((pwData.pathways ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (item: CatalogItem) => {
    setEditingCode(item.code);
    setEditState({
      labelHu: item.labelHu,
      labelEn: item.labelEn ?? '',
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      defaultCarePathwayId: item.defaultCarePathwayId ?? '',
    });
  };

  const handleSave = async () => {
    if (!editingCode || !editState) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tooth-treatment-catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: editingCode,
          labelHu: editState.labelHu.trim(),
          labelEn: editState.labelEn.trim() || null,
          sortOrder: editState.sortOrder,
          isActive: editState.isActive,
          defaultCarePathwayId: editState.defaultCarePathwayId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setEditingCode(null);
      setEditState(null);
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newCode.trim() || !newLabelHu.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tooth-treatment-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: newCode.trim().toLowerCase().replace(/\s+/g, '_'),
          labelHu: newLabelHu.trim(),
          sortOrder: newSortOrder,
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
      setNewSortOrder(0);
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (code: string, labelHu: string) => {
    if (!confirm(`Inaktiválja: ${labelHu}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tooth-treatment-catalog?code=${encodeURIComponent(code)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
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
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Név (HU)</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sorrend</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Alapért. kezelési út</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Aktív</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item) => {
              const isEditing = editingCode === item.code;
              return (
                <tr key={item.code} className={!item.isActive ? 'opacity-50' : ''}>
                  <td className="px-4 py-2 text-sm font-mono text-gray-700">{item.code}</td>
                  <td className="px-4 py-2 text-sm">
                    {isEditing && editState ? (
                      <input
                        type="text"
                        value={editState.labelHu}
                        onChange={(e) => setEditState({ ...editState, labelHu: e.target.value })}
                        className="form-input text-sm w-full max-w-xs"
                      />
                    ) : (
                      item.labelHu
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {isEditing && editState ? (
                      <input
                        type="number"
                        value={editState.sortOrder}
                        onChange={(e) => setEditState({ ...editState, sortOrder: parseInt(e.target.value) || 0 })}
                        className="form-input text-sm w-20"
                      />
                    ) : (
                      item.sortOrder
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {isEditing && editState ? (
                      <select
                        value={editState.defaultCarePathwayId}
                        onChange={(e) => setEditState({ ...editState, defaultCarePathwayId: e.target.value })}
                        className="form-input text-sm w-48"
                      >
                        <option value="">— nincs —</option>
                        {pathways.map((pw) => (
                          <option key={pw.id} value={pw.id}>{pw.name}</option>
                        ))}
                      </select>
                    ) : (
                      (() => {
                        const pw = pathways.find((p) => p.id === item.defaultCarePathwayId);
                        return pw ? pw.name : '—';
                      })()
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {isEditing && editState ? (
                      <input
                        type="checkbox"
                        checked={editState.isActive}
                        onChange={(e) => setEditState({ ...editState, isActive: e.target.checked })}
                      />
                    ) : (
                      item.isActive ? 'igen' : 'nem'
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <button
                          onClick={handleSave}
                          disabled={saving || !editState?.labelHu.trim()}
                          className="px-2 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                        >
                          Mentés
                        </button>
                        <button
                          onClick={() => { setEditingCode(null); setEditState(null); }}
                          className="px-2 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                        >
                          Mégse
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(item)}
                          className="px-2 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                        >
                          Szerkeszt
                        </button>
                        {item.isActive && (
                          <button
                            onClick={() => handleDelete(item.code, item.labelHu)}
                            disabled={saving}
                            className="px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                          >
                            Inaktív
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating ? (
        <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-2">
          <div className="flex gap-2 flex-wrap items-end">
            <div>
              <label className="text-xs text-gray-500 block">code</label>
              <input
                type="text"
                placeholder="code (a-z, 0-9, _)"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                className="form-input text-sm w-40"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block">Név (HU)</label>
              <input
                type="text"
                placeholder="pl. Tömés"
                value={newLabelHu}
                onChange={(e) => setNewLabelHu(e.target.value)}
                className="form-input text-sm w-48"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block">Sorrend</label>
              <input
                type="number"
                value={newSortOrder}
                onChange={(e) => setNewSortOrder(parseInt(e.target.value) || 0)}
                className="form-input text-sm w-20"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCreate}
              disabled={saving || !newCode.trim() || !newLabelHu.trim()}
              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Létrehoz
            </button>
            <button
              onClick={() => { setCreating(false); setNewCode(''); setNewLabelHu(''); setNewSortOrder(0); }}
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
          + Új fog-kezelési típus
        </button>
      )}
    </div>
  );
}
