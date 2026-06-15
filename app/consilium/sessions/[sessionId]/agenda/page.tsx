'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarClock, Loader2 } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import type { ConsiliumPresentationItem } from '@/lib/consilium-presentation';
import { formatConsiliumHuDateTime } from '@/lib/consilium-view-helpers';

type AgendaSession = {
  id: string;
  title: string;
  scheduledAt: string;
  status: 'draft' | 'active' | 'closed';
};

type AgendaResponse = {
  session: AgendaSession;
  items: ConsiliumPresentationItem[];
};

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

export default function ConsiliumSessionAgendaPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId =
    typeof params.sessionId === 'string'
      ? params.sessionId
      : Array.isArray(params.sessionId)
        ? params.sessionId[0]
        : '';

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newChecklistByItemId, setNewChecklistByItemId] = useState<Record<string, string>>({});
  const [commentDraftByKey, setCommentDraftByKey] = useState<Record<string, string>>({});
  const [addingChecklistItemId, setAddingChecklistItemId] = useState<string | null>(null);
  const [submittingCommentKey, setSubmittingCommentKey] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        if (!u) router.replace('/login');
      })
      .catch(() => router.replace('/login'))
      .finally(() => setLoadingUser(false));
  }, [router]);

  const loadAgenda = useCallback(async () => {
    if (!user || !sessionId) return;
    setLoadingData(true);
    setError(null);
    try {
      const res = await fetch(`/api/consilium/sessions/${encodeURIComponent(sessionId)}/presentation`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as
        | (AgendaResponse & { error?: string })
        | { error?: string }
        | null;
      if (!res.ok) {
        setError((body as { error?: string })?.error || 'Nem sikerült betölteni a napirendet.');
        setData(null);
        return;
      }
      const parsed = body as AgendaResponse;
      if (!parsed?.session || !Array.isArray(parsed.items)) {
        setError('Hiányzó válasz a szervertől.');
        setData(null);
        return;
      }
      setData(parsed);
    } catch {
      setError('Hálózati hiba a napirend betöltésekor.');
      setData(null);
    } finally {
      setLoadingData(false);
    }
  }, [user, sessionId]);

  useEffect(() => {
    void loadAgenda();
  }, [loadAgenda]);

  const sortedItems = useMemo(() => data?.items ?? [], [data]);
  const readonly = data?.session.status === 'closed';

  const addChecklistPoint = useCallback(
    async (itemId: string) => {
      if (readonly || !sessionId) return;
      const label = (newChecklistByItemId[itemId] || '').trim();
      if (!label) return;
      setActionError(null);
      setAddingChecklistItemId(itemId);
      try {
        const res = await fetch(
          `/api/consilium/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}/checklist`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setActionError(body.error || 'Nem sikerült az új napirendi pont mentése.');
          return;
        }
        setNewChecklistByItemId((prev) => ({ ...prev, [itemId]: '' }));
        await loadAgenda();
      } catch {
        setActionError('Hálózati hiba történt az új pont mentésekor.');
      } finally {
        setAddingChecklistItemId(null);
      }
    },
    [readonly, sessionId, newChecklistByItemId, loadAgenda],
  );

  const submitPrepComment = useCallback(
    async (itemId: string, checklistKey: string) => {
      if (readonly || !sessionId) return;
      const draftKey = `${itemId}:${checklistKey}`;
      const bodyText = (commentDraftByKey[draftKey] || '').trim();
      if (!bodyText) return;
      setActionError(null);
      setSubmittingCommentKey(draftKey);
      try {
        const res = await fetch(
          `/api/consilium/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}/prep-comments`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              checklistKey,
              body: bodyText,
            }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setActionError(body.error || 'Nem sikerült a hozzászólás mentése.');
          return;
        }
        setCommentDraftByKey((prev) => ({ ...prev, [draftKey]: '' }));
        await loadAgenda();
      } catch {
        setActionError('Hálózati hiba történt a hozzászólás mentésekor.');
      } finally {
        setSubmittingCommentKey(null);
      }
    },
    [readonly, sessionId, commentDraftByKey, loadAgenda],
  );

  const renderShell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-b from-cyan-50 to-white">
      <header className="bg-white dark:bg-gray-900 shadow-soft border-b border-gray-200/60 dark:border-gray-800/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo width={36} height={42} />
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-medical-primary truncate">
                Konzílium napirend
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">A betegek névsora az alkalomhoz</p>
            </div>
          </div>
          <Link href="/consilium" className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            Konzílium
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );

  if (loadingUser) {
    return renderShell(
      <div className="card p-6 flex items-center gap-3 text-gray-600 dark:text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Bejelentkezés ellenőrzése…</span>
      </div>,
    );
  }

  if (!user) {
    return renderShell(
      <div className="card p-6 text-sm text-gray-600 dark:text-gray-400">Átirányítás bejelentkezésre…</div>,
    );
  }

  if (loadingData && !data) {
    return renderShell(
      <div className="card p-6 flex items-center gap-3 text-gray-600 dark:text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Napirend betöltése…</span>
      </div>,
    );
  }

  if (error || !data) {
    return renderShell(
      <div className="card p-6 space-y-3">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">Nem sikerült betölteni a napirendet</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {error ||
            'Lehet, hogy nincs jogosultságod megnézni ezt az alkalmat (csak az alkalom intézményéhez tartozó felhasználók látják a napirendet).'}
        </p>
        <Link href="/consilium" className="btn-secondary inline-flex items-center gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Vissza a Konzílium oldalra
        </Link>
      </div>,
    );
  }

  return renderShell(
    <div className="space-y-4">
      {actionError && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          {actionError}
        </div>
      )}
      <section className="card p-4 sm:p-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Téma</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{data.session.title}</p>
          </div>
          <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5" /> Időpont
            </p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {formatHuDateTime(data.session.scheduledAt)}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Státusz: {data.session.status}</p>
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-6 space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Előkészítő anyagcsomag ({sortedItems.length} beteg)
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            A konzíliumra előkészített beteganyagok egyben: alapadatok, checklist és előkészítő megjegyzések.
          </p>
        </div>

        {sortedItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Még nincs beteg az alkalmon.</p>
        ) : (
          <ol className="space-y-3">
            {sortedItems.map((it) => (
              <li
                key={it.id}
                className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 px-3 py-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-300 text-xs font-semibold">
                    {it.sortOrder}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {it.patientSummary.name || <em className="text-gray-400 dark:text-gray-500">Beteg neve nem elérhető</em>}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      {it.patientSummary.taj ? `TAJ: ${it.patientSummary.taj}` : 'TAJ nem elérhető'}
                      {typeof it.patientSummary.age === 'number'
                        ? ` · ${it.patientSummary.age} év`
                        : ''}
                    </p>
                    {it.patientSummary.diagnozis && (
                      <p className="text-xs text-gray-700 dark:text-gray-300 mt-1">{it.patientSummary.diagnozis}</p>
                    )}
                  </div>
                  {it.discussionState?.discussed && (
                    <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded border bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800">
                      Megbeszélve
                    </span>
                  )}
                </div>

                <div className="rounded-md border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-2 space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Kép előnézet: OP {it.mediaSummary?.opPreview?.imageCount ?? 0} · Fotó{' '}
                    {it.mediaSummary?.photoPreview?.imageCount ?? 0}
                  </p>
                  {it.mediaSummary?.opPreview?.previews?.[0]?.previewUrl ? (
                    <div className="rounded-md overflow-hidden border border-gray-200 dark:border-gray-800 bg-black/5">
                      <img
                        src={it.mediaSummary.opPreview.previews[0].previewUrl}
                        alt="OP előnézet"
                        className="w-full max-h-56 object-contain bg-black"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Nincs OP előnézet.</p>
                  )}
                  {(it.mediaSummary?.photoPreview?.previews?.length ?? 0) > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {it.mediaSummary.photoPreview.previews.slice(0, 6).map((photo) => (
                        <div
                          key={photo.documentId}
                          className="rounded-md overflow-hidden border border-gray-200 dark:border-gray-800 bg-black/5"
                        >
                          <img
                            src={photo.previewUrl}
                            alt="Fotó előnézet"
                            className="w-full h-24 object-cover"
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Nincs fotó előnézet.</p>
                  )}
                </div>

                {(it.discussionState?.checklist?.length ?? 0) > 0 && (
                  <div className="rounded-md border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-2 space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Checklist</p>
                    <ul className="space-y-1">
                      {it.discussionState.checklist.map((entry) => (
                        <li key={entry.key} className="text-xs text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-800 p-2 space-y-1.5">
                          <p>
                            - {entry.label}
                            {entry.response ? (
                              <span className="text-gray-600 dark:text-gray-400"> — {entry.response}</span>
                            ) : null}
                          </p>
                          {(it.prepComments ?? []).filter((c) => c.checklistKey === entry.key).length > 0 && (
                            <ul className="space-y-1">
                              {(it.prepComments ?? [])
                                .filter((c) => c.checklistKey === entry.key)
                                .map((comment) => (
                                  <li key={comment.id} className="rounded bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-100 dark:border-cyan-800 px-2 py-1 text-[11px] text-gray-800 dark:text-gray-200">
                                    <span className="text-cyan-700 dark:text-cyan-300">
                                      {comment.authorDisplay} · {formatConsiliumHuDateTime(comment.createdAt)}
                                    </span>
                                    <p className="mt-0.5 whitespace-pre-wrap">{comment.body}</p>
                                  </li>
                                ))}
                            </ul>
                          )}
                          {!readonly && (
                            <div className="space-y-1">
                              <textarea
                                className="w-full rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs min-h-[58px]"
                                placeholder="Előkészítő megjegyzés vagy kérdés..."
                                value={commentDraftByKey[`${it.id}:${entry.key}`] || ''}
                                onChange={(e) =>
                                  setCommentDraftByKey((prev) => ({
                                    ...prev,
                                    [`${it.id}:${entry.key}`]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-50"
                                disabled={submittingCommentKey === `${it.id}:${entry.key}`}
                                onClick={() => void submitPrepComment(it.id, entry.key)}
                              >
                                {submittingCommentKey === `${it.id}:${entry.key}` ? 'Mentés…' : 'Megjegyzés mentése'}
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!readonly && (
                  <div className="rounded-md border border-indigo-100 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 p-2 space-y-1.5">
                    <p className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                      Új napirendi kérdés / pont
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        className="flex-1 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs"
                        placeholder="Pl. Műtéti kockázat megbeszélése"
                        value={newChecklistByItemId[it.id] || ''}
                        onChange={(e) =>
                          setNewChecklistByItemId((prev) => ({
                            ...prev,
                            [it.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="text-xs px-2.5 py-1.5 rounded bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-50"
                        disabled={addingChecklistItemId === it.id}
                        onClick={() => void addChecklistPoint(it.id)}
                      >
                        {addingChecklistItemId === it.id ? 'Mentés…' : 'Pont hozzáadása'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        <p className="text-[11px] text-gray-500 dark:text-gray-400">A szerkesztés továbbra is a Konzílium oldalon érhető el.</p>
      </section>
    </div>,
  );
}
