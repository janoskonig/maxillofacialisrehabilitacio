'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const REASONS = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'] as const;
const POOLS = ['consult', 'work', 'control'] as const;

type PathwayStep = {
  step_code: string;
  pool: string;
  duration_minutes: number;
  default_days_offset?: number | null;
  requires_precommit?: boolean;
};

type Pathway = {
  id: string;
  name: string;
  reason: string | null;
  treatmentTypeId: string | null;
  stepsJson: PathwayStep[];
  governance?: { episodeCount: number };
};

type TreatmentType = { id: string; code: string; labelHu: string };

export function CarePathwaysEditor() {
  const router = useRouter();
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [treatmentTypes, setTreatmentTypes] = useState<TreatmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [auditReason, setAuditReason] = useState('');
  const [createAuditReason, setCreateAuditReason] = useState('');

  const [formName, setFormName] = useState('');
  const [formReason, setFormReason] = useState<string | null>(null);
  const [formTreatmentTypeId, setFormTreatmentTypeId] = useState<string | null>(null);
  const [formSteps, setFormSteps] = useState<PathwayStep[]>([]);
  const [formUpdatedAt, setFormUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pwRes, ttRes] = await Promise.all([
        fetch('/api/care-pathways', { credentials: 'include' }),
        fetch('/api/treatment-types', { credentials: 'include' }),
      ]);
      if (!pwRes.ok) throw new Error('Betöltési hiba');
      if (ttRes.ok) {
        const ttData = await ttRes.json();
        setTreatmentTypes((ttData.treatmentTypes ?? []).sort((a: TreatmentType, b: TreatmentType) => a.labelHu.localeCompare(b.labelHu)));
      }
      const pwData = await pwRes.json();
      setPathways(pwData.pathways ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const moveStep = (idx: number, dir: 'up' | 'down') => {
    setFormSteps((prev) => {
      const next = [...prev];
      const j = dir === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const addStep = () => {
    setFormSteps((prev) => [
      ...prev,
      { step_code: 'new_step', pool: 'work', duration_minutes: 30, default_days_offset: 14 },
    ]);
  };

  const removeStep = (idx: number) => {
    setFormSteps((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateStep = (idx: number, field: keyof PathwayStep, value: unknown) => {
    setFormSteps((prev) => {
      const next = [...prev];
      (next[idx] as Record<string, unknown>)[field] = value;
      return next;
    });
  };

  const handleEdit = (p: Pathway) => {
    setEditingId(p.id);
    setFormName(p.name);
    setFormReason(p.reason);
    setFormTreatmentTypeId(p.treatmentTypeId);
    setFormSteps(Array.isArray(p.stepsJson) ? [...p.stepsJson] : []);
    setFormUpdatedAt((p as { updatedAt?: string }).updatedAt ?? null);
    setAuditReason('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !auditReason.trim()) return;
    const reason = formReason && formReason !== '' ? formReason : null;
    const treatmentTypeId = formTreatmentTypeId && formTreatmentTypeId !== '' ? formTreatmentTypeId : null;
    if ((reason && treatmentTypeId) || (!reason && !treatmentTypeId)) {
      setError('Pontosan az egyik: reason vagy kezeléstípus kötelező');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        stepsJson: formSteps.map((s) => ({
          ...s,
          step_code: String(s.step_code).trim().toLowerCase().replace(/\s+/g, '_'),
          duration_minutes: Math.max(5, Number(s.duration_minutes) || 30),
          default_days_offset: s.default_days_offset != null ? Number(s.default_days_offset) : null,
        })),
        auditReason: auditReason.trim(),
      };
      if (reason) body.reason = reason;
      else body.treatmentTypeId = treatmentTypeId;
      if (formUpdatedAt) body.expectedUpdatedAt = formUpdatedAt;

      const res = await fetch(`/api/care-pathways/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? data.current ? 'A kezelési út közben megváltozott. Frissítse és próbálja újra.' : `Hiba (${res.status})`);
        if (data.current) {
          setFormUpdatedAt(data.current.updatedAt ?? null);
        }
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

  const handleDelete = async (p: Pathway) => {
    if (!confirm(`Törli: ${p.name}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/care-pathways/${p.id}?auditReason=${encodeURIComponent('Admin törlés')}`, {
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
    const reason = formReason && formReason !== '' ? formReason : null;
    const treatmentTypeId = formTreatmentTypeId && formTreatmentTypeId !== '' ? formTreatmentTypeId : null;
    if ((reason && treatmentTypeId) || (!reason && !treatmentTypeId)) {
      setError('Pontosan az egyik: reason vagy kezeléstípus kötelező');
      return;
    }
    if (!createAuditReason.trim()) {
      setError('Indoklás kötelező');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        stepsJson: formSteps.map((s) => ({
          ...s,
          step_code: String(s.step_code).trim().toLowerCase().replace(/\s+/g, '_'),
          duration_minutes: Math.max(5, Number(s.duration_minutes) || 30),
          default_days_offset: s.default_days_offset != null ? Number(s.default_days_offset) : null,
        })),
        auditReason: createAuditReason.trim(),
      };
      if (reason) body.reason = reason;
      else body.treatmentTypeId = treatmentTypeId;

      const res = await fetch('/api/care-pathways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Hiba (${res.status})`);
        return;
      }
      setCreating(false);
      setFormName('');
      setFormReason(null);
      setFormTreatmentTypeId(null);
      setFormSteps([]);
      setCreateAuditReason('');
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const startCreate = () => {
    setCreating(true);
    setFormName('');
    setFormReason('onkológiai kezelés utáni állapot');
    setFormTreatmentTypeId(null);
    setFormSteps([
      { step_code: 'consult_1', pool: 'consult', duration_minutes: 30, default_days_offset: 0 },
      { step_code: 'work_1', pool: 'work', duration_minutes: 45, default_days_offset: 14 },
    ]);
    setCreateAuditReason('');
    setError(null);
  };

  if (loading) return <p className="text-gray-600">Betöltés...</p>;

  const showForm = editingId || creating;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Kezelési utak</h3>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Név</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason / Típus</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lépések</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Epizódok</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pathways.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 text-sm font-medium">{p.name}</td>
                <td className="px-4 py-2 text-sm text-gray-600">
                  {p.reason ?? (treatmentTypes.find((t) => t.id === p.treatmentTypeId)?.labelHu ?? p.treatmentTypeId ?? '—')}
                </td>
                <td className="px-4 py-2 text-sm">{(p.stepsJson ?? []).length}</td>
                <td className="px-4 py-2 text-sm">{p.governance?.episodeCount ?? 0}</td>
                <td className="px-4 py-2">
                  {editingId === p.id ? null : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(p)}
                        className="px-2 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Szerkeszt
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        disabled={saving || (p.governance?.episodeCount ?? 0) > 0}
                        className="px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                        title={(p.governance?.episodeCount ?? 0) > 0 ? 'Nem törölhető: epizódok hivatkoznak' : ''}
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

      {showForm && (
        <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-4">
          <h4 className="font-medium">{editingId ? 'Szerkesztés' : 'Új kezelési út'}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Név</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="form-input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason (vagy Kezeléstípus)</label>
              <div className="flex gap-4">
                <select
                  value={formReason ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormReason(v || null);
                    if (v) setFormTreatmentTypeId(null);
                  }}
                  className="form-input flex-1"
                >
                  <option value="">— Reason —</option>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <span className="self-center text-gray-500">vagy</span>
                <select
                  value={formTreatmentTypeId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormTreatmentTypeId(v || null);
                    if (v) setFormReason(null);
                  }}
                  className="form-input flex-1"
                >
                  <option value="">— Kezeléstípus —</option>
                  {treatmentTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.labelHu}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">Munkafázisok (steps)</label>
              <button
                onClick={addStep}
                className="px-2 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                + Lépés
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {formSteps.map((step, idx) => (
                <div key={idx} className="flex gap-2 items-center flex-wrap p-2 bg-white rounded border">
                  <input
                    type="text"
                    placeholder="step_code"
                    value={step.step_code}
                    onChange={(e) => updateStep(idx, 'step_code', e.target.value)}
                    className="form-input text-sm w-28 font-mono"
                  />
                  <select
                    value={step.pool}
                    onChange={(e) => updateStep(idx, 'pool', e.target.value)}
                    className="form-input text-sm w-24"
                  >
                    {POOLS.map((pool) => (
                      <option key={pool} value={pool}>{pool}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="perc"
                    value={step.duration_minutes}
                    onChange={(e) => updateStep(idx, 'duration_minutes', parseInt(e.target.value, 10) || 30)}
                    className="form-input text-sm w-16"
                  />
                  <input
                    type="number"
                    placeholder="nap offset"
                    value={step.default_days_offset ?? ''}
                    onChange={(e) => updateStep(idx, 'default_days_offset', e.target.value ? parseInt(e.target.value, 10) : null)}
                    className="form-input text-sm w-20"
                  />
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={!!step.requires_precommit}
                      onChange={(e) => updateStep(idx, 'requires_precommit', e.target.checked)}
                    />
                    precommit
                  </label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => moveStep(idx, 'up')}
                      disabled={idx === 0}
                      className="px-1 py-0.5 bg-gray-400 text-white rounded text-xs disabled:opacity-50"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveStep(idx, 'down')}
                      disabled={idx === formSteps.length - 1}
                      className="px-1 py-0.5 bg-gray-400 text-white rounded text-xs disabled:opacity-50"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeStep(idx)}
                      className="px-1 py-0.5 bg-red-500 text-white rounded text-xs"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Indoklás (kötelező)</label>
            <input
              type="text"
              placeholder="Miért módosítom?"
              value={editingId ? auditReason : createAuditReason}
              onChange={(e) => (editingId ? setAuditReason(e.target.value) : setCreateAuditReason(e.target.value))}
              className="form-input w-full max-w-md"
            />
          </div>

          <div className="flex gap-2">
            {editingId ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !auditReason.trim() || !formName.trim()}
                  className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Mentés
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  Mégse
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCreate}
                  disabled={saving || !createAuditReason.trim() || !formName.trim() || formSteps.length === 0}
                  className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Létrehoz
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  Mégse
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!showForm && (
        <button
          onClick={startCreate}
          className="px-3 py-2 bg-medical-primary text-white rounded text-sm hover:bg-medical-primary-dark"
        >
          + Új kezelési út
        </button>
      )}
    </div>
  );
}
