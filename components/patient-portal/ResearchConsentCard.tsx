'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

type ConsentStatus = 'unknown' | 'pending' | 'granted' | 'withdrawn' | 'expired';

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/patient-portal/research-consent', {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setState(data.state);
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
      <div className="bg-white rounded-lg shadow p-4 text-sm text-gray-500">
        Kutatási hozzájárulás betöltése…
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
        <Shield className="w-5 h-5 text-medical-primary" />
        Kutatási regiszter hozzájárulás
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Önkéntes hozzájárulás anonimizált adatok kutatási felhasználásához. Bármikor
        visszavonható.
      </p>

      {state.consentStatus === 'granted' ? (
        <div className="flex items-center gap-2 text-green-800 bg-green-50 rounded-lg p-3 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          Hozzájárulás megadva
        </div>
      ) : (
        <>
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
                <pre className="mt-2 p-3 bg-gray-50 rounded text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {state.activeVersion.consentBodyHu}
                </pre>
              )}
            </div>
          )}
          <label className="flex items-start gap-2 text-sm text-gray-700 mb-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={submitting}
              className="mt-1"
            />
            <span>Elolvastam és hozzájárulok a kutatási adatfelhasználáshoz.</span>
          </label>
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
        </>
      )}

      {state.consentStatus === 'granted' && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Visszavonás indoka
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-lg p-2 text-sm"
            rows={2}
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            disabled={submitting}
          />
          <button
            type="button"
            className="mt-2 text-sm text-red-700 underline"
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
