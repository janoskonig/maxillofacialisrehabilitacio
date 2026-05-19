'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';

type ConsentStatus = 'unknown' | 'pending' | 'granted' | 'withdrawn' | 'expired';

interface ConsentState {
  consentStatus: ConsentStatus;
  legacyComplianceStatus: string | null;
  researchUsable: boolean;
  activeVersion: {
    versionLabel: string;
    consentBodyHu: string | null;
  } | null;
}

interface ConsentEvent {
  newStatus: string;
  actorEmail: string | null;
  recordedAt: string;
  versionLabel: string | null;
}

interface ResearchConsentSectionProps {
  patientId: string;
  isViewOnly: boolean;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const STATUS_LABELS: Record<ConsentStatus, string> = {
  unknown: 'Ismeretlen',
  pending: 'Függőben',
  granted: 'Megadva',
  withdrawn: 'Visszavonva',
  expired: 'Lejárt',
};

function StatusBadge({ status }: { status: ConsentStatus }) {
  const styles: Record<ConsentStatus, string> = {
    unknown: 'bg-gray-100 text-gray-800',
    pending: 'bg-amber-100 text-amber-900',
    granted: 'bg-green-100 text-green-800',
    withdrawn: 'bg-red-100 text-red-800',
    expired: 'bg-gray-100 text-gray-600',
  };
  const icons: Record<ConsentStatus, React.ReactNode> = {
    unknown: <AlertCircle className="w-4 h-4" />,
    pending: <Clock className="w-4 h-4" />,
    granted: <CheckCircle2 className="w-4 h-4" />,
    withdrawn: <XCircle className="w-4 h-4" />,
    expired: <XCircle className="w-4 h-4" />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${styles[status]}`}
    >
      {icons[status]}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ResearchConsentSection({
  patientId,
  isViewOnly,
  showToast,
}: ResearchConsentSectionProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<ConsentState | null>(null);
  const [events, setEvents] = useState<ConsentEvent[]>([]);
  const [showText, setShowText] = useState(false);
  const [captureMethod, setCaptureMethod] = useState<
    'written_form' | 'verbal_documented' | 'electronic'
  >('written_form');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [attestationChecked, setAttestationChecked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/research-consent`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Betöltési hiba');
      const data = await res.json();
      setState(data.state);
      setEvents(data.events ?? []);
    } catch {
      showToast('Nem sikerült betölteni a kutatási hozzájárulás adatait', 'error');
    } finally {
      setLoading(false);
    }
  }, [patientId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const postAction = async (body: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/research-consent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Művelet sikertelen');
      setState(data.state);
      await load();
      showToast('Kutatási hozzájárulás frissítve', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="card mt-4">
        <p className="text-sm text-gray-500">Kutatási hozzájárulás betöltése…</p>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="card mt-4">
      <h4 className="text-lg font-semibold text-gray-900 mb-2 flex items-center">
        <Shield className="w-5 h-5 mr-2 text-medical-primary" />
        Kutatási regiszter hozzájárulás
      </h4>
      <p className="text-sm text-gray-600 mb-4">
        Anonimizált adatok kutatási célú felhasználásához. A visszavonás a jövőbeli exportokból zár ki.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <StatusBadge status={state.consentStatus} />
        {state.researchUsable && (
          <span className="text-xs text-green-700 font-medium">Kutatásra alkalmas</span>
        )}
        {state.legacyComplianceStatus && (
          <span className="text-xs text-gray-500">Compliance: {state.legacyComplianceStatus}</span>
        )}
      </div>

      {state.activeVersion && (
        <div className="mb-4">
          <button
            type="button"
            className="text-sm text-medical-primary hover:underline"
            onClick={() => setShowText((v) => !v)}
          >
            {showText ? 'Szöveg elrejtése' : `Hozzájárulási szöveg (${state.activeVersion.versionLabel})`}
          </button>
          {showText && state.activeVersion.consentBodyHu && (
            <pre className="mt-2 p-3 bg-gray-50 rounded text-xs whitespace-pre-wrap text-gray-800 max-h-48 overflow-y-auto">
              {state.activeVersion.consentBodyHu}
            </pre>
          )}
        </div>
      )}

      {!isViewOnly && state.consentStatus !== 'granted' && (
        <div className="mb-4 border-t border-gray-100 pt-4">
          <label className="form-label">Rögzítés módja</label>
          <select
            className="form-input max-w-xs"
            value={captureMethod}
            onChange={(e) =>
              setCaptureMethod(e.target.value as typeof captureMethod)
            }
            disabled={submitting}
          >
            <option value="written_form">Írásbeli űrlap</option>
            <option value="verbal_documented">Szóbeli, dokumentálva</option>
            <option value="electronic">Elektronikus (nem portál)</option>
          </select>
          <label className="flex items-start gap-2 mt-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={attestationChecked}
              onChange={(e) => setAttestationChecked(e.target.checked)}
              disabled={submitting}
              className="mt-1 rounded border-gray-300 text-medical-primary"
            />
            <span>
              Megerősítem, hogy a beteget tájékoztattam, és a kutatási hozzájárulást rögzítem.
            </span>
          </label>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={submitting || !attestationChecked}
              onClick={() =>
                postAction({
                  action: 'grant',
                  captureMethod,
                  attestation: 'patient_informed_and_agreed',
                })
              }
            >
              Hozzájárulás rögzítése
            </button>
            {state.consentStatus === 'unknown' && (
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={submitting}
                onClick={() => postAction({ action: 'pending' })}
              >
                Függőben jelölés
              </button>
            )}
          </div>
        </div>
      )}

      {!isViewOnly && state.consentStatus === 'granted' && (
        <div className="mb-4 border-t border-gray-100 pt-4">
          <label className="form-label">Visszavonás indoka</label>
          <textarea
            className="form-input"
            rows={2}
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            disabled={submitting}
            placeholder="Kötelező rövid indoklás"
          />
          <button
            type="button"
            className="btn-secondary text-sm mt-2 text-red-700 border-red-200"
            disabled={submitting || withdrawReason.trim().length < 3}
            onClick={() =>
              postAction({
                action: 'withdraw',
                reason: withdrawReason.trim(),
                captureMethod: 'verbal_documented',
              })
            }
          >
            Hozzájárulás visszavonása
          </button>
        </div>
      )}

      {events.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Előzmények
          </p>
          <ul className="text-xs text-gray-600 space-y-1">
            {events.slice(0, 5).map((ev, i) => (
              <li key={i}>
                {new Date(ev.recordedAt).toLocaleString('hu-HU')} — {ev.newStatus}
                {ev.versionLabel ? ` (${ev.versionLabel})` : ''}
                {ev.actorEmail ? ` · ${ev.actorEmail}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
