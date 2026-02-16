'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, ChevronDown, ChevronUp, Download } from 'lucide-react';

type StepCatalogItem = {
  stepCode: string;
  labelHu: string;
  labelEn: string | null;
  isActive: boolean;
  updatedAt: string;
};

type RowStatus = 'idle' | 'saving' | 'saved' | 'error';

export function StepCatalogEditor() {
  const router = useRouter();
  const [items, setItems] = useState<StepCatalogItem[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, { labelHu: string; labelEn: string | null; isActive: boolean }>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [batchExpanded, setBatchExpanded] = useState(false);
  const [batchCsv, setBatchCsv] = useState('');
  const [batchStatus, setBatchStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, unmappedRes] = await Promise.all([
        fetch('/api/step-catalog', { credentials: 'include' }),
        fetch('/api/step-catalog/unmapped', { credentials: 'include' }),
      ]);
      if (!catRes.ok) throw new Error('Betöltési hiba');
      const catData = await catRes.json();
      setItems(catData.items ?? []);
      if (unmappedRes.ok) {
        const unmappedData = await unmappedRes.json();
        setUnmapped(unmappedData.items ?? []);
      } else {
        setUnmapped([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (item: StepCatalogItem) => {
    setEditing((prev) => ({
      ...prev,
      [item.stepCode]: {
        labelHu: item.labelHu,
        labelEn: item.labelEn ?? '',
        isActive: item.isActive,
      },
    }));
    setRowStatus((prev) => ({ ...prev, [item.stepCode]: 'idle' }));
    setRowError((prev) => ({ ...prev, [item.stepCode]: '' }));
  };

  const cancelEdit = (stepCode: string) => {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[stepCode];
      return next;
    });
    setRowStatus((prev) => ({ ...prev, [stepCode]: 'idle' }));
    setRowError((prev) => ({ ...prev, [stepCode]: '' }));
  };

  const updateEdit = (stepCode: string, field: 'labelHu' | 'labelEn' | 'isActive', value: string | boolean) => {
    setEditing((prev) => {
      const cur = prev[stepCode];
      if (!cur) return prev;
      return {
        ...prev,
        [stepCode]: { ...cur, [field]: value },
      };
    });
  };

  const handleSave = async (stepCode: string) => {
    const edit = editing[stepCode];
    if (!edit) return;

    setRowStatus((prev) => ({ ...prev, [stepCode]: 'saving' }));
    setRowError((prev) => ({ ...prev, [stepCode]: '' }));

    try {
      const res = await fetch(`/api/step-catalog/${encodeURIComponent(stepCode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          labelHu: edit.labelHu.trim(),
          labelEn: edit.labelEn?.trim() || null,
          isActive: edit.isActive,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setRowStatus((prev) => ({ ...prev, [stepCode]: 'error' }));
        setRowError((prev) => ({ ...prev, [stepCode]: data.error ?? `Hiba (${res.status})` }));
        return;
      }

      setRowStatus((prev) => ({ ...prev, [stepCode]: 'saved' }));
      setEditing((prev) => {
        const next = { ...prev };
        delete next[stepCode];
        return next;
      });
      router.refresh();
      await load();
      setTimeout(() => {
        setRowStatus((prev) => ({ ...prev, [stepCode]: 'idle' }));
      }, 2000);
    } catch (e) {
      setRowStatus((prev) => ({ ...prev, [stepCode]: 'error' }));
      setRowError((prev) => ({ ...prev, [stepCode]: e instanceof Error ? e.message : 'Hiba' }));
    }
  };

  const handleBatchUpload = async () => {
    const text = batchCsv.trim();
    if (!text) {
      setBatchStatus('error');
      setBatchMessage('Adjon meg CSV tartalmat vagy töltsön fel fájlt.');
      return;
    }
    setBatchStatus('uploading');
    setBatchMessage(null);
    try {
      const res = await fetch('/api/step-catalog/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        credentials: 'include',
        body: text,
      });
      const data = await res.json();
      if (!res.ok) {
        setBatchStatus('error');
        setBatchMessage(data.error ?? data.details?.join?.(' ') ?? `Hiba (${res.status})`);
        return;
      }
      setBatchStatus('success');
      setBatchMessage(
        `${data.upserted} elem feltöltve.${data.skipped ? ` ${data.skipped} kihagyva.` : ''}`
      );
      setBatchCsv('');
      router.refresh();
      await load();
    } catch (e) {
      setBatchStatus('error');
      setBatchMessage(e instanceof Error ? e.message : 'Hiba');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBatchCsv(String(reader.result ?? ''));
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  if (loading) return <p className="text-gray-600">Betöltés...</p>;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Részlépések (step_code → címke)</h3>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
          {error}
        </div>
      )}

      {unmapped.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded">
          <p className="text-sm font-medium text-amber-900 mb-1">Unmapped step_code-ok (nincs címke a katalógusban):</p>
          <p className="text-sm text-amber-800 font-mono">{unmapped.join(', ')}</p>
          <p className="text-xs text-amber-700 mt-1">
            Ezek a care_pathways.steps_json-ból jönnek. Adjon hozzá címkét a katalógushoz vagy módosítsa a pathway-t.
          </p>
        </div>
      )}

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setBatchExpanded((b) => !b)}
          className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 text-left text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Batch feltöltés (CSV)
          </span>
          {batchExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {batchExpanded && (
          <div className="p-4 bg-white border-t border-gray-200 space-y-3">
            <p className="text-xs text-gray-600">
              CSV formátum: <code className="bg-gray-100 px-1 rounded">step_code,label_hu,label_en,is_active</code> — fejléc opcionális. Elválasztó: vessző vagy pontosvessző.
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm flex items-center gap-1"
              >
                Fájl kiválasztása
              </button>
              <a
                href={`data:text/csv;charset=utf-8,${encodeURIComponent('step_code,label_hu,label_en,is_active\nconsult_1,Első konzultáció,,1\ndiagnostic,Diagnosztika,Diagnostics,1\nimpression_1,Lenyomat 1,,1')}`}
                download="step_catalog_template.csv"
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm flex items-center gap-1"
              >
                <Download className="w-4 h-4" />
                Sablon letöltése
              </a>
            </div>
            <textarea
              value={batchCsv}
              onChange={(e) => setBatchCsv(e.target.value)}
              placeholder={'step_code,label_hu,label_en,is_active\nconsult_1,Első konzultáció,,1\ndiagnostic,Diagnosztika,Diagnostics,1'}
              rows={6}
              className="w-full font-mono text-sm border border-gray-300 rounded p-2"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleBatchUpload}
                disabled={batchStatus === 'uploading' || !batchCsv.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {batchStatus === 'uploading' ? 'Feltöltés…' : 'Feltöltés'}
              </button>
              {batchMessage && (
                <span
                  className={`text-sm ${batchStatus === 'success' ? 'text-green-700' : batchStatus === 'error' ? 'text-red-600' : 'text-gray-600'}`}
                >
                  {batchMessage}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">step_code</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">label_hu</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">label_en</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">aktív</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item) => {
              const edit = editing[item.stepCode];
              const status = rowStatus[item.stepCode] ?? 'idle';
              const errMsg = rowError[item.stepCode] ?? '';

              return (
                <tr key={item.stepCode}>
                  <td className="px-4 py-2 text-sm font-mono">{item.stepCode}</td>
                  <td className="px-4 py-2 text-sm">
                    {edit ? (
                      <input
                        type="text"
                        value={edit.labelHu}
                        onChange={(e) => updateEdit(item.stepCode, 'labelHu', e.target.value)}
                        className="form-input text-sm w-full max-w-xs"
                      />
                    ) : (
                      item.labelHu
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {edit ? (
                      <input
                        type="text"
                        value={edit.labelEn ?? ''}
                        onChange={(e) => updateEdit(item.stepCode, 'labelEn', e.target.value)}
                        className="form-input text-sm w-full max-w-xs"
                        placeholder="opcionális"
                      />
                    ) : (
                      item.labelEn ?? '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {edit ? (
                      <input
                        type="checkbox"
                        checked={edit.isActive}
                        onChange={(e) => updateEdit(item.stepCode, 'isActive', e.target.checked)}
                      />
                    ) : (
                      item.isActive ? 'igen' : 'nem'
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {edit ? (
                      <div className="flex gap-2 items-center flex-wrap">
                        <button
                          onClick={() => handleSave(item.stepCode)}
                          disabled={status === 'saving' || !edit.labelHu.trim()}
                          className="px-2 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                        >
                          {status === 'saving' ? 'Mentés…' : status === 'saved' ? 'Mentve' : 'Mentés'}
                        </button>
                        <button
                          onClick={() => cancelEdit(item.stepCode)}
                          disabled={status === 'saving'}
                          className="px-2 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 disabled:opacity-50"
                        >
                          Mégse
                        </button>
                        {status === 'error' && errMsg && (
                          <span className="text-red-600 text-xs">{errMsg}</span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(item)}
                        className="px-2 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Szerkeszt
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
