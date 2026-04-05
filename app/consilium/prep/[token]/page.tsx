'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PatientDocumentAnnotation } from '@/lib/types/document-annotation';
import { fetchAnnotationsBatchForPatient } from '@/lib/document-annotations-batch-client';
import { DocumentAnnotationThumbnail } from '@/components/DocumentAnnotationThumbnail';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { OPInlinePreview } from '@/components/OPInlinePreview';
import { PresentationDentalMiniViewer } from '@/components/PresentationDentalMiniViewer';
import { DocumentAnnotationsOverlay } from '@/components/DocumentAnnotationsOverlay';
import { userCanAnnotatePatientDocuments } from '@/lib/patient-document-annotate';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import type { ChecklistEntry } from '@/lib/consilium';
import type {
  ItemMediaSummary,
  MediaPreviewItem,
  PatientPresentationSummary,
  PresentationTimelineEpisode,
  PresentationTimelineStage,
} from '@/lib/consilium-presentation';
import {
  type ConsiliumPrepCommentSnapshot,
  consiliumPresentationDiagnosisText,
  formatConsiliumHuDateTime,
  prepCommentsGroupedByKey,
} from '@/lib/consilium-view-helpers';

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

type PrepPayload = {
  session: {
    id: string;
    title: string;
    scheduledAt: string;
    status: 'draft' | 'active' | 'closed';
    attendees?: { id: string; name: string; present: boolean }[];
  };
  items: PresentationItem[];
  prepComments: ConsiliumPrepCommentSnapshot[];
  prepMeta: { sessionId: string; itemId: string; sessionStatus: string };
};

const EMPTY_PATIENT_SUMMARY: PatientPresentationSummary = {
  patientId: '',
  visible: false,
  missingPatient: true,
  name: null,
  taj: null,
  birthYear: null,
  age: null,
  addressDisplay: null,
  diagnozis: null,
  bnoDescription: null,
  beutaloOrvos: null,
  beutaloIntezmeny: null,
  tnmStaging: null,
  episodeLabel: null,
  stage: null,
  meglevoFogak: {},
  meglevoImplantatumok: {},
  nemIsmertPoziciokbanImplantatum: false,
  nemIsmertPoziciokbanImplantatumReszletek: null,
  careTimeline: [],
};

const EMPTY_MEDIA: ItemMediaSummary = {
  opPreview: { totalCount: 0, imageCount: 0, previews: [] },
  photoPreview: { totalCount: 0, imageCount: 0, previews: [] },
  error: null,
};

export default function ConsiliumPrepPage() {
  const params = useParams();
  const router = useRouter();
  const rawToken = typeof params.token === 'string' ? params.token : '';

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [payload, setPayload] = useState<PrepPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<{
    patientId: string;
    previews: MediaPreviewItem[];
    index: number;
  } | null>(null);
  const [photoAnnByDoc, setPhotoAnnByDoc] = useState<Record<string, PatientDocumentAnnotation[]>>({});
  const [newPointLabel, setNewPointLabel] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const apiTokenPath = useMemo(() => encodeURIComponent(rawToken), [rawToken]);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .finally(() => setLoadingUser(false));
  }, []);

  const load = useCallback(async () => {
    if (!rawToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/consilium/prep/${apiTokenPath}/presentation`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Betöltés sikertelen');
        setPayload(null);
        return;
      }
      setPayload(data as PrepPayload);
    } catch {
      setError('Hálózati hiba');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [apiTokenPath, rawToken]);

  useEffect(() => {
    if (!user || !rawToken) return;
    void load();
  }, [user, rawToken, load]);

  const current = payload?.items?.[0];
  const ps: PatientPresentationSummary = current?.patientSummary ?? EMPTY_PATIENT_SUMMARY;
  const ds = current?.discussionState ?? { discussed: false, checklist: [] as ChecklistEntry[] };
  const ms: ItemMediaSummary = current?.mediaSummary ?? EMPTY_MEDIA;
  const readonly = payload?.prepMeta?.sessionStatus === 'closed';
  const canAnnotatePatientDocs = userCanAnnotatePatientDocuments(user) && !readonly;

  const commentsByKey = useMemo(
    () => prepCommentsGroupedByKey(payload?.prepComments),
    [payload?.prepComments],
  );

  const photoDocIds = useMemo(() => {
    return (ms.photoPreview?.previews ?? []).map((p) => p.documentId).filter(Boolean);
  }, [ms.photoPreview?.previews]);

  useEffect(() => {
    const pid = ps.patientId;
    if (!pid || photoDocIds.length === 0) {
      setPhotoAnnByDoc({});
      return;
    }
    let cancelled = false;
    fetchAnnotationsBatchForPatient(pid, photoDocIds)
      .then((m) => {
        if (!cancelled) setPhotoAnnByDoc(m);
      })
      .catch(() => {
        if (!cancelled) setPhotoAnnByDoc({});
      });
    return () => {
      cancelled = true;
    };
  }, [ps.patientId, photoDocIds]);

  const refreshPhotoAnnotations = useCallback(() => {
    const pid = ps.patientId;
    if (!pid || photoDocIds.length === 0) return;
    void fetchAnnotationsBatchForPatient(pid, photoDocIds)
      .then(setPhotoAnnByDoc)
      .catch(() => setPhotoAnnByDoc({}));
  }, [ps.patientId, photoDocIds]);

  const timelineRows = useMemo(
    () => flattenCareTimelineNewestFirst(ps.careTimeline),
    [ps.careTimeline],
  );
  const episodesWithoutStages = useMemo(
    () => (ps.careTimeline ?? []).filter((ep: PresentationTimelineEpisode) => ep.stages.length === 0),
    [ps.careTimeline],
  );

  const addChecklistPoint = async () => {
    const label = newPointLabel.trim();
    if (!label || readonly) return;
    try {
      const res = await fetch(`/api/consilium/prep/${apiTokenPath}/checklist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error('fail');
      setNewPointLabel('');
      await load();
    } catch {
      setError('Új napirendi pont mentése sikertelen');
    }
  };

  const postComment = async (checklistKey: string) => {
    const body = (commentDrafts[checklistKey] || '').trim();
    if (!body || readonly) return;
    setSubmittingKey(checklistKey);
    try {
      const res = await fetch(`/api/consilium/prep/${apiTokenPath}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklistKey, body }),
      });
      if (!res.ok) throw new Error('fail');
      setCommentDrafts((d) => ({ ...d, [checklistKey]: '' }));
      await load();
    } catch {
      setError('Hozzászólás mentése sikertelen');
    } finally {
      setSubmittingKey(null);
    }
  };

  const presentMaxW = 'max-w-[min(1920px,calc(100vw-1.5rem))]';

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Betöltés...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm">Előkészítő nézethez bejelentkezés szükséges.</p>
        <button type="button" className="text-sm underline" onClick={() => router.push('/login')}>
          Bejelentkezés
        </button>
        <p className="text-xs text-white/50 max-w-sm">Bejelentkezés után nyisd meg újra ezt az előkészítő linket.</p>
      </div>
    );
  }

  if (!rawToken) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <p className="text-sm">Hiányzó link.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Előkészítő adatok betöltése...
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm">{error}</p>
        <button type="button" className="text-sm underline" onClick={() => void load()}>
          Újrapróbálás
        </button>
        <Link href="/consilium" className="text-sm underline">
          Konzílium
        </Link>
      </div>
    );
  }

  if (!payload || !current) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <p className="text-sm">Nincs megjeleníthető adat.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {error && (
        <div className="bg-amber-900/40 text-amber-100 text-sm px-4 py-2 text-center">{error}</div>
      )}

      <div className="border-b border-white/10 bg-black/40 backdrop-blur sticky top-0 z-20">
        <div className={`${presentMaxW} w-full mx-auto px-3 sm:px-5 lg:px-8 py-2 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-3 min-w-0">
            <Logo width={34} height={39} />
            <div className="min-w-0">
              <p className="text-xs text-white/60 truncate">{payload.session.title}</p>
              <p className="text-sm font-semibold truncate flex flex-wrap items-center gap-2">
                <span>Konzílium előkészítő · {new Date(payload.session.scheduledAt).toLocaleString('hu-HU')}</span>
                <span className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-cyan-500/20 text-cyan-100 border border-cyan-400/35">
                  Linkes előkészítő
                </span>
              </p>
              <p className="text-xs text-white/45 mt-0.5">
                {readonly ? 'Lezárt alkalom — csak olvasható.' : 'Előkészítő megjegyzések; a verdikt az élő megbeszélésen rögzül.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/consilium" className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 inline-flex items-center gap-2">
              <ArrowLeft className="w-3.5 h-3.5" />
              Konzílium
            </Link>
            <button type="button" className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15" onClick={() => void load()}>
              Frissítés
            </button>
          </div>
        </div>
      </div>

      {photoLightbox && photoLightbox.previews.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal
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
          <div
            className="max-w-[min(100vw-2rem,1600px)] flex flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-white/70">
              {photoLightbox.index + 1} / {photoLightbox.previews.length}
              {photoLightbox.previews[photoLightbox.index]?.filename
                ? ` · ${photoLightbox.previews[photoLightbox.index].filename}`
                : ''}
            </p>
            {photoLightbox.patientId &&
            photoLightbox.previews[photoLightbox.index]?.documentId &&
            photoLightbox.previews[photoLightbox.index]?.previewUrl ? (
              <DocumentAnnotationsOverlay
                patientId={photoLightbox.patientId}
                documentId={photoLightbox.previews[photoLightbox.index].documentId}
                imageUrl={photoLightbox.previews[photoLightbox.index].previewUrl}
                mode={canAnnotatePatientDocs ? 'edit' : 'view'}
                canEdit={canAnnotatePatientDocs}
                compact
                imgClassName="max-h-[min(85vh,900px)] max-w-full w-auto object-contain block"
              />
            ) : (
              <img
                src={photoLightbox.previews[photoLightbox.index]?.previewUrl}
                alt=""
                className="max-h-[min(85vh,900px)] max-w-full object-contain"
              />
            )}
          </div>
        </div>
      )}

      <main className={`${presentMaxW} w-full mx-auto px-3 sm:px-5 lg:px-8 py-4 lg:py-6`}>
        <div className="w-full rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-black/40 overflow-x-hidden">
          <div className="flex flex-col">
            <div className="px-4 sm:px-6 lg:px-8 py-3 lg:py-4 border-b border-white/10">
              <p className="text-2xl md:text-3xl font-bold leading-tight truncate">{ps.name || 'Ismeretlen beteg'}</p>
              {!ps.missingPatient && (
                <p className="text-sm text-white/80 mt-2 leading-snug">
                  {[
                    `TAJ ${ps.taj?.trim() || '—'}`,
                    typeof ps.age === 'number'
                      ? `${ps.age} éves${ps.birthYear ? ` (szül.: ${ps.birthYear})` : ''}`
                      : ps.birthYear
                        ? `szül.: ${ps.birthYear}`
                        : null,
                    ps.addressDisplay?.trim() || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-12 gap-4 lg:gap-5 px-4 sm:px-6 lg:px-8 py-3 lg:py-4 pb-6">
              <div className="col-span-12 lg:col-span-3">
                <div className="rounded-lg bg-black/30 border border-white/10 p-3 lg:p-4 space-y-5 max-h-[min(92vh,900px)] overflow-y-auto">
                  <section>
                    <h2 className="text-xs font-semibold text-white/70 mb-2">Páciens</h2>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs text-white/50">Beküldő orvos</p>
                        <p className="whitespace-pre-wrap break-words">{ps.beutaloOrvos || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50">Beutaló intézmény</p>
                        <p className="whitespace-pre-wrap break-words">{ps.beutaloIntezmeny || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50">Diagnózis</p>
                        <p className="whitespace-pre-wrap break-words">{consiliumPresentationDiagnosisText(ps) || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50">TNM</p>
                        <p>{ps.tnmStaging || '—'}</p>
                      </div>
                    </div>
                  </section>

                  <section className="border-t border-white/15 pt-4">
                    <h2 className="text-sm font-semibold text-white mb-2">Stádium napló</h2>
                    {timelineRows.length > 0 ? (
                      <div className="space-y-4">
                        {timelineRows.map((row, i) => {
                          const prev = i > 0 ? timelineRows[i - 1] : null;
                          const showEp = !prev || prev.epLabel !== row.epLabel;
                          return (
                            <div key={row.st.id}>
                              {showEp ? (
                                <p className="text-sm font-semibold text-amber-200/90 mb-2 pb-1 border-b border-white/20">{row.epLabel}</p>
                              ) : null}
                              <p className="text-base font-semibold">{row.st.stageLabel}</p>
                              <p className="text-sm text-white/65">
                                {formatConsiliumHuDateTime(row.st.at)}
                                {row.st.authorDisplay ? ` · ${row.st.authorDisplay}` : ''}
                              </p>
                              {row.st.note ? <p className="text-sm text-white/85 whitespace-pre-wrap mt-1">{row.st.note}</p> : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {episodesWithoutStages.length > 0 && (
                      <div className={`space-y-2 ${timelineRows.length > 0 ? 'mt-4 pt-3 border-t border-white/15' : ''}`}>
                        {episodesWithoutStages.map((ep: PresentationTimelineEpisode) => (
                          <p key={ep.id} className="text-sm text-white/60">
                            <span className="font-medium text-white/80">
                              {[ep.reason, ep.status].filter(Boolean).join(' · ') || 'Epizód'}
                            </span>
                            {' — '}nincs stádium bejegyzés
                          </p>
                        ))}
                      </div>
                    )}
                    {timelineRows.length === 0 && episodesWithoutStages.length === 0 && (
                      <p className="text-sm text-white/50">Nincs stádium vagy epizód adat.</p>
                    )}
                  </section>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-6 flex flex-col gap-3 min-w-0">
                <div className="rounded-lg bg-black/20 border border-white/10 p-2">
                  <p className="text-[10px] text-white/45 uppercase px-1 mb-1">OP</p>
                  {ps.patientId && !ps.missingPatient ? (
                    <OPInlinePreview
                      variant="presentation"
                      patientId={ps.patientId}
                      patientName={ps.name || undefined}
                      canAnnotate={canAnnotatePatientDocs}
                    />
                  ) : (
                    <p className="text-xs text-white/50 px-2 py-4">Nincs betegazonosító.</p>
                  )}
                </div>
                {ps.patientId && !ps.missingPatient ? (
                  <div className="min-w-0 overflow-x-auto">
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

              <div className="col-span-12 lg:col-span-3 flex flex-col gap-3 min-w-0">
                <div className="rounded-lg bg-black/30 border border-white/10 p-3">
                  <p className="text-xs text-white/50 mb-2">Fotó mellékletek</p>
                  {ms.error && <p className="text-xs text-amber-300 mb-2">Média összegzés részben hibás</p>}
                  {(ms.photoPreview?.previews || []).length === 0 ? (
                    <p className="text-xs text-white/45">Nincs fotó előnézet.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-[min(55vh,520px)] overflow-y-auto">
                      {(ms.photoPreview?.previews || []).map((p: MediaPreviewItem, pi: number) => (
                        <button
                          key={p.documentId}
                          type="button"
                          onClick={() =>
                            setPhotoLightbox({
                              patientId: ps.patientId || '',
                              previews: ms.photoPreview?.previews ?? [],
                              index: pi,
                            })
                          }
                          className="rounded-md overflow-hidden border border-white/10 bg-black/40"
                        >
                          <img src={p.previewUrl} alt="" className="w-full h-24 object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-cyan-500/40 bg-gradient-to-b from-cyan-950/55 via-cyan-950/25 to-black/40 p-3 space-y-3 ring-1 ring-cyan-400/10">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200/90">Napirend — előkészítő</p>
                  <p className="text-[11px] text-cyan-100/45">
                    A „Konzílium verdikt” mezőt az élő ülésen rögzítjük; itt többszörös hozzászólások gyűlnek össze.
                  </p>

                  {!readonly && (
                    <div className="flex flex-col gap-2">
                      <input
                        className="w-full rounded-md bg-black/40 border border-cyan-500/35 px-2 py-1.5 text-sm text-cyan-50 placeholder:text-cyan-200/30"
                        placeholder="Új napirendi kérdés / pont"
                        value={newPointLabel}
                        onChange={(e) => setNewPointLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void addChecklistPoint();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded-md bg-cyan-600/80 hover:bg-cyan-600 text-white w-fit"
                        onClick={() => void addChecklistPoint()}
                      >
                        Új pont felvétele
                      </button>
                    </div>
                  )}

                  <div className="space-y-4 pt-2 border-t border-cyan-500/25">
                    {(ds.checklist || []).length === 0 && <p className="text-xs text-cyan-100/50">Még nincs napirendi pont.</p>}
                    {(ds.checklist || []).map((c: ChecklistEntry) => (
                      <div key={c.key} className="border-b border-cyan-500/20 pb-3 last:border-0 space-y-2">
                        <p className="text-sm font-medium text-cyan-50/95">{c.label}</p>
                        {c.response?.trim() ? (
                          <div className="text-xs text-amber-100/70 bg-amber-950/35 border border-amber-500/25 rounded p-2">
                            <span className="text-amber-200/50">Rögzített verdikt (élő ülés): </span>
                            <span className="text-amber-50/90 whitespace-pre-wrap">{c.response}</span>
                          </div>
                        ) : null}
                        <div className="space-y-1.5 pl-0">
                          {(commentsByKey.get(c.key) || []).map((cm) => (
                            <div
                              key={cm.id}
                              className="text-xs text-cyan-50/90 bg-black/35 rounded px-2 py-1.5 border border-cyan-500/15"
                            >
                              <span className="text-cyan-200/50">{formatConsiliumHuDateTime(cm.createdAt)} · {cm.authorDisplay}</span>
                              <p className="whitespace-pre-wrap mt-0.5">{cm.body}</p>
                            </div>
                          ))}
                        </div>
                        {!readonly && (
                          <div className="space-y-1">
                            <textarea
                              className="w-full rounded-md bg-black/40 border border-cyan-500/30 px-2 py-1.5 text-sm text-cyan-50 placeholder:text-cyan-200/30 min-h-[4rem]"
                              placeholder="Hozzászólás…"
                              value={commentDrafts[c.key] || ''}
                              onChange={(e) => setCommentDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
                            />
                            <button
                              type="button"
                              disabled={submittingKey === c.key}
                              className="text-xs px-3 py-1 rounded-md bg-cyan-600/85 hover:bg-cyan-600 text-white disabled:opacity-50"
                              onClick={() => void postComment(c.key)}
                            >
                              {submittingKey === c.key ? 'Küldés…' : 'Hozzászólás küldése'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
