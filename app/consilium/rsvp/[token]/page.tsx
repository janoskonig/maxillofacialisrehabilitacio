'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { CalendarClock, Check, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Logo } from '@/components/Logo';

type RsvpResponse = 'going' | 'late' | 'reschedule';

type InvitationData = {
  attendeeName: string;
  sessionTitle: string;
  sessionScheduledAt: string;
  sessionStatus: 'draft' | 'active' | 'closed';
  responded: boolean;
  response: RsvpResponse | null;
  respondedAt: string | null;
  proposedAt: string | null;
  proposedNote: string | null;
};

const RESPONSE_LABEL: Record<RsvpResponse, string> = {
  going: 'Ott leszek',
  late: 'Kések',
  reschedule: 'Máskor lenne jó',
};

function isRsvpResponse(value: string | null): value is RsvpResponse {
  return value === 'going' || value === 'late' || value === 'reschedule';
}

function formatHuDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('hu-HU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

/**
 * `<input type="datetime-local">` -> ISO string (UTC).
 * A felhasználó helyi időt ír be — a böngésző JS Date-je a helyi tz-ben értelmezi.
 */
function localDateTimeToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** ISO -> "YYYY-MM-DDTHH:mm" a `<input type="datetime-local">`-hez. */
function isoToLocalDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ConsiliumRsvpPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = typeof params.token === 'string' ? params.token : Array.isArray(params.token) ? params.token[0] : '';

  const [data, setData] = useState<InvitationData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const presetFromQuery = searchParams.get('response');
  const initialChoice: RsvpResponse | null = isRsvpResponse(presetFromQuery)
    ? presetFromQuery
    : null;

  const [choice, setChoice] = useState<RsvpResponse | null>(initialChoice);
  const [proposedLocal, setProposedLocal] = useState<string>('');
  const [proposedNote, setProposedNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedOk, setSubmittedOk] = useState<{
    response: RsvpResponse;
    proposedAt: string | null;
    proposedNote: string | null;
  } | null>(null);

  const fetchInvitation = useCallback(async () => {
    if (!token) {
      setLoadError('Hiányzó token a linkben.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/consilium/invitations/${encodeURIComponent(token)}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as
        | { invitation?: InvitationData; error?: string }
        | null;
      if (!res.ok) {
        setLoadError(body?.error || 'Érvénytelen vagy lejárt meghívó link.');
        setData(null);
        return;
      }
      const inv = body?.invitation ?? null;
      if (!inv) {
        setLoadError('Hiányzó válasz a szervertől.');
        setData(null);
        return;
      }
      setData(inv);
      if (inv.responded) {
        setSubmittedOk({
          response: inv.response ?? 'going',
          proposedAt: inv.proposedAt,
          proposedNote: inv.proposedNote,
        });
        if (inv.response) setChoice(inv.response);
        if (inv.proposedAt) setProposedLocal(isoToLocalDateTime(inv.proposedAt));
        if (inv.proposedNote) setProposedNote(inv.proposedNote);
      }
    } catch {
      setLoadError('Hálózati hiba a meghívó betöltésekor.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchInvitation();
  }, [fetchInvitation]);

  const sessionDateText = useMemo(
    () => (data ? formatHuDateTime(data.sessionScheduledAt) : ''),
    [data],
  );

  const canSubmit = useMemo(() => {
    if (!choice || submitting) return false;
    if (data?.sessionStatus === 'closed') return false;
    if (choice === 'reschedule') {
      const iso = localDateTimeToIso(proposedLocal);
      if (!iso) return false;
    }
    return true;
  }, [choice, submitting, data?.sessionStatus, proposedLocal]);

  const submit = useCallback(async () => {
    if (!choice || !token) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const proposedAt = choice === 'reschedule' ? localDateTimeToIso(proposedLocal) : null;
      const trimmedNote = proposedNote.trim();
      const res = await fetch(`/api/consilium/invitations/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: choice,
          proposedAt,
          proposedNote: choice === 'reschedule' && trimmedNote ? trimmedNote : null,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; response?: RsvpResponse; proposedAt?: string | null; proposedNote?: string | null; error?: string }
        | null;
      if (!res.ok || !body?.ok) {
        setSubmitError(body?.error || 'A válasz mentése nem sikerült. Kérjük, próbáld újra.');
        return;
      }
      setSubmittedOk({
        response: body.response ?? choice,
        proposedAt: body.proposedAt ?? null,
        proposedNote: body.proposedNote ?? null,
      });
    } catch {
      setSubmitError('Hálózati hiba a válasz küldésekor.');
    } finally {
      setSubmitting(false);
    }
  }, [choice, proposedLocal, proposedNote, token]);

  const renderShell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-b from-cyan-50 to-white">
      <header className="bg-white shadow-soft border-b border-gray-200/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Logo width={36} height={42} />
          <div>
            <h1 className="text-base sm:text-lg font-semibold text-medical-primary">Konzílium meghívó</h1>
            <p className="text-xs text-gray-500">Kérjük, jelezz vissza a részvételedről</p>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );

  if (loading) {
    return renderShell(
      <div className="card p-6 flex items-center gap-3 text-gray-600">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Meghívó betöltése…</span>
      </div>,
    );
  }

  if (loadError || !data) {
    return renderShell(
      <div className="card p-6 space-y-3">
        <h2 className="text-lg font-semibold text-red-700">Nem sikerült betölteni a meghívót</h2>
        <p className="text-sm text-gray-700">
          {loadError || 'Ismeretlen hiba. Lehet, hogy a link visszavonásra került.'}
        </p>
        <p className="text-xs text-gray-500">
          Ha úgy gondolod, hogy ez tévedés, kérlek, vedd fel a kapcsolatot a meghívást küldő kollégával.
        </p>
      </div>,
    );
  }

  const sessionClosed = data.sessionStatus === 'closed';

  return renderShell(
    <div className="space-y-4">
      <section className="card p-4 sm:p-6 space-y-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-gray-500">Címzett</p>
          <p className="text-sm font-medium text-gray-900">{data.attendeeName}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Téma</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{data.sessionTitle}</p>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 inline-flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5" /> Időpont
            </p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{sessionDateText}</p>
          </div>
        </div>
        {sessionClosed && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
            Az alkalom már lezárult, új RSVP választ nem fogadunk el.
          </p>
        )}
      </section>

      {submittedOk ? (
        <section className="card p-4 sm:p-6 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <Check className="w-5 h-5" />
            <h2 className="text-base font-semibold">Köszönjük a visszajelzést!</h2>
          </div>
          <p className="text-sm text-gray-700">
            Visszajelzésed: <strong>{RESPONSE_LABEL[submittedOk.response]}</strong>
          </p>
          {submittedOk.response === 'reschedule' && submittedOk.proposedAt && (
            <p className="text-sm text-gray-700">
              Javasolt időpont: <strong>{formatHuDateTime(submittedOk.proposedAt)}</strong>
            </p>
          )}
          {submittedOk.proposedNote && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              Megjegyzés: <em>{submittedOk.proposedNote}</em>
            </p>
          )}
          {!sessionClosed && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">
                Ha meggondolnád magad, módosíthatod a választ.
              </p>
              <button
                type="button"
                className="btn-secondary text-sm inline-flex items-center gap-2"
                onClick={() => setSubmittedOk(null)}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Válasz módosítása
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="card p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Mit válaszolsz?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              disabled={sessionClosed}
              onClick={() => setChoice('going')}
              className={`rounded-lg border px-4 py-3 text-left transition disabled:opacity-50 ${
                choice === 'going'
                  ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                  : 'border-gray-200 hover:border-emerald-300 bg-white'
              }`}
            >
              <p className="text-sm font-semibold text-emerald-800 inline-flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Ott leszek
              </p>
              <p className="text-xs text-gray-600 mt-1">Az időpontban részt veszek.</p>
            </button>
            <button
              type="button"
              disabled={sessionClosed}
              onClick={() => setChoice('late')}
              className={`rounded-lg border px-4 py-3 text-left transition disabled:opacity-50 ${
                choice === 'late'
                  ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-200'
                  : 'border-gray-200 hover:border-amber-300 bg-white'
              }`}
            >
              <p className="text-sm font-semibold text-amber-800 inline-flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> Kések
              </p>
              <p className="text-xs text-gray-600 mt-1">Ott leszek, csak később érek be.</p>
            </button>
            <button
              type="button"
              disabled={sessionClosed}
              onClick={() => setChoice('reschedule')}
              className={`rounded-lg border px-4 py-3 text-left transition disabled:opacity-50 ${
                choice === 'reschedule'
                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                  : 'border-gray-200 hover:border-indigo-300 bg-white'
              }`}
            >
              <p className="text-sm font-semibold text-indigo-800 inline-flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4" /> Máskor lenne jó
              </p>
              <p className="text-xs text-gray-600 mt-1">Más időpontot javasolok.</p>
            </button>
          </div>

          {choice === 'reschedule' && (
            <div className="space-y-2 rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
              <div>
                <label className="text-xs font-medium text-gray-700">Javasolt időpont</label>
                <input
                  type="datetime-local"
                  className="form-input mt-1 w-full"
                  value={proposedLocal}
                  disabled={sessionClosed}
                  onChange={(e) => setProposedLocal(e.target.value)}
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  A javasolt időpontot a szervező látja — végleges időpontváltozást ő kezdeményez.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Megjegyzés (opcionális)</label>
                <textarea
                  className="form-input mt-1 w-full min-h-[72px] text-sm"
                  placeholder="Pl. délután után jobban megfelelne…"
                  value={proposedNote}
                  maxLength={1000}
                  disabled={sessionClosed}
                  onChange={(e) => setProposedNote(e.target.value)}
                />
                <p className="text-[11px] text-gray-400 text-right mt-0.5">
                  {proposedNote.length}/1000
                </p>
              </div>
            </div>
          )}

          {submitError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1.5">
              {submitError}
            </p>
          )}

          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Küldés…
                </>
              ) : (
                'Válasz küldése'
              )}
            </button>
          </div>
        </section>
      )}

      <p className="text-[11px] text-gray-400 text-center">
        Ezt a linket a szervező adta ki neked. Bárki, aki a linket megkapta, válaszolhat — kérjük, ne továbbítsd.
      </p>
    </div>,
  );
}
