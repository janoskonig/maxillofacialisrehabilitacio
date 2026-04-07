'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Users, X } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { OPInlinePreview } from '@/components/OPInlinePreview';
import { PresentationDentalMiniViewer } from '@/components/PresentationDentalMiniViewer';
import { DocumentAnnotationsOverlay } from '@/components/DocumentAnnotationsOverlay';
import { DocumentAnnotationThumbnail } from '@/components/DocumentAnnotationThumbnail';
import { userCanAnnotatePatientDocuments } from '@/lib/patient-document-annotate';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import { usePatientDocumentAnnotationsMap } from '@/hooks/usePatientDocumentAnnotationsMap';
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
  consiliumPresentationOncologyRows,
  formatConsiliumHuDateTime,
  prepCommentsGroupedByKey,
} from '@/lib/consilium-view-helpers';

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
  prepComments?: ConsiliumPrepCommentSnapshot[];
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

type InstitutionUserRow = {
  id: string;
  email: string;
  doktorNeve: string | null;
  role: string;
  intezmeny?: string | null;
};

function presentInstitutionUserLabel(u: InstitutionUserRow) {
  const n = u.doktorNeve?.trim();
  return n || u.email;
}

function normalizeForUserSearch(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function institutionUserMatchesQuery(u: InstitutionUserRow, rawQuery: string) {
  const q = normalizeForUserSearch(rawQuery);
  if (q.length === 0) return false;
  const label = normalizeForUserSearch(presentInstitutionUserLabel(u));
  const email = normalizeForUserSearch(u.email);
  return label.includes(q) || email.includes(q);
}

const DELEGATE_SUGGESTIONS_MAX = 14;

function PresentChecklistDelegate({
  sessionId,
  itemId,
  checklistKey,
  readonly,
  institutionUsers,
  institutionUsersLoading,
}: {
  sessionId: string;
  itemId: string;
  checklistKey: string;
  readonly: boolean;
  institutionUsers: InstitutionUserRow[];
  institutionUsersLoading: boolean;
}) {
  const [inputValue, setInputValue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const blurCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const suggestions = useMemo(() => {
    if (institutionUsersLoading || institutionUsers.length === 0) return [];
    const q = inputValue.trim();
    if (q.length === 0) return [];
    const hits = institutionUsers.filter((u) => institutionUserMatchesQuery(u, q));
    return hits.slice(0, DELEGATE_SUGGESTIONS_MAX);
  }, [institutionUsers, institutionUsersLoading, inputValue]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [inputValue, suggestions.length]);

  useEffect(() => {
    return () => {
      if (blurCloseTimer.current) clearTimeout(blurCloseTimer.current);
    };
  }, []);

  const pickUser = useCallback((u: InstitutionUserRow) => {
    setAssigneeId(u.id);
    setInputValue(presentInstitutionUserLabel(u));
    setListOpen(false);
    setFeedback(null);
  }, []);

  const clearBlurTimer = () => {
    if (blurCloseTimer.current) {
      clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  };

  if (readonly) return null;

  const send = async () => {
    if (!assigneeId) {
      setFeedback({ ok: false, msg: 'Válassz címzettet a listából (kezd el gépelni a nevet vagy e-mailt).' });
      return;
    }
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(checklistKey)}/delegate-task`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigneeUserId: assigneeId,
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback({
          ok: false,
          msg: typeof data.error === 'string' ? data.error : 'Sikertelen küldés',
        });
        return;
      }
      setFeedback({
        ok: true,
        msg: 'Feladat elküldve — a címzettnek a Feladataim oldalon jelenik meg.',
      });
      setNote('');
      setAssigneeId('');
      setInputValue('');
    } catch {
      setFeedback({ ok: false, msg: 'Hálózati hiba' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-amber-500/25">
      <p className="text-[10px] text-amber-100/50 uppercase tracking-wide mb-1">Feladat delegálása</p>
      <p className="text-[11px] text-amber-100/35 mb-2">
        Kezdd el gépelni a nevet vagy e-mailt, majd válassz a listából — a feladat a kijelölt felhasználó nyitott feladatai közé kerül.
      </p>
      <div className="flex flex-col gap-2 relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={listOpen && suggestions.length > 0}
          aria-autocomplete="list"
          aria-controls={`delegate-suggest-${checklistKey}`}
          autoComplete="off"
          disabled={institutionUsersLoading || sending}
          placeholder={
            institutionUsersLoading ? 'Felhasználók betöltése…' : 'Név vagy e-mail kezdete…'
          }
          className="w-full text-sm rounded-md border border-amber-500/30 bg-black/45 text-amber-50/95 placeholder:text-amber-200/30 px-2 py-1.5 outline-none focus:border-amber-400/50"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setAssigneeId('');
            setFeedback(null);
            setListOpen(true);
          }}
          onFocus={(e) => {
            clearBlurTimer();
            setListOpen(true);
            if (assigneeId) e.target.select();
          }}
          onBlur={() => {
            blurCloseTimer.current = setTimeout(() => setListOpen(false), 180);
          }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (!listOpen || suggestions.length === 0) {
              if (e.key === 'Escape') setListOpen(false);
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightIdx((i) => Math.min(suggestions.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const u = suggestions[highlightIdx];
              if (u) pickUser(u);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setListOpen(false);
            }
          }}
        />
        {listOpen && inputValue.trim().length > 0 && !institutionUsersLoading && (
          <ul
            id={`delegate-suggest-${checklistKey}`}
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-52 overflow-y-auto rounded-md border border-amber-500/35 bg-zinc-950 shadow-lg py-1"
          >
            {suggestions.length === 0 ? (
              <li className="px-2 py-2 text-xs text-amber-100/45">Nincs találat.</li>
            ) : (
              suggestions.map((u, idx) => (
                <li key={u.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === highlightIdx}
                    className={`w-full text-left px-2 py-1.5 text-sm ${
                      idx === highlightIdx ? 'bg-amber-500/20 text-amber-50' : 'text-amber-50/90 hover:bg-amber-500/10'
                    }`}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => pickUser(u)}
                  >
                    {presentInstitutionUserLabel(u)}
                    {u.role === 'technikus' ? (
                      <span className="text-amber-200/40 text-xs ml-1">(technikus)</span>
                    ) : null}
                    <span className="block text-[10px] text-amber-100/40 truncate">{u.email}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
        <textarea
          className="w-full min-h-[48px] rounded-md border border-amber-500/25 bg-black/40 text-xs text-amber-50/90 placeholder:text-amber-200/25 px-2 py-1.5 outline-none focus:border-amber-400/45"
          placeholder="Opcionális megjegyzés a címzettnek…"
          value={note}
          disabled={sending}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          disabled={sending || institutionUsersLoading || !assigneeId}
          className="text-xs px-2 py-1.5 rounded-md bg-amber-600/90 hover:bg-amber-600 text-white disabled:opacity-40 disabled:pointer-events-none w-fit"
          onClick={() => void send()}
        >
          {sending ? 'Küldés…' : 'Feladat küldése'}
        </button>
        {feedback && (
          <p className={`text-[11px] ${feedback.ok ? 'text-emerald-300/90' : 'text-red-300/90'}`}>{feedback.msg}</p>
        )}
      </div>
    </div>
  );
}

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
      <p className="text-[10px] text-amber-100/40 mt-1">
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
          <p className="text-xs text-amber-50/90 whitespace-pre-wrap">{entry.response}</p>
        ) : (
          <p className="text-[11px] text-amber-100/35">Nincs rögzített verdikt</p>
        )}
        {meta}
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <label className="text-[10px] text-amber-100/50 uppercase tracking-wide">Verdikt (élő ülés)</label>
      <textarea
        className="mt-0.5 w-full min-h-[72px] rounded-md border border-amber-500/35 bg-black/45 text-sm text-amber-50/95 placeholder:text-amber-200/25 p-2 outline-none focus:border-amber-400/55 focus:ring-1 focus:ring-amber-400/20"
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
  const [photoLightbox, setPhotoLightbox] = useState<{
    patientId: string;
    previews: MediaPreviewItem[];
    index: number;
  } | null>(null);
  const [institutionUsers, setInstitutionUsers] = useState<InstitutionUserRow[]>([]);
  const [institutionUsersLoading, setInstitutionUsersLoading] = useState(false);

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
    if (!user || user.role === 'technikus') return;
    let cancelled = false;
    setInstitutionUsersLoading(true);
    fetch('/api/consilium/institution-users', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.resolve({ users: [] })))
      .then((data: { users?: InstitutionUserRow[] }) => {
        if (cancelled) return;
        const raw = Array.isArray(data.users) ? data.users : [];
        const mine = (user.intezmeny ?? '').trim();
        const scoped =
          mine.length > 0
            ? raw.filter((u) => (u.intezmeny ?? '').trim() === mine)
            : [];
        setInstitutionUsers(scoped);
      })
      .catch(() => {
        if (!cancelled) setInstitutionUsers([]);
      })
      .finally(() => {
        if (!cancelled) setInstitutionUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    setPhotoLightbox(null);
  }, [index]);

  const items = useMemo(
    () => payload?.items ?? [],
    [payload?.items],
  );
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

  const prepCommentsByKey = useMemo(
    () => prepCommentsGroupedByKey(current?.prepComments),
    [current],
  );

  const photoDocIds = useMemo(() => {
    if (!current) return [] as string[];
    return (current.mediaSummary?.photoPreview?.previews ?? [])
      .map((p) => p.documentId)
      .filter(Boolean);
  }, [current]);

  const photoPatientId = current?.patientSummary?.patientId ?? null;
  const { byDocumentId: photoAnnByDoc, refresh: refreshPhotoAnnotations } =
    usePatientDocumentAnnotationsMap(photoPatientId, photoDocIds);

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
  const canAnnotatePatientDocs = userCanAnnotatePatientDocuments(user) && !readonly;

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
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <div className="border-b border-white/10 bg-black/40 backdrop-blur sticky top-0 z-20">
        <div className={`${presentMaxW} w-full mx-auto px-3 sm:px-5 lg:px-8 py-2 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-3 min-w-0">
            <Logo width={34} height={39} />
            <div className="min-w-0">
              <p className="text-xs text-white/60 truncate">{payload.session.title}</p>
              <p className="text-sm font-semibold truncate flex flex-wrap items-center gap-2">
                <span>Konzílium vetítés · {new Date(payload.session.scheduledAt).toLocaleString('hu-HU')}</span>
                <span className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-100 border border-amber-400/35">
                  Élő megbeszélés
                </span>
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
                  <p className="text-sm md:text-base text-white/80 mt-2 leading-snug whitespace-pre-wrap break-words">
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
                          {consiliumPresentationDiagnosisText(ps) || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50 mb-0.5">TNM</p>
                        <p className="text-sm md:text-base break-words">{ps.tnmStaging || '—'}</p>
                      </div>
                      {consiliumPresentationOncologyRows(ps).map((row) => (
                        <div key={row.label}>
                          <p className="text-xs text-white/50 mb-0.5">{row.label}</p>
                          <p className="text-sm md:text-base whitespace-pre-wrap break-words leading-snug">
                            {row.value || '—'}
                          </p>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-white/10">
                        <p className="text-xs text-white/50 mb-2">OHIP-14 (T0-T3)</p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {(['T0', 'T1', 'T2', 'T3'] as const).map((tp) => {
                            const row = ps.ohip14Summary?.[tp];
                            const top3 = topOhipDomainsForTimepoint(row);
                            return (
                              <div key={tp} className="rounded-md border border-white/10 bg-black/20 p-2 min-w-[180px] flex-1">
                                <p className="text-[11px] font-semibold text-white/75">{tp}</p>
                                <p className="text-sm md:text-base font-medium">
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
                                  {formatConsiliumHuDateTime(row.st.at)}
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
                        <p className="text-sm text-white/65">{formatConsiliumHuDateTime(ps.stage.stageDate)}</p>
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
                      canAnnotate={canAnnotatePatientDocs}
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
                              setPhotoLightbox({
                                patientId: ps.patientId || '',
                                previews: ms.photoPreview?.previews ?? [],
                                index: pi,
                              })
                            }
                            className="rounded-md overflow-hidden border border-white/10 bg-black/40 text-left focus:outline-none focus:ring-2 focus:ring-white/40 shrink-0"
                          >
                            {ps.patientId ? (
                              <DocumentAnnotationThumbnail
                                patientId={ps.patientId}
                                documentId={p.documentId}
                                imageUrl={p.previewUrl}
                                annotations={photoAnnByDoc[p.documentId] ?? []}
                                objectFit="cover"
                                className="w-full h-24 lg:h-28"
                                imgClassName="w-full h-24 lg:h-28 object-cover"
                              />
                            ) : (
                              <img
                                src={p.previewUrl}
                                alt={p.filename || 'foto'}
                                className="w-full h-24 lg:h-28 object-cover"
                                loading="lazy"
                              />
                            )}
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
              </div>
            </div>
          </div>
        </div>

        {/* Teljes képernyő szélességű sáv, tartalom a vetítés max szélességén középen */}
        <section
          className="relative w-screen max-w-[100vw] left-1/2 -translate-x-1/2 border-y border-white/10 bg-gradient-to-b from-white/[0.04] to-black/50 py-4 lg:py-5"
          aria-label="Élő megbeszélés"
        >
          <div className={`${presentMaxW} w-full mx-auto px-3 sm:px-5 lg:px-8`}>
            <div className="rounded-lg border border-amber-500/45 bg-gradient-to-b from-amber-950/45 via-amber-950/20 to-black/40 p-3 lg:p-4 ring-1 ring-amber-400/10">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/90 mb-0.5">
                Élő megbeszélés — konzílium
              </p>
              <p className="text-[10px] text-amber-100/45 mb-3">
                Napirendi pontonként: balra az előkészítő hozzászólások, jobbra a pipa, verdikt és delegálás.
              </p>
              <div className="space-y-2">
                <div>
                  <label className="flex items-center gap-2 text-sm text-amber-50/95">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-amber-400/40 bg-black/30"
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
                  <p className="text-xs text-amber-100/55 mb-2">Napirendi pontok</p>
                  <div className="space-y-4">
                    {(ds.checklist || []).length === 0 && <p className="text-xs text-amber-100/50">Üres</p>}
                    {(ds.checklist || []).map((c: ChecklistEntry) => {
                      const prepList = prepCommentsByKey.get(c.key) ?? [];
                      return (
                        <div
                          key={c.key}
                          className="rounded-lg border border-white/10 bg-black/25 overflow-hidden"
                        >
                          <label className="flex items-start gap-2 text-sm px-3 pt-3 pb-2 border-b border-white/10">
                            <input
                              type="checkbox"
                              className="mt-1 border-amber-400/40 bg-black/30 shrink-0"
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
                            <span className="text-amber-50/95 font-medium min-w-0">{c.label}</span>
                          </label>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x lg:divide-white/10">
                            <div className="p-3 bg-cyan-950/20 border-b border-white/10 lg:border-b-0 min-w-0">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200/80 mb-2">
                                Előkészítő hozzászólások
                              </p>
                              {prepList.length === 0 ? (
                                <p className="text-[11px] text-cyan-100/40">Nincs előkészítő hozzászólás.</p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {prepList.map((cm) => (
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
                            </div>

                            <div className="p-3 min-w-0">
                              {readonly ? (
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/80 mb-2">
                                  Verdikt
                                </p>
                              ) : null}
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
                              <PresentChecklistDelegate
                                sessionId={sessionId}
                                itemId={current.id}
                                checklistKey={c.key}
                                readonly={readonly}
                                institutionUsers={institutionUsers}
                                institutionUsersLoading={institutionUsersLoading}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

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
                alt={photoLightbox.previews[photoLightbox.index]?.filename || ''}
                className="max-h-[min(85vh,900px)] max-w-full w-auto object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
