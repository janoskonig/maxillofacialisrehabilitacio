'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

type NextSession = {
  id: string;
  title: string;
  scheduledAt: string;
  status: 'draft' | 'active' | 'closed';
};

export function PatientNextConsiliumSessionCard({ patientId }: { patientId: string }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<NextSession | null>(null);
  const [alreadyOnList, setAlreadyOnList] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/consilium/sessions/next-upcoming-draft?patientId=${encodeURIComponent(patientId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('load_failed');
      const data = await res.json();
      setSession(data.session ?? null);
      setAlreadyOnList(!!data.alreadyOnList);
    } catch {
      setSession(null);
      setAlreadyOnList(false);
      showToast('Nem sikerült betölteni a konzílium adatot', 'error');
    } finally {
      setLoading(false);
    }
  }, [patientId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const enroll = async () => {
    setEnrolling(true);
    try {
      const res = await fetch('/api/consilium/sessions/next-upcoming-draft/enroll', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        showToast(data.error || 'A beteg már szerepel az alkalmon', 'error');
        setAlreadyOnList(true);
        return;
      }
      if (res.status === 404) {
        showToast(data.error || 'Nincs megfelelő vázlat alkalom', 'error');
        await load();
        return;
      }
      if (!res.ok) {
        showToast(data.error || 'Felvétel sikertelen', 'error');
        return;
      }
      showToast('Beteg felvéve a soron következő megbeszélés listájára', 'success');
      setAlreadyOnList(true);
    } catch {
      showToast('Felvétel sikertelen', 'error');
    } finally {
      setEnrolling(false);
    }
  };

  const when = session
    ? new Date(session.scheduledAt).toLocaleString('hu-HU', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-medical-primary/10 p-2 text-medical-primary">
          <CalendarPlus className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Konzílium – következő megbeszélés</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              A pácienst egy kattintással felveheted a legkorábbi, még vázlat állapotú, jövőbeli alkalom beteglistájára
              (ugyanaz, mint a Konzílium modulban).
            </p>
          </div>

          {loading ? (
            <p className="text-xs text-gray-500 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Betöltés…
            </p>
          ) : !session ? (
            <p className="text-xs text-gray-600">
              Jelenleg nincs olyan vázlat alkalom, amelynek időpontja még nem múlt el. Hozz létre egyet, vagy állíts vissza
              vázlatba a{' '}
              <Link href="/consilium" className="text-medical-primary underline font-medium">
                Konzílium
              </Link>{' '}
              oldalon.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-800">
                <span className="font-medium">{session.title}</span>
                <span className="text-gray-500"> · {when}</span>
              </p>
              {alreadyOnList ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                  Ez a beteg már szerepel ennek az alkalomnak a listáján.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={alreadyOnList || enrolling}
                  onClick={() => void enroll()}
                  className="inline-flex items-center gap-2 rounded-md bg-medical-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 disabled:pointer-events-none hover:opacity-95"
                >
                  {enrolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Felvétel a listára
                </button>
                <Link href="/consilium" className="text-xs text-medical-primary underline">
                  Konzílium megnyitása
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
