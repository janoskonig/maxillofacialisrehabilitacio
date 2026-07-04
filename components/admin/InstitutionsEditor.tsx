'use client';

import { useEffect, useState } from 'react';
import { Building2, Plus, Check, X, Pencil } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface Institution {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

/**
 * Beutaló intézmények törzsének kezelése (admin): hozzáadás, átnevezés,
 * aktiválás/inaktiválás. Hard delete nincs — az inaktív intézmény csak a
 * beutaló-űrlap autocomplete-jéből tűnik el.
 */
export function InstitutionsEditor() {
  const { showToast } = useToast();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/admin/institutions', { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInstitutions(data.institutions || []);
    } catch {
      showToast('Hiba az intézmények betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/institutions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mentés sikertelen');
      setNewName('');
      showToast('Intézmény hozzáadva', 'success');
      await load();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, payload: { name?: string; active?: boolean }) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/institutions/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mentés sikertelen');
      setEditingId(null);
      await load();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1">
        <Building2 className="w-5 h-5 text-medical-primary" aria-hidden="true" />
        Beutaló intézmények
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        A beutaló-űrlap intézmény-autocomplete törzse. Az inaktív intézmény nem jelenik meg a
        listában, de a korábbi beutalókban rögzített név megmarad.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
          className="form-input flex-1"
          placeholder="Új intézmény neve..."
          aria-label="Új intézmény neve"
        />
        <button
          type="button"
          onClick={create}
          disabled={busy || !newName.trim()}
          className="btn-primary px-3 py-2 flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Hozzáadás
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Betöltés...</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {institutions.map(inst => (
            <li key={inst.id} className="py-2 flex items-center gap-2">
              {editingId === inst.id ? (
                <>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && patch(inst.id, { name: editName.trim() })}
                    className="form-input flex-1 text-sm"
                    aria-label="Intézmény új neve"
                  />
                  <button
                    type="button"
                    onClick={() => patch(inst.id, { name: editName.trim() })}
                    disabled={busy || !editName.trim()}
                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded"
                    aria-label="Átnevezés mentése"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    aria-label="Szerkesztés elvetése"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span
                    className={`flex-1 text-sm ${
                      inst.active
                        ? 'text-gray-900 dark:text-gray-100'
                        : 'text-gray-400 dark:text-gray-500 line-through'
                    }`}
                  >
                    {inst.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(inst.id);
                      setEditName(inst.name);
                    }}
                    className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    aria-label={`${inst.name} átnevezése`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(inst.id, { active: !inst.active })}
                    disabled={busy}
                    className={`text-xs px-2 py-1 rounded-full border font-medium ${
                      inst.active
                        ? 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-red-400 hover:text-red-600'
                        : 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                    }`}
                  >
                    {inst.active ? 'Inaktiválás' : 'Aktiválás'}
                  </button>
                </>
              )}
            </li>
          ))}
          {institutions.length === 0 && (
            <li className="py-2 text-sm text-gray-500 dark:text-gray-400">A törzs üres.</li>
          )}
        </ul>
      )}
    </div>
  );
}
