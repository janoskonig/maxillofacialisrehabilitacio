'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EpisodeGetResponse, PatientStageEntry, StageCatalogEntry, StageEventEntry } from '@/lib/types';
import { buildStepperItems, isBackwardMove, stageLabelFor } from '@/lib/stage-stepper';
import { StageSuggestionModal } from './StageSuggestionModal';
import { useToast } from '@/contexts/ToastContext';
import { Check, Lightbulb, Loader2 } from 'lucide-react';

interface PatientStageStepperProps {
  /** Aktív (open) epizód — a stepper új-modelles, epizódhoz kötött. */
  episodeId: string;
  /** A stages GET currentStage-e — csak a dátum/megjegyzés kiírásához. */
  currentStage: PatientStageEntry | StageEventEntry | null;
  onStageChanged?: () => void;
  /** A szülő refresh-kulcsa: lépés-változáskor újraszámoljuk a javaslatot. */
  refreshTrigger?: number;
}

/**
 * Vizuális stádium-stepper: a katalógus szakaszai vízszintes lépcsőként,
 * kattintásra átállítás a kanonikus POST /api/episodes/:id/stage végponton
 * (CAS stage_version-nel). Betöltéskor és lépés-változáskor újraszámoltatja
 * az alvó javaslat-motort (POST /api/episodes/:id/suggestions), és a
 * javasolt stádiumot kiemeli + bannerben felkínálja.
 */
export function PatientStageStepper({
  episodeId,
  currentStage,
  onStageChanged,
  refreshTrigger,
}: PatientStageStepperProps) {
  const { showToast } = useToast();
  const [episode, setEpisode] = useState<EpisodeGetResponse | null>(null);
  const [catalog, setCatalog] = useState<StageCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingStage, setPendingStage] = useState<StageCatalogEntry | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSuggestionModal, setShowSuggestionModal] = useState(false);
  const currentStepRef = useRef<HTMLLIElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Minden load() kap egy sorszámot: csak a legutóbb indított írhat state-et
  // (epizódváltás vagy gyors refresh közben a kései válasz elavult).
  const loadSeqRef = useRef(0);
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    try {
      // A javaslat-motor felébresztése: friss recompute a lépések/időpontok
      // aktuális állása alapján. Hibája nem blokkol (pl. legacy telepítés).
      await fetch(`/api/episodes/${episodeId}/suggestions`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});

      const epRes = await fetch(`/api/episodes/${episodeId}`, { credentials: 'include' });
      if (!epRes.ok) throw new Error('episode fetch failed');
      const epData = await epRes.json();
      // A route { episode: {...} } burokban válaszol.
      const ep = (epData.episode ?? epData) as EpisodeGetResponse;

      const catRes = await fetch(`/api/stage-catalog?reason=${encodeURIComponent(ep.reason)}`, {
        credentials: 'include',
      });
      if (!catRes.ok) throw new Error('catalog fetch failed');
      const catData = await catRes.json();
      // Védő szűrés: csak az epizód etiológiájához tartozó sorok — a szerver
      // ismeretlen reason-nél a teljes katalógust adja vissza (3×8 sor).
      const entries = ((catData.catalog ?? []) as StageCatalogEntry[]).filter(
        (c) => c.reason === ep.reason
      );

      if (seq !== loadSeqRef.current) return;
      setEpisode(ep);
      setCatalog(entries);
      hasDataRef.current = true;
      setLoadError(false);
      // Háttér-frissítés után a nyitott megerősítő panel célja már lehet a
      // jelenlegi stádium (pl. másik fül állította át) — ilyenkor zárjuk,
      // különben azonos kódú duplikált stage_event vihető be.
      const freshCode = ep.currentStageCode ?? 'STAGE_0';
      setPendingStage((prev) => (prev && prev.code === freshCode ? null : prev));
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      console.error('Error loading stage stepper data:', error);
      // A hibakártya csak az első betöltés kudarcára való — a már működő
      // steppert háttér-frissítési hiba nem cserélheti le.
      if (!hasDataRef.current) setLoadError(true);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [episodeId]);

  // Epizódváltáskor tiszta lappal indulunk: skeleton + üres panel, amíg az új
  // epizód adatai meg nem érkeznek (a régi adat itt félrevezető lenne).
  useEffect(() => {
    hasDataRef.current = false;
    setEpisode(null);
    setCatalog([]);
    setLoading(true);
    setLoadError(false);
    setPendingStage(null);
    setNote('');
  }, [episodeId]);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  // A megerősítő panel megnyílásakor a fókusz a panelre kerül, hogy a
  // képernyőolvasó is értesüljön a felfedett tartalomról.
  useEffect(() => {
    if (pendingStage) panelRef.current?.focus();
  }, [pendingStage]);

  const currentStageCode = episode?.currentStageCode ?? 'STAGE_0';
  const suggestion = episode?.stageSuggestion ?? null;
  const suggestionActive = !!suggestion && suggestion.suggestedStage !== currentStageCode;
  const items = buildStepperItems(catalog, currentStageCode, suggestion?.suggestedStage);

  // A jelenlegi stádium középre görgetése, ha a lépcső túllóg a konténeren.
  // Szándékosan NEM scrollIntoView: az minden görgethető őst (az oldalt is)
  // görgetné, ami mobilon betöltéskor a stepperhez ugratná a viewportot.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const step = currentStepRef.current;
    if (container && step && container.scrollWidth > container.clientWidth) {
      const stepRect = step.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      container.scrollTo({
        left:
          container.scrollLeft +
          (stepRect.left - contRect.left) -
          (container.clientWidth - stepRect.width) / 2,
      });
    }
  }, [currentStageCode, catalog.length]);

  // Dátum/megjegyzés csak akkor, ha a stages-timeline bejegyzés tényleg ehhez
  // az epizódhoz és stádiumhoz tartozik (a timeline beteg-szintű legutóbbi).
  const currentMeta =
    currentStage &&
    'stageCode' in currentStage &&
    currentStage.episodeId === episodeId &&
    currentStage.stageCode === currentStageCode
      ? currentStage
      : null;

  // Siker/konfliktus után egyetlen frissítési kör fusson: ha van szülő-callback,
  // az bumpolja a refreshTrigger-t (ami load()-ot indít) — a közvetlen load()
  // emellett duplikált recompute-ot és log-sorokat okozna.
  const refreshAfterChange = () => {
    if (onStageChanged) onStageChanged();
    else load();
  };

  const handleSave = async () => {
    if (!pendingStage || !episode) return;
    // Háttér-frissítés óta a cél már lehet a jelenlegi stádium — ilyenkor
    // nincs mit menteni (a szerver duplikált eseményt szúrna be).
    if (pendingStage.code === (episode.currentStageCode ?? 'STAGE_0')) {
      setPendingStage(null);
      setNote('');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          stageCode: pendingStage.code,
          note: note.trim() || undefined,
          expectedStageVersion: episode.stageVersion ?? 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        showToast('Egy másik felhasználó közben módosította a stádiumot — frissítem az adatokat', 'error');
        setPendingStage(null);
        refreshAfterChange();
        return;
      }
      if (!res.ok) {
        showToast(data.error || 'Hiba történt a stádium mentésekor', 'error');
        return;
      }
      showToast('Stádium átállítva', 'success');
      setPendingStage(null);
      setNote('');
      refreshAfterChange();
    } catch (error) {
      console.error('Error saving stage:', error);
      showToast('Hálózati hiba történt a stádium mentésekor', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Stádium</h3>
        <div className="mt-4 h-16 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    );
  }

  if (loadError || !episode || catalog.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Stádium</h3>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-md">
          A stádium-adatok most nem érhetők el.{' '}
          <button type="button" onClick={() => { setLoading(true); load(); }} className="font-medium underline">
            Újrapróbálom
          </button>
        </p>
      </div>
    );
  }

  const currentLabel = stageLabelFor(catalog, currentStageCode);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
      <div className="mb-1 flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Stádium</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Jelenlegi: <strong className="text-gray-700 dark:text-gray-200">{currentLabel}</strong>
        </span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        A beteg helyzete a teljes kezelési folyamatban — kattintson egy szakaszra az átállításhoz
      </p>

      {/* Javaslat-banner: a szabály-motor (stage-reducer) friss számítása */}
      {suggestionActive && suggestion && (
        <div className="mb-4 flex items-center gap-2 flex-wrap rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-2">
          <Lightbulb className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
          <span className="text-sm text-blue-800 dark:text-blue-200">
            A rendszer javaslata a kezelés állása alapján:{' '}
            <strong>{stageLabelFor(catalog, suggestion.suggestedStage)}</strong>
          </span>
          <button
            type="button"
            onClick={() => setShowSuggestionModal(true)}
            className="ml-auto text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline shrink-0"
          >
            Megnézem
          </button>
        </div>
      )}

      {/* Lépcső — pt-1.5: a „Javasolt" gyűrű és a fókusz-outline felső íve
          különben levágódna az overflow-konténer szélén */}
      <div ref={scrollContainerRef} className="overflow-x-auto pt-1.5 pb-1">
        <ol className="flex items-start min-w-max">
          {items.map(({ entry, state, suggested }, idx) => (
            <li
              key={entry.code}
              ref={state === 'current' ? currentStepRef : undefined}
              className={`relative flex-1 min-w-[6.5rem] max-w-[9rem] ${
                idx > 0
                  ? `before:content-[''] before:absolute before:top-[15px] before:-left-1/2 before:w-full before:h-0.5 ${
                      state === 'past' || state === 'current'
                        ? 'before:bg-medical-primary/50'
                        : 'before:bg-gray-200 dark:before:bg-gray-700'
                    }`
                  : ''
              }`}
            >
              <button
                type="button"
                disabled={saving || state === 'current'}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={
                  state === 'current'
                    ? `Jelenlegi stádium: ${entry.labelHu}`
                    : `Átállítás: ${entry.labelHu}${suggested ? ' (javasolt)' : ''}`
                }
                aria-expanded={pendingStage?.code === entry.code}
                aria-controls={pendingStage?.code === entry.code ? 'stage-confirm-panel' : undefined}
                onClick={() => {
                  setPendingStage(entry);
                  setNote('');
                }}
                className="relative z-10 w-full flex flex-col items-center gap-1.5 px-1 group disabled:cursor-default"
                title={state === 'current' ? `Jelenlegi stádium: ${entry.labelHu}` : `Átállítás: ${entry.labelHu}`}
              >
                <span
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-semibold transition-colors ${
                    state === 'current'
                      ? 'bg-medical-primary border-medical-primary text-white'
                      : state === 'past'
                        ? 'bg-medical-primary/10 border-medical-primary/60 text-medical-primary group-hover:bg-medical-primary/20'
                        : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 group-hover:border-medical-primary group-hover:text-medical-primary'
                  } ${suggested ? 'ring-2 ring-offset-1 ring-blue-400 dark:ring-blue-500 dark:ring-offset-gray-900' : ''}`}
                >
                  {state === 'past' ? <Check className="w-4 h-4" /> : idx + 1}
                </span>
                <span
                  className={`text-xs text-center leading-tight ${
                    state === 'current'
                      ? 'font-semibold text-gray-900 dark:text-gray-100'
                      : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300'
                  }`}
                >
                  {entry.labelHu}
                </span>
                {suggested && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                    Javasolt
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </div>

      {/* Megerősítő panel */}
      {pendingStage && (
        <div
          id="stage-confirm-panel"
          ref={panelRef}
          tabIndex={-1}
          aria-label="Stádium átállításának megerősítése"
          className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-3 focus:outline-none"
        >
          <p className="text-sm text-gray-800 dark:text-gray-200">
            Stádium átállítása erre: <strong>{pendingStage.labelHu}</strong>
            {isBackwardMove(catalog, currentStageCode, pendingStage.code) && (
              <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
                (korábbi stádiumra lépés — indoklás ajánlott)
              </span>
            )}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Megjegyzés (opcionális) — pl. a váltás indoka…"
            className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-medical-primary focus:border-medical-primary"
            disabled={saving}
          />
          <div className="mt-2 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setPendingStage(null); setNote(''); }}
              disabled={saving}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/60 disabled:opacity-50"
            >
              Mégse
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Átállítás
            </button>
          </div>
        </div>
      )}

      {/* Jelenlegi stádium metaadatai */}
      {currentMeta && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Beállítva:{' '}
          {new Date(currentMeta.at).toLocaleDateString('hu-HU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {currentMeta.note && <> · „{currentMeta.note}”</>}
        </p>
      )}

      {showSuggestionModal && suggestionActive && suggestion && (
        <StageSuggestionModal
          episodeId={episodeId}
          suggestion={suggestion}
          stageLabel={stageLabelFor(catalog, suggestion.suggestedStage)}
          fromStageLabel={stageLabelFor(catalog, suggestion.fromStage ?? currentStageCode)}
          stageVersion={episode.stageVersion ?? 0}
          onAccepted={() => {
            setShowSuggestionModal(false);
            showToast('Stádium átállítva a javaslat szerint', 'success');
            refreshAfterChange();
          }}
          onDismissed={() => {
            setShowSuggestionModal(false);
            load();
          }}
          onClose={() => setShowSuggestionModal(false)}
        />
      )}
    </div>
  );
}
