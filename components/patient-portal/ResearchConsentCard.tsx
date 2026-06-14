'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

type ConsentStatus = 'unknown' | 'pending' | 'granted' | 'withdrawn' | 'expired' | 'declined';

interface ConsentState {
  consentStatus: ConsentStatus;
  activeVersion: { versionLabel: string; consentBodyHu: string | null } | null;
}

export function ResearchConsentCard() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<ConsentState | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [showText, setShowText] = useState(false);
  const [isMinor, setIsMinor] = useState(false);
  const [guardianName, setGuardianName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, statusRes] = await Promise.all([
        fetch('/api/patient-portal/research-consent', { credentials: 'include' }),
        fetch('/api/patient-portal/consent-status', { credentials: 'include' }),
      ]);
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
      }
      if (statusRes.ok) {
        const s = await statusRes.json();
        setIsMinor(s.isMinor === true);
        setGuardianName(s.guardianName ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/patient-portal/research-consent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Hiba');
      setState(data.state);
      showToast('Hozzájárulás frissítve', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4 text-sm text-gray-500 dark:text-gray-400">
        Kutatási hozzájárulás betöltése…
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-2">
        <Shield className="w-5 h-5 text-medical-primary" />
        Kutatási regiszter hozzájárulás
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Önkéntes hozzájárulás anonimizált adatok kutatási felhasználásához. Bármikor
        visszavonható.
      </p>

      {isMinor && (
        <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-lg p-3 mb-3">
          Kiskorú páciens — a nyilatkozatot a törvényes képviselő
          {guardianName ? ` (${guardianName})` : ''} teszi meg.
        </p>
      )}

      {state.consentStatus === 'granted' ? (
        <div className="flex items-center gap-2 text-green-800 dark:text-green-300 bg-green-50 dark:bg-green-950/40 rounded-lg p-3 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          Hozzájárulás megadva
        </div>
      ) : (
        <>
          {state.consentStatus === 'declined' && (
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 text-sm mb-4">
              <XCircle className="w-5 h-5 shrink-0" />
              Elutasította a kutatási hozzájárulást. Bármikor meggondolhatja magát alább.
            </div>
          )}
          {state.activeVersion?.consentBodyHu && (
            <div className="mb-4">
              <button
                type="button"
                className="text-sm text-medical-primary hover:underline"
                onClick={() => setShowText((v) => !v)}
              >
                {showText ? 'Szöveg elrejtése' : 'Hozzájárulási szöveg megtekintése'}
              </button>
              {showText && (
                <pre className="mt-2 p-3 bg-gray-50 dark:bg-gray-800/60 rounded text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {state.activeVersion.consentBodyHu}
                </pre>
              )}
            </div>
          )}
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 mb-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={submitting}
              className="mt-1"
            />
            <span>Elolvastam és hozzájárulok a kutatási adatfelhasználáshoz.</span>
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              disabled={submitting || !agreed}
              className="btn-primary text-sm w-full sm:w-auto"
              onClick={() =>
                post({ action: 'grant', attestation: 'i_agree_to_research_consent' })
              }
            >
              Hozzájárulás megadása
            </button>
            {state.consentStatus !== 'declined' && (
              <button
                type="button"
                disabled={submitting}
                className="btn-secondary text-sm w-full sm:w-auto"
                onClick={() => post({ action: 'decline' })}
              >
                Nem járulok hozzá
              </button>
            )}
          </div>
        </>
      )}

      {state.consentStatus === 'granted' && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Visszavonás indoka
          </label>
          <textarea
            className="w-full border border-gray-300 dark:border-gray-700 rounded-lg p-2 text-sm"
            rows={2}
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            disabled={submitting}
          />
          <button
            type="button"
            className="mt-2 text-sm text-red-700 dark:text-red-300 underline"
            disabled={submitting || withdrawReason.trim().length < 3}
            onClick={() =>
              post({ action: 'withdraw', reason: withdrawReason.trim() })
            }
          >
            Hozzájárulás visszavonása
          </button>
        </div>
      )}
    </div>
  );
}
