'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Users, X } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { OPInlinePreview } from '@/components/OPInlinePreview';
import { PresentationDentalMiniViewer } from '@/components/PresentationDentalMiniViewer';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import type { ChecklistEntry } from '@/lib/consilium';
import type { ItemMediaSummary, MediaPreviewItem, PatientPresentationSummary } from '@/lib/consilium-presentation';

function presentationDiagnosisText(ps: { bnoDescription?: string | null; diagnozis?: string | null }): string | null {
  const b = (ps.bnoDescription || '').trim();
  const d = (ps.diagnozis || '').trim();
  if (!b && !d) return null;
  if (b && d && b === d) return b;
  if (b && d) return `${b}\n\n${d}`;
  return b || d;
}

function huShortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  return new Date(iso).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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

  const items = payload?.items || [];
  const current = items[index] || null;

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
      for (const p of it.mediaSummary?.photoPreview?.previews || []) urls.add(p.previewUrl);
    }
    return Array.from(urls);
  }, [items, neighborIndexes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (lightboxUrl) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setLightboxUrl(null);
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
  }, [items.length, lightboxUrl]);

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
                <p className="text-sm md:text-base text-white/70 mt-1">
                  {ps.missingPatient ? 'Beteg nem elérhető / hiányzó rekord' : `ID: ${ps.patientId}`}
                  {typeof ps.age === 'number' ? ` · ${ps.age} éves` : ''}
                  {ps.birthYear ? ` · szül.: ${ps.birthYear}` : ''}
                </p>
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
                <div className="rounded-lg bg-black/30 border border-white/10 p-3 lg:p-4 overflow-y-auto max-h-[min(92vh,900px)]">
                  <p className="text-xs text-white/50 mb-2 lg:text-sm">Páciens adatai röviden</p>
                  <div className="space-y-2.5 text-sm md:text-base">
                    <div>
                      <p className="text-white/50 text-xs lg:text-sm">Beküldő orvos</p>
                      <p className="line-clamp-4 whitespace-pre-wrap break-words">{ps.beutaloOrvos || '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/50 text-xs lg:text-sm">Beutaló intézmény</p>
                      <p className="line-clamp-4 whitespace-pre-wrap break-words">{ps.beutaloIntezmeny || '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/50 text-xs lg:text-sm">Diagnózis</p>
                      <p className="whitespace-pre-wrap break-words">{presentationDiagnosisText(ps) || '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/50 text-xs lg:text-sm">TNM</p>
                      <p className="break-words">{ps.tnmStaging || '—'}</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/10">
                    <p className="text-white/50 text-xs lg:text-sm mb-2">Epizódok és stádiumok</p>
                    {ps.stage?.stageLabel || ps.stage?.stageCode ? (
                      <p className="text-xs text-emerald-200/90 mb-3 leading-snug">
                        Legutóbbi stádium:{' '}
                        <span className="font-medium text-white/95">
                          {ps.stage.stageLabel || ps.stage.stageCode}
                          {ps.stage.stageDate ? ` · ${huShortDateTime(ps.stage.stageDate)}` : ''}
                        </span>
                        {ps.stage.notes ? (
                          <span className="block text-white/75 mt-1 whitespace-pre-wrap font-normal">{ps.stage.notes}</span>
                        ) : null}
                      </p>
                    ) : null}

                    {!ps.careTimeline || ps.careTimeline.length === 0 ? (
                      <p className="text-xs text-white/45">Nincs epizód / stádium napló.</p>
                    ) : (
                      <div className="space-y-3">
                        {ps.careTimeline.map((ep) => (
                          <div
                            key={ep.id}
                            className="rounded-md border border-white/10 bg-black/25 p-2.5 space-y-1.5"
                          >
                            <p className="text-xs font-semibold text-white/95 leading-snug">
                              {[ep.reason, ep.status].filter(Boolean).join(' · ') || 'Epizód'}
                            </p>
                            {ep.caseTitle ? (
                              <p className="text-[11px] text-white/60 whitespace-pre-wrap break-words">{ep.caseTitle}</p>
                            ) : null}
                            {ep.chiefComplaint ? (
                              <p className="text-[11px] text-white/55 whitespace-pre-wrap break-words">{ep.chiefComplaint}</p>
                            ) : null}
                            {ep.openedAt || ep.closedAt ? (
                              <p className="text-[10px] text-white/40">
                                {[
                                  ep.openedAt ? `Nyitva: ${huShortDateTime(ep.openedAt)}` : null,
                                  ep.closedAt ? `Zárva: ${huShortDateTime(ep.closedAt)}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            ) : null}
                            {ep.episodeCreatedBy ? (
                              <p className="text-[10px] text-white/35">Epizódot rögzítette: {ep.episodeCreatedBy}</p>
                            ) : null}

                            <ul className="mt-2 pt-2 border-t border-white/10 space-y-2.5">
                              {ep.stages.length === 0 ? (
                                <li className="text-[11px] text-white/40">Nincs stádium esemény ebben az epizódban.</li>
                              ) : (
                                ep.stages.map((st) => (
                                  <li key={st.id} className="text-xs border-l-2 border-emerald-500/50 pl-2.5">
                                    <p className="text-white/90">
                                      <span className="text-white/45">{huShortDateTime(st.at)}</span>
                                      <span className="text-white/35"> · </span>
                                      <span className="font-medium">{st.stageLabel}</span>
                                      {st.source === 'patient_stages' ? (
                                        <span className="text-[10px] text-white/35 ml-1">(régi napló)</span>
                                      ) : null}
                                    </p>
                                    {st.note ? (
                                      <p className="text-[11px] text-white/70 whitespace-pre-wrap mt-1 leading-snug">
                                        {st.note}
                                      </p>
                                    ) : null}
                                    {st.authorDisplay ? (
                                      <p className="text-[10px] text-white/40 mt-1">Rögzítette: {st.authorDisplay}</p>
                                    ) : null}
                                  </li>
                                ))
                              )}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
                <div className="rounded-lg bg-black/30 border border-white/10 p-3 lg:p-4 flex-shrink-0">
                  <p className="text-xs lg:text-sm text-white/50 mb-2">Fotó mellékletek</p>
                  {ms.error && <p className="text-xs text-amber-300 mb-2">Média összegzés részben hibás</p>}
                  {(ms.photoPreview?.previews || []).length === 0 ? (
                    <p className="text-xs text-white/45">Nincs fotó előnézet.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {(ms.photoPreview?.previews || []).map((p: MediaPreviewItem) => (
                        <button
                          key={p.documentId}
                          type="button"
                          onClick={() => setLightboxUrl(p.previewUrl)}
                          className="rounded-md overflow-hidden border border-white/10 bg-black/40 text-left focus:outline-none focus:ring-2 focus:ring-white/40"
                        >
                          <img
                            src={p.previewUrl}
                            alt={p.filename || 'foto'}
                            className="w-full h-28 lg:h-36 object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-white/50 mt-2">
                    {ms.photoPreview?.imageCount ?? 0}/{ms.photoPreview?.totalCount ?? 0} kép
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

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Bezárás"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxUrl(null);
            }}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-[90vh] max-w-full w-auto object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
