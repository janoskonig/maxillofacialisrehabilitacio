'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export function PrivacyNoticeCard() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isMinor, setIsMinor] = useState(false);
  const [guardianName, setGuardianName] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/patient-portal/consent-status', {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setAcknowledged(data.noticeAcknowledged === true);
      setIsMinor(data.isMinor === true);
      setGuardianName(data.guardianName ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/patient-portal/privacy-notice-ack', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Hiba');
      setAcknowledged(true);
      showToast('Adatkezelési tájékoztató tudomásulvétele rögzítve', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4 text-sm text-gray-500">
        Adatkezelési tájékoztató betöltése…
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
        <ShieldCheck className="w-5 h-5 text-medical-primary" />
        Adatkezelési tájékoztató
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Az ellátási adatkezelés jogalapja a GDPR 9. cikk (2) h) pontja és az 1997. évi CLIV.
        törvény — ehhez nem hozzájárulás, hanem a tájékoztató megismerése szükséges.{' '}
        <Link href="/privacy-hu" className="text-medical-primary hover:underline">
          Adatkezelési tájékoztató megtekintése
        </Link>
      </p>

      {isMinor && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-3 mb-3">
          Kiskorú páciens — a nyilatkozatot a törvényes képviselő
          {guardianName ? ` (${guardianName})` : ''} teszi meg.
        </p>
      )}

      {acknowledged ? (
        <div className="flex items-center gap-2 text-green-800 bg-green-50 rounded-lg p-3 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          Tájékoztató tudomásul véve
        </div>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm text-gray-700 mb-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={submitting}
              className="mt-1"
            />
            <span>
              {isMinor
                ? 'A kiskorú törvényes képviselőjeként megismertem és tudomásul vettem az adatkezelési tájékoztatót.'
                : 'Megismertem és tudomásul vettem az adatkezelési tájékoztatót.'}
            </span>
          </label>
          <button
            type="button"
            disabled={submitting || !agreed}
            className="btn-primary text-sm w-full sm:w-auto"
            onClick={acknowledge}
          >
            Tudomásulvétel rögzítése
          </button>
        </>
      )}
    </div>
  );
}
