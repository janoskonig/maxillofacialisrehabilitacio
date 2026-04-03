'use client';

import { useState, useEffect } from 'react';
import { X, FileText, Image as ImageIcon, Loader2, Send, Plus, Tag } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { getCurrentUser } from '@/lib/auth';
import { isLegacyDocumentTagSupersededInPicker } from '@/lib/patient-portrait-tag';

export type DocumentRequestSendWizardMode = 'admin' | 'chat_patient' | 'chat_modal';

interface DoctorOption {
  id: string;
  name: string;
  email: string;
}

/** Alapértelmezett címkék (azonos a dokumentumfeltöltés logikájával) */
const PRESET_TAG_OPTIONS: { value: string; label: string }[] = [
  { value: 'op', label: 'OP (máshol készített)' },
  { value: 'foto', label: 'Önarckép / portré (címke: foto)' },
  { value: 'zarojelentes', label: 'Zárójelentés' },
  { value: 'ambulans lap', label: 'Ambuláns lap' },
  { value: 'egyeb', label: 'Általános' },
];

function mergeDocumentTagOptions(apiTags: string[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const p of PRESET_TAG_OPTIONS) {
    seen.add(p.value.toLowerCase());
    out.push(p);
  }
  for (const t of apiTags) {
    const v = typeof t === 'string' ? t.trim() : '';
    if (!v) continue;
    if (isLegacyDocumentTagSupersededInPicker(v)) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ value: v, label: v });
  }
  return out;
}

function tagOptionIcon(value: string) {
  const lc = value.toLowerCase();
  if (lc === 'op' || lc === 'foto') return ImageIcon;
  return FileText;
}

interface DocumentRequestSendWizardProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName?: string | null;
  mode: DocumentRequestSendWizardMode;
  onSent?: () => void;
}

export function DocumentRequestSendWizard({
  isOpen,
  onClose,
  patientId,
  patientName,
  mode,
  onSent,
}: DocumentRequestSendWizardProps) {
  const { showToast } = useToast();
  const [target, setTarget] = useState<'patient' | 'colleague' | 'self'>('patient');
  const [colleagueId, setColleagueId] = useState('');
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [documentTag, setDocumentTag] = useState<string>('op');
  const [tagOptions, setTagOptions] = useState<{ value: string; label: string }[]>(() =>
    mergeDocumentTagOptions([])
  );
  const [loadingTags, setLoadingTags] = useState(false);
  const [customTagDraft, setCustomTagDraft] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    getCurrentUser().then((u) => setMyUserId(u?.id ?? null)).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || target !== 'colleague') return;
    let cancelled = false;
    (async () => {
      setLoadingDoctors(true);
      try {
        const res = await fetch('/api/users/doctors', { credentials: 'include' });
        if (!res.ok) throw new Error('Orvoslista betöltése sikertelen');
        const data = await res.json();
        const list: DoctorOption[] = (data.doctors || [])
          .filter((d: { id: string }) => d.id !== myUserId)
          .map((d: { id: string; name: string; email: string }) => ({
            id: d.id,
            name: d.name || d.email,
            email: d.email,
          }));
        if (!cancelled) setDoctors(list);
      } catch {
        if (!cancelled) showToast('Nem sikerült betölteni az orvosokat', 'error');
      } finally {
        if (!cancelled) setLoadingDoctors(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, target, myUserId, showToast]);

  useEffect(() => {
    if (!isOpen) {
      setTarget('patient');
      setColleagueId('');
      setNote('');
      setDocumentTag('op');
      setSubmitting(false);
      setTagOptions(mergeDocumentTagOptions([]));
      setCustomTagDraft('');
    } else if (mode === 'admin') {
      setTarget('patient');
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLoadingTags(true);
      try {
        const res = await fetch('/api/patients/documents/tags', { credentials: 'include' });
        const data = res.ok ? await res.json() : {};
        const merged = mergeDocumentTagOptions(Array.isArray(data.tags) ? data.tags : []);
        if (cancelled) return;
        setTagOptions(merged);
        setDocumentTag((prev) =>
          merged.some((o) => o.value === prev) ? prev : merged[0]!.value
        );
      } catch {
        if (!cancelled) {
          const merged = mergeDocumentTagOptions([]);
          setTagOptions(merged);
          setDocumentTag((prev) =>
            merged.some((o) => o.value === prev) ? prev : merged[0]!.value
          );
        }
      } finally {
        if (!cancelled) setLoadingTags(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const applyCustomTag = () => {
    const v = customTagDraft.trim();
    if (!v) return;
    setTagOptions((prev) => {
      if (prev.some((o) => o.value.toLowerCase() === v.toLowerCase())) {
        return prev;
      }
      return [...prev, { value: v, label: v }];
    });
    setDocumentTag(v);
    setCustomTagDraft('');
  };

  const handleSubmit = async () => {
    if (!patientId) {
      showToast('Hiányzó beteg', 'error');
      return;
    }
    if (target === 'colleague' && !colleagueId) {
      showToast('Válasszon kollégát', 'error');
      return;
    }
    if (!documentTag.trim()) {
      showToast('Válasszon vagy adjon meg címkét', 'error');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch('/api/document-request-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId,
          mode: target,
          colleagueUserId: target === 'colleague' ? colleagueId : null,
          documentTag: documentTag.trim(),
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Küldés sikertelen');
      }
      showToast(
        target === 'self' ? 'Emlékeztető feladat elmentve' : 'Dokumentumkérés elküldve',
        'success'
      );
      onSent?.();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Dokumentum bekérése</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {patientName && (
            <p className="text-sm text-gray-600">
              Beteg: <span className="font-medium text-gray-900">{patientName}</span>
            </p>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Kinek szól a kérés?</p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="target"
                  checked={target === 'patient'}
                  onChange={() => setTarget('patient')}
                />
                <span className="text-sm">Betegtől kérem (üzenet + feladat a beteg portálon)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="target"
                  checked={target === 'colleague'}
                  onChange={() => setTarget('colleague')}
                />
                <span className="text-sm">Orvoskollégától (üzenet + feladat a kollégának)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="target"
                  checked={target === 'self'}
                  onChange={() => setTarget('self')}
                />
                <span className="text-sm">Önmagamnak (csak feladat, emlékeztető)</span>
              </label>
            </div>
          </div>

          {target === 'colleague' && (
            <div>
              <label className="form-label">Kolléga</label>
              {loadingDoctors ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Betöltés...
                </div>
              ) : (
                <select
                  className="form-input w-full"
                  value={colleagueId}
                  onChange={(e) => setColleagueId(e.target.value)}
                >
                  <option value="">— Válasszon —</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
              <Tag className="w-4 h-4 text-medical-primary" />
              Címke
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Ugyanazok a címkék, mint a dokumentumfeltöltésnél; a bekért fájl ezzel a címkével kerül mentésre.
            </p>
            {loadingTags ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Címkék betöltése...
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1 mb-3">
                  {tagOptions.map((opt) => {
                    const Icon = tagOptionIcon(opt.value);
                    const sel = opt.value === documentTag;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDocumentTag(opt.value)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          sel
                            ? 'bg-medical-primary text-white border-medical-primary'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-90" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={customTagDraft}
                    onChange={(e) => setCustomTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyCustomTag();
                      }
                    }}
                    className="form-input flex-1 text-sm"
                    placeholder="Más címke (pl. még nem szerepel a listában)..."
                  />
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 flex items-center gap-1"
                    onClick={applyCustomTag}
                    disabled={!customTagDraft.trim()}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>

          <div>
            <label className="form-label">Megjegyzés (opcionális)</label>
            <textarea
              className="form-input w-full"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="További instrukciók..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t bg-gray-50">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Mégse
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Küldés
          </button>
        </div>
      </div>
    </div>
  );
}
