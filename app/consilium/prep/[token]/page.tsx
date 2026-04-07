'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { OPInlinePreview } from '@/components/OPInlinePreview';
import { PresentationDentalMiniViewer } from '@/components/PresentationDentalMiniViewer';
import { DocumentAnnotationsOverlay } from '@/components/DocumentAnnotationsOverlay';
import { userCanAnnotatePatientDocuments } from '@/lib/patient-document-annotate';
import { DocumentAnnotationThumbnail } from '@/components/DocumentAnnotationThumbnail';
import { usePatientDocumentAnnotationsMap } from '@/hooks/usePatientDocumentAnnotationsMap';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import type { ChecklistEntry } from '@/lib/consilium';
import type {
  ItemMediaSummary,
  MediaPreviewItem,
  PatientPresentationSummary,
  PresentationTimelineEpisode,
} from '@/lib/consilium-presentation';
import {
  type ConsiliumPrepCommentSnapshot,
  careTimelineEpisodeAccent,
  careTimelineRoleBadgeClass,
  careTimelineRoleHu,
  consiliumPresentationDiagnosisText,
  consiliumPresentationOncologyRows,
  consiliumShortDisplay,
  flattenCareTimelineNewestFirst,
  formatConsiliumHuDateTime,
  prepCommentsGroupedByKey,
} from '@/lib/consilium-view-helpers';

function ohipImpactLabel(score: number): string {
  if (score <= 8) return 'alacsony';
  if (score <= 18) return 'enyhe-közepes';
  if (score <= 28) return 'közepes';
  if (score <= 42) return 'jelentős';
  return 'nagyon jelentős';
}

function topOhipDomainsForTimepoint(
  row: PatientPresentationSummary['ohip14Summary'][keyof PatientPresentationSummary['ohip14Summary']] | undefined,
): Array<{ label: string; score: number }> {
  if (!row) return [];
  const labels = {
    functionalLimitationScore: 'Funkcionális korlátozottság',
    physicalPainScore: 'Fizikai fájdalom',
    psychologicalDiscomfortScore: 'Pszichés diszkomfort',
    physicalDisabilityScore: 'Fizikai akadályozottság',
    psychologicalDisabilityScore: 'Pszichés akadályozottság',
    socialDisabilityScore: 'Szociális akadályozottság',
    handicapScore: 'Hátrányérzet',
  } as const;
  type DomainKey = keyof typeof labels;
  const domains: Record<DomainKey, number | null> = {
    functionalLimitationScore: row.functionalLimitationScore,
    physicalPainScore: row.physicalPainScore,
    psychologicalDiscomfortScore: row.psychologicalDiscomfortScore,
    physicalDisabilityScore: row.physicalDisabilityScore,
    psychologicalDisabilityScore: row.psychologicalDisabilityScore,
    socialDisabilityScore: row.socialDisabilityScore,
    handicapScore: row.handicapScore,
  };
  return (Object.entries(domains) as Array<[DomainKey, number | null]>)
    .filter(([, value]) => value != null)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 3)
    .map(([key, value]) => ({ label: labels[key], score: value as number }));
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
  primerMutetLeirasa: null,
  radioterapia: false,
  radioterapiaDozis: null,
  radioterapiaDatumIntervallum: null,
  chemoterapia: false,
  chemoterapiaLeiras: null,
  ohip14Summary: {},
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
  const [newPointLabel, setNewPointLabel] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [showWelcomeHelp, setShowWelcomeHelp] = useState(false);
  const [welcomeStep, setWelcomeStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const centerPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const agendaPanelRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    if (!rawToken) return;
    const key = `consilium-prep-welcome-seen:${rawToken}`;
    try {
      const seen = sessionStorage.getItem(key);
      if (!seen) {
        setShowWelcomeHelp(true);
        sessionStorage.setItem(key, '1');
      }
    } catch {
      // sessionStorage may be unavailable in strict browser contexts
      setShowWelcomeHelp(true);
    }
  }, [rawToken]);

  const welcomeSteps = useMemo(
    () => [
      {
        title: '1. Általános áttekintés',
        body: 'Ez az Előkészítő felület segít a konzíliumra felkészülni. A felület három fő oszlopra van bontva, lent pedig a Napirendi pontok részt találja.',
      },
      {
        title: '2. Bal oldali oszlop',
        body: 'Itt találja az anamnesztikus és betegadatokat: diagnózis, TNM, onkológiai adatok, OHIP eredmények és a stádium napló.',
      },
      {
        title: '3. Középső oszlop',
        body: 'Középen az OP nézet és a fogászati státusz látható. A státusznál egér ráhúzáskor (mouse hover) megjelenik az adott fog részletes információja.',
      },
      {
        title: '4. Jobb oldali oszlop',
        body: 'Itt láthatók a fényképek. A képeken jelöléseket lehet készíteni: kommentelni és rajzolni is lehet.',
      },
      {
        title: '5. Napirendi pontok',
        body: 'Az oldal alján új Napirendi pontokat vihet fel, és pontonként meglátásokat, megjegyzéseket írhat be az élő megbeszélés előkészítéséhez.',
      },
    ],
    [],
  );
  const isLastWelcomeStep = welcomeStep >= welcomeSteps.length - 1;
  const spotlightTarget = useMemo(() => {
    if (welcomeStep === 1) return leftPanelRef;
    if (welcomeStep === 2) return centerPanelRef;
    if (welcomeStep === 3) return rightPanelRef;
    if (welcomeStep === 4) return agendaPanelRef;
    return null;
  }, [welcomeStep]);

  useEffect(() => {
    if (!showWelcomeHelp) {
      setSpotlightRect(null);
      return;
    }
    const target = spotlightTarget?.current;
    if (!target) {
      setSpotlightRect(null);
      return;
    }
    const updateRect = () => {
      const r = target.getBoundingClientRect();
      const pad = 8;
      setSpotlightRect({
        top: Math.max(4, r.top - pad),
        left: Math.max(4, r.left - pad),
        width: Math.max(80, r.width + pad * 2),
        height: Math.max(80, r.height + pad * 2),
      });
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [showWelcomeHelp, spotlightTarget]);

  useEffect(() => {
    if (!showWelcomeHelp) return;
    const target = spotlightTarget?.current;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [showWelcomeHelp, spotlightTarget]);

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

  const { byDocumentId: photoAnnByDoc, refresh: refreshPhotoAnnotations } =
    usePatientDocumentAnnotationsMap(ps.patientId || null, photoDocIds);

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
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {showWelcomeHelp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4">
          {spotlightRect ? (
            <div
              className="fixed pointer-events-none rounded-xl border border-cyan-300/60"
              style={{
                top: spotlightRect.top,
                left: spotlightRect.left,
                width: spotlightRect.width,
                height: spotlightRect.height,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.74)',
                background: 'rgba(6, 182, 212, 0.08)',
              }}
            />
          ) : (
            <div className="fixed inset-0 bg-black/75" />
          )}
          <div className="w-full max-w-4xl rounded-xl border border-cyan-400/35 bg-gradient-to-b from-cyan-950/70 via-zinc-950/90 to-black/95 p-5 sm:p-6 shadow-2xl relative z-10">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xl sm:text-2xl font-semibold text-cyan-100">Üdvözöljük az előkészítő nézetben</p>
                <p className="text-base sm:text-lg text-cyan-100/70 mt-1">
                  Lépésről lépésre megmutatjuk, mit hol talál.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-sm text-white/85"
                onClick={() => setShowWelcomeHelp(false)}
              >
                Bezárás
              </button>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4 sm:p-5 min-h-[190px]">
              <p className="text-lg sm:text-xl font-semibold text-white/95">{welcomeSteps[welcomeStep].title}</p>
              <p className="text-base sm:text-lg text-white/80 leading-relaxed mt-3">
                {welcomeSteps[welcomeStep].body}
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm sm:text-base text-cyan-100/75">
                {welcomeStep + 1} / {welcomeSteps.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-sm text-white/90 disabled:opacity-40"
                  disabled={welcomeStep === 0}
                  onClick={() => setWelcomeStep((s) => Math.max(0, s - 1))}
                >
                  Előző
                </button>
                {!isLastWelcomeStep ? (
                  <button
                    type="button"
                    className="rounded-md border border-cyan-300/40 bg-cyan-600/70 hover:bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white"
                    onClick={() => setWelcomeStep((s) => Math.min(welcomeSteps.length - 1, s + 1))}
                  >
                    Következő
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-md border border-emerald-300/40 bg-emerald-600/75 hover:bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                    onClick={() => setShowWelcomeHelp(false)}
                  >
                    Kezdhetjük
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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
                onAnnotationsUpdated={refreshPhotoAnnotations}
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
              <div className="col-span-12 lg:col-span-3" ref={leftPanelRef}>
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
                      {consiliumPresentationOncologyRows(ps).map((row) => (
                        <div key={row.label}>
                          <p className="text-xs text-white/50">{row.label}</p>
                          <p className="whitespace-pre-wrap break-words">{row.value || '—'}</p>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-white/10">
                        <p className="text-xs text-white/50 mb-2">OHIP-14 (T0-T3)</p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {(['T0', 'T1', 'T2', 'T3'] as const).map((tp) => {
                            const row = ps.ohip14Summary?.[tp];
                            const top3 = topOhipDomainsForTimepoint(row);
                            return (
                              <div key={tp} className="rounded-md border border-white/10 bg-black/20 p-2 min-w-[170px] flex-1">
                                <p className="text-[11px] font-semibold text-white/75">{tp}</p>
                                <p className="text-sm font-medium">
                                  {row?.totalScore != null ? `${row.totalScore}/56` : '—'}
                                </p>
                                <p className="text-[11px] text-white/50">
                                  {row?.totalScore != null ? ohipImpactLabel(row.totalScore) : 'nincs kitöltés'}
                                </p>
                                <p className="text-[10px] text-white/40 mt-0.5">
                                  {row?.completedAt ? formatConsiliumHuDateTime(row.completedAt) : '—'}
                                </p>
                                <p className="text-[10px] text-white/55 mt-1">Legrosszabb 3 domén:</p>
                                {top3.length > 0 ? (
                                  <p className="text-[10px] text-white/75 leading-snug">
                                    {top3.map((x) => `${x.label} (${x.score}/8)`).join(' · ')}
                                  </p>
                                ) : (
                                  <p className="text-[10px] text-white/40">—</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="border-t border-white/15 pt-4">
                    <h2 className="text-sm font-semibold text-white mb-2">Stádium napló</h2>
                    {timelineRows.length > 0 ? (
                      <div className="space-y-3">
                        {timelineRows.map((row, i) => {
                          const prev = i > 0 ? timelineRows[i - 1] : null;
                          const showEp = !prev || prev.episodeId !== row.episodeId;
                          const accent = careTimelineEpisodeAccent(row.episodeId);
                          return (
                            <div key={row.st.id} className="space-y-2">
                              {showEp ? (
                                <div className={`rounded-md px-2.5 py-2 ${accent.episodeBlockClass}`}>
                                  <p className={`text-sm font-semibold leading-snug ${accent.episodeTitleClass}`}>{row.epLabel}</p>
                                  {(row.episodeCreatedBy || row.episodeCreatedByRole) && (
                                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-white/55">
                                      <span className="text-white/45">Epizód rögzítő:</span>
                                      {row.episodeCreatedByRole ? (
                                        <span
                                          className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium border ${careTimelineRoleBadgeClass(row.episodeCreatedByRole)}`}
                                          title={careTimelineRoleHu(row.episodeCreatedByRole)}
                                        >
                                          {careTimelineRoleHu(row.episodeCreatedByRole)}
                                        </span>
                                      ) : null}
                                      {row.episodeCreatedBy ? (
                                        <span className="text-white/70 truncate max-w-[min(100%,14rem)]" title={row.episodeCreatedBy}>
                                          {consiliumShortDisplay(row.episodeCreatedBy)}
                                        </span>
                                      ) : null}
                                    </p>
                                  )}
                                </div>
                              ) : null}
                              <div className={`px-2.5 py-2 ${accent.stageCardClass}`}>
                                <p className="text-base font-semibold leading-snug">{row.st.stageLabel}</p>
                                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/65">
                                  <span>{formatConsiliumHuDateTime(row.st.at)}</span>
                                  {row.st.authorRole ? (
                                    <span
                                      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${careTimelineRoleBadgeClass(row.st.authorRole)}`}
                                      title={careTimelineRoleHu(row.st.authorRole)}
                                    >
                                      {careTimelineRoleHu(row.st.authorRole)}
                                    </span>
                                  ) : null}
                                  {row.st.authorDisplay ? (
                                    <span className="text-white/75 truncate max-w-[min(100%,14rem)]" title={row.st.authorDisplay}>
                                      {consiliumShortDisplay(row.st.authorDisplay)}
                                    </span>
                                  ) : null}
                                </p>
                                {row.st.note ? (
                                  <p className="mt-1.5 text-sm text-white/85 whitespace-pre-wrap leading-snug">{row.st.note}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {episodesWithoutStages.length > 0 && (
                      <div className={`space-y-2 ${timelineRows.length > 0 ? 'mt-4 pt-3 border-t border-white/15' : ''}`}>
                        {episodesWithoutStages.map((ep: PresentationTimelineEpisode) => {
                          const accent = careTimelineEpisodeAccent(ep.id);
                          const epLabel = [ep.reason, ep.status].filter(Boolean).join(' · ') || 'Epizód';
                          return (
                            <div key={ep.id} className={`rounded-md px-2.5 py-2 text-sm ${accent.episodeBlockClass}`}>
                              <p className={`font-semibold leading-snug ${accent.episodeTitleClass}`}>{epLabel}</p>
                              <p className="mt-1 text-white/55">Nincs stádium bejegyzés.</p>
                              {(ep.episodeCreatedBy || ep.episodeCreatedByRole) ? (
                                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-white/55">
                                  <span className="text-white/40">Rögzítő:</span>
                                  {ep.episodeCreatedByRole ? (
                                    <span
                                      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium border ${careTimelineRoleBadgeClass(ep.episodeCreatedByRole)}`}
                                    >
                                      {careTimelineRoleHu(ep.episodeCreatedByRole)}
                                    </span>
                                  ) : null}
                                  {ep.episodeCreatedBy ? (
                                    <span className="text-white/65">{consiliumShortDisplay(ep.episodeCreatedBy)}</span>
                                  ) : null}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {timelineRows.length === 0 && episodesWithoutStages.length === 0 && (
                      <p className="text-sm text-white/50">Nincs stádium vagy epizód adat.</p>
                    )}
                  </section>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-6 flex flex-col gap-3 min-w-0" ref={centerPanelRef}>
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

              <div className="col-span-12 lg:col-span-3 flex flex-col gap-3 min-w-0" ref={rightPanelRef}>
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
                          {ps.patientId ? (
                            <DocumentAnnotationThumbnail
                              patientId={ps.patientId}
                              documentId={p.documentId}
                              imageUrl={p.previewUrl}
                              annotations={photoAnnByDoc[p.documentId] ?? []}
                              objectFit="cover"
                              className="w-full h-24"
                              imgClassName="w-full h-24 object-cover"
                            />
                          ) : (
                            <img src={p.previewUrl} alt="" className="w-full h-24 object-cover" loading="lazy" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Teljes képernyő szélességű sáv, tartalom a vetítés max szélességén középen — mint a vetítés nézetben */}
        <section
          className="relative w-screen max-w-[100vw] left-1/2 -translate-x-1/2 border-y border-white/10 bg-gradient-to-b from-white/[0.04] to-black/50 py-4 lg:py-5"
          aria-label="Napirend és előkészítő hozzászólások"
          ref={agendaPanelRef}
        >
          <div className={`${presentMaxW} w-full mx-auto px-3 sm:px-5 lg:px-8`}>
            <div className="rounded-lg border border-cyan-500/40 bg-gradient-to-b from-cyan-950/55 via-cyan-950/25 to-black/40 p-3 lg:p-4 ring-1 ring-cyan-400/10">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200/90 mb-0.5">
                Napirend — előkészítő
              </p>
              <p className="text-[10px] text-cyan-100/45 mb-3">
                Pontonként balra az előkészítő hozzászólások, jobbra az élő ülésen rögzített verdikt (csak olvasható).
              </p>

              {!readonly && (
                <div className="flex flex-col gap-2 mb-4 pb-4 border-b border-cyan-500/25">
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

              <div className="space-y-4">
                {(ds.checklist || []).length === 0 && (
                  <p className="text-xs text-cyan-100/50">Még nincs napirendi pont.</p>
                )}
                {(ds.checklist || []).map((c: ChecklistEntry) => (
                  <div
                    key={c.key}
                    className="rounded-lg border border-white/10 bg-black/25 overflow-hidden"
                  >
                    <div className="px-3 pt-3 pb-2 border-b border-white/10">
                      <p className="text-sm font-medium text-cyan-50/95">{c.label}</p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x lg:divide-white/10">
                      <div className="p-3 bg-cyan-950/20 border-b border-white/10 lg:border-b-0 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200/80 mb-2">
                          Előkészítő hozzászólások
                        </p>
                        {(commentsByKey.get(c.key) || []).length === 0 ? (
                          <p className="text-[11px] text-cyan-100/40 mb-2">Még nincs hozzászólás.</p>
                        ) : (
                          <ul className="space-y-1.5 mb-3">
                            {(commentsByKey.get(c.key) || []).map((cm) => (
                              <li
                                key={cm.id}
                                className="text-xs text-cyan-50/90 bg-black/35 rounded-md px-2 py-1.5 border border-cyan-500/15"
                              >
                                <span className="text-cyan-200/50">
                                  {formatConsiliumHuDateTime(cm.createdAt)} · {cm.authorDisplay}
                                </span>
                                <p className="whitespace-pre-wrap mt-0.5 leading-snug">{cm.body}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!readonly && (
                          <div className="space-y-1.5 pt-2 border-t border-cyan-500/20">
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

                      <div className="p-3 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/80 mb-2">
                          Verdikt (élő ülés)
                        </p>
                        {c.response?.trim() ? (
                          <p className="text-xs text-amber-50/90 whitespace-pre-wrap leading-snug">{c.response}</p>
                        ) : (
                          <p className="text-[11px] text-amber-100/35">Nincs még rögzített verdikt.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
