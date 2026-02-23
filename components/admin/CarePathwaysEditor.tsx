'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

const REASONS = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'] as const;
const POOLS = ['consult', 'work', 'control'] as const;
const POOL_LABELS: Record<string, string> = { consult: 'Konzultáció', work: 'Munka', control: 'Kontroll' };

type PathwayStep = {
  label: string;
  step_code?: string;
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

type CarePathwaysEditorProps = {
  editPathwayId?: string | null;
  onEditPathwayIdClear?: () => void;
};

function StepLabelInput({
  value,
  onChange,
  suggestions,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes((filter || value).toLowerCase()) && s !== value
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative flex-1 min-w-0">
      <input
        type="text"
        placeholder="Lépés neve"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setFilter(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setFilter('');
          setOpen(true);
        }}
        className="form-input text-sm w-full"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
          {filtered.slice(0, 15).map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 hover:text-blue-800"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CarePathwaysEditor({ editPathwayId, onEditPathwayIdClear }: CarePathwaysEditorProps = {}) {
  const router = useRouter();
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [treatmentTypes, setTreatmentTypes] = useState<TreatmentType[]>([]);
  const [labelSuggestions, setLabelSuggestions] = useState<string[]>([]);
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
      const [pwRes, ttRes, sugRes] = await Promise.all([
        fetch('/api/care-pathways', { credentials: 'include' }),
        fetch('/api/treatment-types', { credentials: 'include' }),
        fetch('/api/step-labels/suggestions', { credentials: 'include' }),
      ]);
      if (!pwRes.ok) throw new Error('Betöltési hiba');
      if (ttRes.ok) {
        const ttData = await ttRes.json();
        setTreatmentTypes((ttData.treatmentTypes ?? []).sort((a: TreatmentType, b: TreatmentType) => a.labelHu.localeCompare(b.labelHu)));
      }
      if (sugRes.ok) {
        const sugData = await sugRes.json();
        setLabelSuggestions(sugData.labels ?? []);
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

  useEffect(() => {
    if (editPathwayId && pathways.length > 0) {
      const p = pathways.find((pw) => pw.id === editPathwayId);
      if (p) handleEdit(p);
    }
  }, [editPathwayId, pathways]);

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
      { label: '', pool: 'work', duration_minutes: 30, default_days_offset: 14 },
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

  const stepToLabel = (step: PathwayStep): string => {
    return step.label || step.step_code || '';
  };

  const handleEdit = (p: Pathway) => {
    setEditingId(p.id);
    setFormName(p.name);
    setFormReason(p.reason);
    setFormTreatmentTypeId(p.treatmentTypeId);
    const steps: PathwayStep[] = Array.isArray(p.stepsJson) ? p.stepsJson.map((s) => ({
      ...s,
      label: s.label || '',
    })) : [];
    setFormSteps(steps);
    setFormUpdatedAt((p as { updatedAt?: string }).updatedAt ?? null);
    setAuditReason('');
  };

  const buildStepsPayload = () =>
    formSteps.map((s) => ({
      label: s.label.trim(),
      pool: s.pool,
      duration_minutes: Math.max(5, Number(s.duration_minutes) || 30),
      default_days_offset: s.default_days_offset != null ? Number(s.default_days_offset) : null,
      requires_precommit: s.requires_precommit || false,
    }));

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
        stepsJson: buildStepsPayload(),
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
      onEditPathwayIdClear?.();
      router.refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const closeEdit = () => {
    setEditingId(null);
    onEditPathwayIdClear?.();
  };

  const closeCreate = () => {
    setCreating(false);
    onEditPathwayIdClear?.();
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
      onEditPathwayIdClear?.();
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
        stepsJson: buildStepsPayload(),
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
      { label: 'Első konzultáció', pool: 'consult', duration_minutes: 30, default_days_offset: 0 },
      { label: 'Lenyomat', pool: 'work', duration_minutes: 45, default_days_offset: 14 },
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
                <td className="px-4 py-2 text-sm">
                  <span title={(p.stepsJson ?? []).map((s, i) => `${i + 1}. ${stepToLabel(s)}`).join('\n')}>
                    {(p.stepsJson ?? []).length}
                  </span>
                </td>
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
              <label className="block text-sm font-medium text-gray-700">Klinikai lépések</label>
              <button
                onClick={addStep}
                className="px-2 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                + Lépés
              </button>
            </div>

            <div className="space-y-1 mb-1">
              <div className="flex gap-2 items-center px-2 text-xs text-gray-500 font-medium">
                <span className="w-6 text-center">#</span>
                <span className="flex-1 min-w-0">Lépés neve</span>
                <span className="w-28 text-center">Típus</span>
                <span className="w-16 text-center">Perc</span>
                <span className="w-20 text-center">Nap</span>
                <span className="w-20">Precommit</span>
                <span className="w-20"></span>
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {formSteps.map((step, idx) => (
                <div key={idx} className="flex gap-2 items-center p-2 bg-white rounded border">
                  <span className="w-6 text-center text-xs text-gray-400 font-mono shrink-0">
                    {idx + 1}
                  </span>
                  <StepLabelInput
                    value={step.label}
                    onChange={(v) => updateStep(idx, 'label', v)}
                    suggestions={labelSuggestions}
                  />
                  <select
                    value={step.pool}
                    onChange={(e) => updateStep(idx, 'pool', e.target.value)}
                    className="form-input text-sm w-28 shrink-0"
                  >
                    {POOLS.map((pool) => (
                      <option key={pool} value={pool}>{POOL_LABELS[pool]}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="perc"
                    value={step.duration_minutes}
                    onChange={(e) => updateStep(idx, 'duration_minutes', parseInt(e.target.value, 10) || 30)}
                    className="form-input text-sm w-16 shrink-0"
                    title="Időtartam (perc)"
                  />
                  <input
                    type="number"
                    placeholder="nap"
                    value={step.default_days_offset ?? ''}
                    onChange={(e) => updateStep(idx, 'default_days_offset', e.target.value ? parseInt(e.target.value, 10) : null)}
                    className="form-input text-sm w-20 shrink-0"
                    title="Napok az előző lépés után"
                  />
                  <label className="flex items-center gap-1 text-sm shrink-0 w-20">
                    <input
                      type="checkbox"
                      checked={!!step.requires_precommit}
                      onChange={(e) => updateStep(idx, 'requires_precommit', e.target.checked)}
                    />
                    <span className="text-xs">precommit</span>
                  </label>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => moveStep(idx, 'up')}
                      disabled={idx === 0}
                      className="px-1 py-0.5 bg-gray-400 text-white rounded text-xs disabled:opacity-50"
                      title="Fel"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveStep(idx, 'down')}
                      disabled={idx === formSteps.length - 1}
                      className="px-1 py-0.5 bg-gray-400 text-white rounded text-xs disabled:opacity-50"
                      title="Le"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeStep(idx)}
                      className="px-1 py-0.5 bg-red-500 text-white rounded text-xs"
                      title="Törlés"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {formSteps.length === 0 && (
                <p className="text-sm text-gray-400 italic px-2 py-4 text-center">
                  Nincs lépés. Kattintson a &quot;+ Lépés&quot; gombra.
                </p>
              )}
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
                  onClick={closeEdit}
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
                  onClick={closeCreate}
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
