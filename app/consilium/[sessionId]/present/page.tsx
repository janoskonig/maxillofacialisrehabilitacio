'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Users, X } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { OPInlinePreview } from '@/components/OPInlinePreview';
import { PresentationDentalMiniViewer } from '@/components/PresentationDentalMiniViewer';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import type { ChecklistEntry } from '@/lib/consilium';
import type {
  ItemMediaSummary,
  MediaPreviewItem,
  PatientPresentationSummary,
  PresentationTimelineEpisode,
  PresentationTimelineStage,
} from '@/lib/consilium-presentation';

function presentationDiagnosisText(ps: { bnoDescription?: string | null; diagnozis?: string | null }): string | null {
  const b = (ps.bnoDescription || '').trim();
  const d = (ps.diagnozis || '').trim();
  if (!b && !d) return null;
  if (b && d && b === d) return b;
  if (b && d) return `${b}\n\n${d}`;
  return b || d;
}

/** Vetítéshez: kompakt, de olvasható dátum + idő */
function huPresentDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  return new Date(iso).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
}

/** Összes stádium egy listában, legújabb felül (egyszerű timeline). */
function flattenCareTimelineNewestFirst(
  care: PresentationTimelineEpisode[] | undefined,
): { st: PresentationTimelineStage; epLabel: string }[] {
  if (!care?.length) return [];
  const rows: { st: PresentationTimelineStage; epLabel: string }[] = [];
  for (const ep of care) {
    const epLabel = [ep.reason, ep.status].filter(Boolean).join(' · ') || 'Epizód';
    for (const st of ep.stages) rows.push({ st, epLabel });
  }
  rows.sort((a, b) => new Date(b.st.at).getTime() - new Date(a.st.at).getTime());
  return rows;
}

type PresentationItem = {
  id: string;
  sortOrder: number;
  patientId: string;
  patientSummary: PatientPresentationSummary;
  mediaSummary: ItemMediaSummary;
  discussionState: { discussed: boolean; checklist: ChecklistEntry[] };
};

type PresentationPayload = {
  session: {
    id: string;
    title: string;
    scheduledAt: string;
    status: 'draft' | 'active' | 'closed';
    attendees?: { id: string; name: string; present: boolean }[];
  };
  items: PresentationItem[];
};

type PatchItemBody = { operation: 'update_discussed'; discussed: boolean };

type ChecklistRowPresent = {
  key: string;
  label: string;
  response?: string | null;
  respondedAt?: string | null;
  respondedBy?: string | null;
};

function PresentChecklistVerdictField({
  sessionId,
  itemId,
  entry,
  readonly,
  onChecklistReplaced,
}: {
  sessionId: string;
  itemId: string;
  entry: ChecklistRowPresent;
  readonly: boolean;
  onChecklistReplaced: (checklist: ChecklistEntry[]) => void;
}) {
  const [text, setText] = useState(entry.response ?? '');

  useEffect(() => {
    setText(entry.response ?? '');
  }, [entry.key, entry.response]);

  const meta =
    (entry.respondedBy || entry.respondedAt) && (
      <p className="text-[10px] text-white/35 mt-1">
        {[entry.respondedBy, entry.respondedAt ? new Date(entry.respondedAt).toLocaleString('hu-HU') : '']
          .filter(Boolean)
          .join(' · ')}
      </p>
    );

  const save = async () => {
    const next = text;
    const prev = entry.response ?? '';
    if (next.trim() === prev.trim()) return;
    try {
      const res = await fetch(
        `/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(entry.key)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: next }),
        },
      );
      if (!res.ok) throw new Error('response_failed');
      const data = await res.json();
      const checklist = data.item?.checklist;
      if (Array.isArray(checklist)) onChecklistReplaced(checklist);
    } catch {
      setText(prev);
    }
  };

  if (readonly) {
    return (
      <div className="mt-1.5">
        {entry.response ? (
          <p className="text-xs text-white/70 whitespace-pre-wrap">{entry.response}</p>
        ) : (
          <p className="text-[11px] text-white/35">Nincs rögzített verdikt</p>
        )}
        {meta}
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <label className="text-[10px] text-white/45 uppercase tracking-wide">Verdikt</label>
      <textarea
        className="mt-0.5 w-full min-h-[72px] rounded-md border border-white/20 bg-black/50 text-sm text-white/90 placeholder:text-white/30 p-2 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20"
        placeholder="Megállapodás, döntés, teendő…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        autoComplete="off"
      />
      {meta}
    </div>
  );
}

export default function ConsiliumPresentPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [payload, setPayload] = useState<PresentationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const [photoLightbox, setPhotoLightbox] = useState<{ previews: MediaPreviewItem[]; index: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/consilium/sessions/${sessionId}/presentation`, { credentials: 'include' });
      if (!res.ok) throw new Error('load_failed');
      const data = (await res.json()) as PresentationPayload;
      setPayload(data);
      setIndex(0);
      indexRef.current = 0;
    } catch {
      setError('Nem sikerült betölteni a vetítés adatokat');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        if (!u) router.replace('/login');
      })
      .catch(() => router.replace('/login'))
      .finally(() => setLoadingUser(false));
  }, [router]);

  useEffect(() => {
    if (!user || user.role === 'technikus') return;
    load();
  }, [user, load]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    setPhotoLightbox(null);
  }, [index]);

  const items = payload?.items || [];
  const current = items[index] || null;
  const summaryForTimeline = current?.patientSummary;

  const timelineRows = useMemo(
    () => flattenCareTimelineNewestFirst(summaryForTimeline?.careTimeline),
    [summaryForTimeline?.careTimeline],
  );
  const episodesWithoutStages = useMemo(
    () => (summaryForTimeline?.careTimeline ?? []).filter((ep) => ep.stages.length === 0),
    [summaryForTimeline?.careTimeline],
  );

  const neighborIndexes = useMemo(() => {
    const out: number[] = [];
    for (let d = -2; d <= 2; d++) {
      const i = index + d;
      if (i >= 0 && i < items.length) out.push(i);
    }
    return out;
  }, [index, items.length]);

  const prefetchUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const i of neighborIndexes) {
      const it = items[i];
      if (!it) continue;
      for (const p of it.mediaSummary?.opPreview?.previews || []) urls.add(p.previewUrl);
      for (const p of (it.mediaSummary?.photoPreview?.previews || []).slice(0, 24)) urls.add(p.previewUrl);
    }
    return Array.from(urls);
  }, [items, neighborIndexes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (photoLightbox) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPhotoLightbox(null);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setPhotoLightbox((lb) => {
            if (!lb || lb.previews.length === 0) return null;
            return { ...lb, index: Math.max(0, lb.index - 1) };
          });
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPhotoLightbox((lb) => {
            if (!lb || lb.previews.length === 0) return null;
            return { ...lb, index: Math.min(lb.previews.length - 1, lb.index + 1) };
          });
          return;
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((i) => Math.min(items.length - 1, i + 1));
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items.length, photoLightbox]);

  const readonly = payload?.session.status === 'closed';

  const patchItem = async (itemId: string, body: PatchItemBody) => {
    const res = await fetch(`/api/consilium/sessions/${sessionId}/items/${itemId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('patch_failed');
  };

  const toggleChecklist = async (itemId: string, key: string, checked: boolean) => {
    const res = await fetch(
      `/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(key)}`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      },
    );
    if (!res.ok) throw new Error('toggle_failed');
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Betöltés...
      </div>
    );
  }

  if (!user || user.role === 'technikus') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6 text-center space-y-3">
        <div>
          <Users className="w-10 h-10 mx-auto mb-2 opacity-80" />
          <p className="text-sm">Ehhez a szerepkörhöz a vetítés nem elérhető.</p>
          <Link href="/consilium" className="inline-block mt-3 text-sm underline">
            Vissza
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Vetítés betöltése...
      </div>
    );
  }

  if (error || !payload || !current) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm">{error || 'Nincs megjeleníthető elem'}</p>
        <button type="button" className="text-sm underline" onClick={load}>
          Újrapróbálás
        </button>
        <Link href="/consilium" className="text-sm underline">
          Vissza az alkalomhoz
        </Link>
      </div>
    );
  }

  const ps = current.patientSummary || {};
  const ds = current.discussionState || {};
  const ms = current.mediaSummary || {};
  const sessionAttendees = payload.session.attendees || [];
  const presentAttendeeNames = sessionAttendees.filter((a) => a.present).map((a) => a.name);

  const presentMaxW = 'max-w-[min(1920px,calc(100vw-1.5rem))]';

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="border-b border-white/10 bg-black/40 backdrop-blur sticky top-0 z-20">
        <div className={`${presentMaxW} w-full mx-auto px-3 sm:px-5 lg:px-8 py-2 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-3 min-w-0">
            <Logo width={34} height={39} />
            <div className="min-w-0">
              <p className="text-xs text-white/60 truncate">{payload.session.title}</p>
              <p className="text-sm font-semibold truncate">
                Konzílium vetítés · {new Date(payload.session.scheduledAt).toLocaleString('hu-HU')}
              </p>
              <p className="text-xs text-white/45 mt-0.5 line-clamp-2">
                Jelen vannak:{' '}
                {presentAttendeeNames.length > 0 ? presentAttendeeNames.join(', ') : 'még nincs jelölve (szerkesztés a Konzílium oldalon)'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href={`/consilium`} className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 inline-flex items-center gap-2">
              <ArrowLeft className="w-3.5 h-3.5" />
              Szerkesztés
            </Link>
            <button type="button" className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15" onClick={load}>
              Frissítés
            </button>
          </div>
        </div>
      </div>

      {/* hidden prefetch */}
      <div className="hidden" aria-hidden>
        {prefetchUrls.map((u) => (
          <img key={u} src={u} alt="" />
        ))}
      </div>

      <main className={`${presentMaxW} w-full mx-auto px-3 sm:px-5 lg:px-8 py-4 lg:py-6`}>
        <div className="w-full rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-black/40 overflow-x-hidden">
          <div className="flex flex-col">
            <div className="px-4 sm:px-6 lg:px-8 py-3 lg:py-4 border-b border-white/10 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-2xl md:text-3xl lg:text-4xl font-bold leading-tight truncate">{ps.name || 'Ismeretlen beteg'}</p>
                {ps.missingPatient ? (
                  <p className="text-sm md:text-base text-white/70 mt-2">Beteg nem elérhető / hiányzó rekord</p>
                ) : (
                  <div className="text-sm md:text-base text-white/75 mt-2 space-y-1">
                    <p>
                      <span className="text-white/50">TAJ:</span> {ps.taj?.trim() || '—'}
                    </p>
                    <p>
                      {typeof ps.age === 'number' ? `${ps.age} éves` : 'Életkor: —'}
                      {ps.birthYear ? <span className="text-white/55"> · szül.: {ps.birthYear}</span> : null}
                    </p>
                    <p className="text-white/85 whitespace-pre-wrap break-words leading-snug">
                      <span className="text-white/50">Lakcím:</span> {ps.addressDisplay?.trim() || '—'}
                    </p>
                    <p className="text-xs text-white/40 pt-0.5">ID: {ps.patientId}</p>
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm md:text-base text-white/70">
                  {index + 1} / {items.length}
                </p>
                <p className="text-xs text-white/50 mt-1">← → léptetés</p>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-4 lg:gap-5 px-4 sm:px-6 lg:px-8 py-3 lg:py-4 pb-6">
              <div className="col-span-12 lg:col-span-3">
                <div className="rounded-lg bg-black/30 border border-white/10 p-3 lg:p-4 overflow-y-auto max-h-[min(92vh,900px)] space-y-5">
                  <section>
                    <h2 className="text-xs sm:text-sm font-semibold text-white/70 mb-2">Páciens</h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-white/50 mb-0.5">Beküldő orvos</p>
                        <p className="text-sm md:text-base whitespace-pre-wrap break-words leading-snug">
                          {ps.beutaloOrvos || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50 mb-0.5">Beutaló intézmény</p>
                        <p className="text-sm md:text-base whitespace-pre-wrap break-words leading-snug">
                          {ps.beutaloIntezmeny || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50 mb-0.5">Diagnózis</p>
                        <p className="text-sm md:text-base whitespace-pre-wrap break-words leading-snug">
                          {presentationDiagnosisText(ps) || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50 mb-0.5">TNM</p>
                        <p className="text-sm md:text-base break-words">{ps.tnmStaging || '—'}</p>
                      </div>
                    </div>
                  </section>

                  <section className="border-t border-white/15 pt-4">
                    <h2 className="text-sm md:text-base font-semibold text-white mb-0.5">Stádium napló</h2>
                    <p className="text-xs text-white/45 mb-3">Legfelül a legutóbbi bejegyzés</p>

                    {timelineRows.length > 0 ? (
                      <div className="space-y-4">
                        {timelineRows.map((row, i) => {
                          const prev = i > 0 ? timelineRows[i - 1] : null;
                          const showEp = !prev || prev.epLabel !== row.epLabel;
                          return (
                            <div key={row.st.id}>
                              {showEp ? (
                                <p className="text-sm font-semibold text-amber-200/90 mb-2 pb-1.5 border-b border-white/20">
                                  {row.epLabel}
                                </p>
                              ) : null}
                              <div className="space-y-1">
                                <p className="text-base md:text-lg font-semibold text-white leading-snug">
                                  {row.st.stageLabel}
                                </p>
                                <p className="text-sm text-white/65">
                                  {huPresentDateTime(row.st.at)}
                                  {row.st.authorDisplay ? (
                                    <>
                                      <span className="text-white/35"> · </span>
                                      {row.st.authorDisplay}
                                    </>
                                  ) : null}
                                </p>
                                {row.st.note ? (
                                  <p className="text-sm md:text-base text-white/85 whitespace-pre-wrap leading-snug">
                                    {row.st.note}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {episodesWithoutStages.length > 0 ? (
                      <div className={`space-y-2 ${timelineRows.length > 0 ? 'mt-4 pt-3 border-t border-white/15' : ''}`}>
                        {episodesWithoutStages.map((ep) => (
                          <p key={ep.id} className="text-sm md:text-base text-white/60 leading-snug">
                            <span className="font-medium text-white/80">
                              {[ep.reason, ep.status].filter(Boolean).join(' · ') || 'Epizód'}
                            </span>
                            {' — '}nincs stádium bejegyzés
                          </p>
                        ))}
                      </div>
                    ) : null}

                    {timelineRows.length === 0 &&
                    episodesWithoutStages.length === 0 &&
                    (ps.stage?.stageLabel || ps.stage?.stageCode) ? (
                      <div className="space-y-1">
                        <p className="text-base md:text-lg font-semibold text-white">
                          {ps.stage.stageLabel || ps.stage.stageCode}
                        </p>
                        <p className="text-sm text-white/65">{huPresentDateTime(ps.stage.stageDate)}</p>
                        {ps.stage.notes ? (
                          <p className="text-sm md:text-base text-white/85 whitespace-pre-wrap">{ps.stage.notes}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {timelineRows.length === 0 &&
                    episodesWithoutStages.length === 0 &&
                    !(ps.stage?.stageLabel || ps.stage?.stageCode) ? (
                      <p className="text-sm text-white/50">Nincs stádium vagy epizód adat.</p>
                    ) : null}
                  </section>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-6 flex flex-col gap-3 lg:gap-4 min-w-0">
                <div className="rounded-lg bg-black/20 border border-white/10 p-2 shrink-0">
                  <p className="text-[10px] text-white/45 uppercase tracking-wide px-1 mb-1">OP — központi nézet</p>
                  {ps.patientId && !ps.missingPatient ? (
                    <OPInlinePreview
                      variant="presentation"
                      patientId={ps.patientId}
                      patientName={ps.name || undefined}
                    />
                  ) : (
                    <p className="text-xs text-white/50 px-2 py-4">Nincs betegazonosító az OP megjelenítéséhez.</p>
                  )}
                </div>
                {ps.patientId && !ps.missingPatient ? (
                  <div className="min-w-0 overflow-x-auto overflow-y-visible">
                    <PresentationDentalMiniViewer
                      patientId={ps.patientId}
                      meglevoFogak={(ps.meglevoFogak || {}) as Record<string, ToothStatus>}
                      meglevoImplantatumok={(ps.meglevoImplantatumok || {}) as Record<string, string>}
                      nemIsmertPoziciokbanImplantatum={ps.nemIsmertPoziciokbanImplantatum}
                      nemIsmertPoziciokbanImplantatumReszletek={ps.nemIsmertPoziciokbanImplantatumReszletek}
                    />
                  </div>
                ) : null}
              </div>

              <div className="col-span-12 lg:col-span-3 flex flex-col gap-3 lg:gap-4 min-w-0">
                <div className="rounded-lg bg-black/30 border border-white/10 p-3 lg:p-4 flex-shrink-0 flex flex-col min-h-0">
                  <p className="text-xs lg:text-sm text-white/50 mb-2">Fotó mellékletek</p>
                  {ms.error && <p className="text-xs text-amber-300 mb-2">Média összegzés részben hibás</p>}
                  {(ms.photoPreview?.previews || []).length === 0 ? (
                    <p className="text-xs text-white/45">Nincs fotó előnézet.</p>
                  ) : (
                    <div className="max-h-[min(55vh,520px)] overflow-y-auto overscroll-contain pr-1 -mr-0.5">
                      <div className="grid grid-cols-2 gap-2">
                        {(ms.photoPreview?.previews || []).map((p: MediaPreviewItem, pi: number) => (
                          <button
                            key={p.documentId}
                            type="button"
                            onClick={() =>
                              setPhotoLightbox({ previews: ms.photoPreview?.previews ?? [], index: pi })
                            }
                            className="rounded-md overflow-hidden border border-white/10 bg-black/40 text-left focus:outline-none focus:ring-2 focus:ring-white/40 shrink-0"
                          >
                            <img
                              src={p.previewUrl}
                              alt={p.filename || 'foto'}
                              className="w-full h-24 lg:h-28 object-cover"
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-white/50 mt-2 shrink-0">
                    {(ms.photoPreview?.previews || []).length > 0
                      ? (ms.photoPreview?.imageCount ?? 0) < (ms.photoPreview?.totalCount ?? 0)
                        ? `${ms.photoPreview?.imageCount ?? 0} / ${ms.photoPreview?.totalCount ?? 0} kép (többi nem töltődik be a vetítésre)`
                        : `${ms.photoPreview?.totalCount ?? ms.photoPreview?.imageCount ?? 0} kép · nagyítás: katt, ← →`
                      : `${ms.photoPreview?.totalCount ?? 0} kép`}
                  </p>
                </div>

                <div className="min-h-[12rem] rounded-lg bg-black/30 border border-white/10 p-3 lg:p-4">
                  <p className="text-xs lg:text-sm text-white/50 mb-2">Konzílium állapot</p>
                  <div className="space-y-2">
                    <div>
                      <label className="flex items-center gap-2 text-sm text-white/90">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-white/30"
                          checked={!!ds.discussed}
                          disabled={readonly}
                          onChange={async (e) => {
                            const discussed = e.target.checked;
                            const prev = payload;
                            setPayload((p) => {
                              if (!p) return p;
                              const nextItems = p.items.map((it) =>
                                it.id === current.id ? { ...it, discussionState: { ...it.discussionState, discussed } } : it,
                              );
                              return { ...p, items: nextItems };
                            });
                            try {
                              await patchItem(current.id, { operation: 'update_discussed', discussed });
                            } catch {
                              setPayload(prev);
                            }
                          }}
                        />
                        Megbeszélve
                      </label>
                    </div>

                    <div>
                      <p className="text-xs text-white/50 mb-1">Napirendi pontok</p>
                      <p className="text-[11px] text-white/40 mb-2">
                        Pipálás és verdikt (válasz) — vázlat és aktív alkalom alatt itt is szerkeszthető; lezárt alkalomnál csak
                        olvasható.
                      </p>
                      <div className="space-y-3">
                        {(ds.checklist || []).length === 0 && <p className="text-xs text-white/60">Üres</p>}
                        {(ds.checklist || []).map((c: ChecklistEntry) => (
                          <div key={c.key} className="border-b border-white/10 pb-2 last:border-0 last:pb-0">
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={!!c.checked}
                                disabled={readonly}
                                onChange={async (e) => {
                                  const checked = e.target.checked;
                                  const snapshot = payload;
                                  setPayload((p) => {
                                    if (!p) return p;
                                    const nextItems = p.items.map((it) => {
                                      if (it.id !== current.id) return it;
                                      const nextChecklist = (it.discussionState.checklist || []).map((cc: ChecklistEntry) =>
                                        cc.key === c.key
                                          ? {
                                              ...cc,
                                              checked,
                                              checkedAt: checked ? new Date().toISOString() : null,
                                              checkedBy: checked ? user.email : null,
                                            }
                                          : cc,
                                      );
                                      return { ...it, discussionState: { ...it.discussionState, checklist: nextChecklist } };
                                    });
                                    return { ...p, items: nextItems };
                                  });
                                  try {
                                    await toggleChecklist(current.id, c.key, checked);
                                  } catch {
                                    setPayload(snapshot);
                                  }
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <span className="text-white/90">{c.label}</span>
                                <PresentChecklistVerdictField
                                  sessionId={sessionId}
                                  itemId={current.id}
                                  entry={c}
                                  readonly={readonly}
                                  onChecklistReplaced={(checklist) => {
                                    setPayload((p) => {
                                      if (!p) return p;
                                      return {
                                        ...p,
                                        items: p.items.map((it) =>
                                          it.id === current.id
                                            ? { ...it, discussionState: { ...it.discussionState, checklist } }
                                            : it,
                                        ),
                                      };
                                    });
                                  }}
                                />
                              </div>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-white/40 mt-3">
          Live read-model: a vetítés adatok a backend aggregátorból jönnek; a betegadat változása frissítésre / újratöltésre látszik.
        </p>
      </main>

      {photoLightbox && photoLightbox.previews.length > 0 && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPhotoLightbox(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white z-[110]"
            aria-label="Bezárás"
            onClick={(e) => {
              e.stopPropagation();
              setPhotoLightbox(null);
            }}
          >
            <X className="w-6 h-6" />
          </button>
          {photoLightbox.previews.length > 1 && (
            <>
              <button
                type="button"
                className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-[110] disabled:opacity-30"
                aria-label="Előző kép"
                disabled={photoLightbox.index <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  setPhotoLightbox((lb) =>
                    lb && lb.index > 0 ? { ...lb, index: lb.index - 1 } : lb,
                  );
                }}
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <button
                type="button"
                className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-[110] disabled:opacity-30"
                aria-label="Következő kép"
                disabled={photoLightbox.index >= photoLightbox.previews.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  setPhotoLightbox((lb) =>
                    lb && lb.index < lb.previews.length - 1 ? { ...lb, index: lb.index + 1 } : lb,
                  );
                }}
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </>
          )}
          <div className="max-w-[min(100vw-2rem,1600px)] flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-white/70">
              {photoLightbox.index + 1} / {photoLightbox.previews.length}
              {photoLightbox.previews[photoLightbox.index]?.filename
                ? ` · ${photoLightbox.previews[photoLightbox.index].filename}`
                : ''}
            </p>
            <img
              src={photoLightbox.previews[photoLightbox.index]?.previewUrl}
              alt={photoLightbox.previews[photoLightbox.index]?.filename || ''}
              className="max-h-[min(85vh,900px)] max-w-full w-auto object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
