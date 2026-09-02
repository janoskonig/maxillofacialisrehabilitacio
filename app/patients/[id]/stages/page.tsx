'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Patient } from '@/lib/types';
import type { PatientEpisode, PatientStageEntry, StageEventEntry } from '@/lib/types';
import Link from 'next/link';
import { BarChart3, Calendar, ChevronRight, HelpCircle, Plus } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PatientHeaderBar } from '@/components/PatientHeaderBar';
import { PatientTabsNav } from '@/components/PatientTabsNav';
import { EpisodePathwayEditor } from '@/components/EpisodePathwayEditor';
import { EpisodeStepsManager } from '@/components/EpisodeStepsManager';
import { AppointmentBookingSection } from '@/components/AppointmentBookingSection';
import { ConditionalAppointmentOffers } from '@/components/ConditionalAppointmentOffers';
import { PatientStageSelector } from '@/components/PatientStageSelector';
import { PatientStageStepper } from '@/components/PatientStageStepper';
import { PatientCareTimeline } from '@/components/PatientCareTimeline';
import { PatientEpisodeForm } from '@/components/PatientEpisodeForm';
import { PatientQuickTaskBlock } from '@/components/PatientQuickTaskBlock';
import { EpisodeRecallPanel } from '@/components/EpisodeRecallPanel';
import { useToast } from '@/contexts/ToastContext';

function DomainGlossary() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm text-medical-primary hover:underline font-medium"
        aria-expanded={open}
      >
        <HelpCircle className="w-4 h-4" />
        Fogalomtár: mi micsoda ezen az oldalon?
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 space-y-3">
          <div>
            <strong className="text-gray-900 dark:text-gray-100">Ellátási epizód</strong>
            <span className="text-gray-500 dark:text-gray-400"> — legfelső szint</span>
            <p className="mt-0.5">Egy beteg egy kezelési ciklusa az elejétől a végéig (pl. „Felső teljes fogpótlás"). Egy betegnek több epizódja is lehet (pl. felső + alsó állcsont külön).</p>
          </div>
          <div>
            <strong className="text-gray-900 dark:text-gray-100">Kezelési terv sablon (kezelési út)</strong>
            <span className="text-gray-500 dark:text-gray-400"> — a terv kiindulópontja</span>
            <p className="mt-0.5">Előre definiált lépéssorrend, amelyből az epizód kezelési terve generálható. Az adminisztrációban konfigurálható; az epizódra alkalmazva a terv szabadon egyéniesíthető (hozzáadás, átugrás, összevonás, átrendezés).</p>
          </div>
          <div>
            <strong className="text-gray-900 dark:text-gray-100">Munkafázis (lépés)</strong>
            <span className="text-gray-500 dark:text-gray-400"> — az epizód egy konkrét teendője</span>
            <p className="mt-0.5">Egyetlen elvégzendő kezelési lépés (pl. „Első konzultáció", „Lenyomatvétel", „Próba"). Minden munkafázishoz időpont foglalható, és állapota követhető (várakozik → időpont foglalva → kész).</p>
          </div>
          <div>
            <strong className="text-gray-900 dark:text-gray-100">Stádium (stage)</strong>
            <span className="text-gray-500 dark:text-gray-400"> — a beteg aktuális helyzete a teljes kezelési folyamatban</span>
            <p className="mt-0.5">Előre definiált szakaszok az első konzultációtól a gondozásig (pl. „Első konzultációra vár" → „Protetikai fázis" → „Átadás" → „Gondozás"). Durvább felbontású, mint a munkafázis — a pipeline nézet oszlopai ezek a stádiumok.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PatientStagesPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;
  const { showToast } = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<PatientStageEntry | StageEventEntry | null>(null);
  const [episodes, setEpisodes] = useState<PatientEpisode[]>([]);
  const [useNewModel, setUseNewModel] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Kezelési út / felelős orvos mentésekor bumpoljuk — a terv-kártya erre tölt újra.
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [showNewEpisodeForm, setShowNewEpisodeForm] = useState(false);
  // Több nyitott epizódnál a felhasználó által kiválasztott epizód vezérli a
  // terv-kártyát, a steppert és a foglalást. Alapérték: az első nyitott.
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);

  const refreshStagesAndEpisodes = useCallback(() => {
    setRefreshKey((k) => k + 1);
    // Tranziens hibánál (pl. 429/500) az utolsó ismert állapot marad — egy
    // hibatest-JSON different useNewModel=false-ra billentené a stádium-blokkot.
    fetch(`/api/patients/${patientId}/stages`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCurrentStage(data.timeline?.currentStage ?? null);
        setUseNewModel(!!data.useNewModel);
      })
      .catch(() => {});
    fetch(`/api/patients/${patientId}/episodes`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setEpisodes(data.episodes ?? []);
      })
      .catch(() => {});
  }, [patientId]);

  useEffect(() => {
    const handler = () => refreshStagesAndEpisodes();
    window.addEventListener('episode-created', handler);
    return () => window.removeEventListener('episode-created', handler);
  }, [refreshStagesAndEpisodes]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        setUserRole(user.role);

        if (user.role !== 'admin' && user.role !== 'beutalo_orvos' && user.role !== 'fogpótlástanász') {
          showToast('Nincs jogosultsága az oldal megtekintéséhez', 'error');
          router.push('/');
          return;
        }

        try {
          const response = await fetch(`/api/patients/${patientId}`, { credentials: 'include' });
          if (!response.ok) {
            if (response.status === 403 || response.status === 404) router.push('/');
            else throw new Error('Failed to fetch patient');
            return;
          }
          const data = await response.json();
          setPatient(data.patient);
          setAuthorized(true);
        } catch (error) {
          console.error('Error fetching patient:', error);
          router.push('/');
          return;
        }

        try {
          const stagesResponse = await fetch(`/api/patients/${patientId}/stages`, { credentials: 'include' });
          if (stagesResponse.ok) {
            const stagesData = await stagesResponse.json();
            setCurrentStage(stagesData.timeline?.currentStage ?? null);
            setUseNewModel(!!stagesData.useNewModel);
          }
        } catch (error) {
          console.error('Error fetching current stage:', error);
        }

        try {
          const epRes = await fetch(`/api/patients/${patientId}/episodes`, { credentials: 'include' });
          if (epRes.ok) {
            const epData = await epRes.json();
            setEpisodes(epData.episodes ?? []);
          }
        } catch (error) {
          console.error('Error fetching episodes:', error);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    if (patientId) checkAuth();
  }, [router, patientId, showToast]);

  const handleStageChanged = () => refreshStagesAndEpisodes();

  const openEpisodes = episodes.filter((e) => e.status === 'open');
  const activeEpisode =
    openEpisodes.find((e) => e.id === selectedEpisodeId) ?? openEpisodes[0] ?? null;
  const closedEpisodes = episodes.filter((e) => e.status !== 'open');
  const isDeceased = Boolean(patient?.halalDatum);
  const canEditEpisodeSettings = userRole === 'admin' || userRole === 'fogpótlástanász';
  const rawReason = patient?.kezelesreErkezesIndoka ?? activeEpisode?.reason ?? null;
  const patientReason =
    rawReason === '' || rawReason == null ? undefined : (rawReason as 'traumás sérülés' | 'veleszületett rendellenesség' | 'onkológiai kezelés utáni állapot');
  // A PatientHeaderBar a legacy stádium-bejegyzést ismeri (badge) — új modellnél nincs badge, mint a profilon.
  const headerStage = currentStage && 'stage' in currentStage ? currentStage : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Betöltés...</div>
      </div>
    );
  }

  if (!authorized || !patient) {
    return null;
  }

  return (
    <AppShell
      title="Beteg profil"
      backTo={`/patients/${patientId}/view`}
      maxWidth="xl"
      actions={
        <Link
          href="/patients/stages/gantt"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
        >
          <BarChart3 className="w-4 h-4" />
          GANTT nézet
        </Link>
      }
    >
      {/* Állandó beteg-fejléc — ugyanaz, mint a beteg profilon */}
      <PatientHeaderBar
        patient={patient}
        currentStage={headerStage}
        canSeeNextStep
        canAssignDoctor={userRole === 'admin' || userRole === 'fogpótlástanász'}
        onGoToScheduling={() =>
          document.getElementById('gyors-foglalas')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      />

      {/* Közös fülsor a profillal — itt a „Kezelés menete" fül az aktív */}
      <PatientTabsNav patientId={patientId} activeTab="stadiumok" />

      <DomainGlossary />

      <div className="space-y-4 sm:space-y-6">
          {/* 1) Hol tart a beteg? — epizód-kontextus + stádium-lépcső egy kártyán.
              A stádium az epizód tulajdonsága, ezért együtt jelennek meg; a
              kezelési út + felelős orvos a terv-kártya metasorába költözött. */}
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Hol tart a beteg?</h3>
                {openEpisodes.length > 0 ? (
                  <>
                    {openEpisodes.length > 1 && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Több nyitott epizód — kattintással válthatsz; a lenti terv és foglalás a
                        kiválasztott epizódra vonatkozik.
                      </p>
                    )}
                    <ul className="mt-1 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                      {openEpisodes.map((ep) => {
                        const isSelected = activeEpisode?.id === ep.id;
                        if (openEpisodes.length === 1) {
                          return (
                            <li key={ep.id} className="flex items-center gap-2 flex-wrap">
                              <span className="text-green-600 dark:text-green-400 font-medium">● Aktív epizód</span>
                              <span>{ep.chiefComplaint}</span>
                              <span className="text-gray-400 dark:text-gray-500">
                                {new Date(ep.openedAt).toLocaleDateString('hu-HU')}
                              </span>
                            </li>
                          );
                        }
                        return (
                          <li key={ep.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedEpisodeId(ep.id)}
                              aria-pressed={isSelected}
                              className={`w-full text-left flex items-center gap-2 flex-wrap rounded-md px-2 py-1 transition-colors ${
                                isSelected
                                  ? 'bg-medical-primary/5 ring-1 ring-medical-primary/30'
                                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                              }`}
                            >
                              <span className="text-green-600 dark:text-green-400 font-medium">● Aktív epizód</span>
                              <span>{ep.chiefComplaint}</span>
                              <span className="text-gray-400 dark:text-gray-500">
                                {new Date(ep.openedAt).toLocaleDateString('hu-HU')}
                              </span>
                              {isSelected && (
                                <span className="ml-auto text-xs font-medium text-medical-primary shrink-0">
                                  Kiválasztva ✓
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {isDeceased
                      ? 'Az ellátás a halálozási dátum rögzítésével lezárult; új epizód nem indítható.'
                      : 'Nincs aktív epizód — a kezelés követéséhez indítson újat.'}
                  </p>
                )}
              </div>
              {!isDeceased && !showNewEpisodeForm && (
                <button
                  type="button"
                  onClick={() => setShowNewEpisodeForm(true)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-medical-primary hover:underline shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Új epizód
                </button>
              )}
            </div>

            {/* Új epizód űrlap — a kártyába ágyazva */}
            {!isDeceased && showNewEpisodeForm && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <PatientEpisodeForm
                  patientId={patientId}
                  patientReason={patientReason}
                  onEpisodeCreated={() => refreshStagesAndEpisodes()}
                  embedded
                  onClose={() => setShowNewEpisodeForm(false)}
                />
              </div>
            )}

            {/* Stádium-lépcső — a „nagy kép": a beteg helye a teljes folyamatban.
                A kártya tetején áll, mert hierarchiában a terv fölött van. */}
            {useNewModel && activeEpisode && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <PatientStageStepper
                  key={`stepper-${activeEpisode.id}`}
                  episodeId={activeEpisode.id}
                  currentStage={currentStage}
                  onStageChanged={handleStageChanged}
                  refreshTrigger={refreshKey}
                  embedded
                />
              </div>
            )}

            {/* Korábbi (zárt) epizódok — alapból lecsukva */}
            {closedEpisodes.length > 0 && (
              <details className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 group">
                <summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1">
                  <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                  Korábbi epizódok ({closedEpisodes.length})
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  {closedEpisodes.slice(0, 10).map((ep) => (
                    <li key={ep.id} className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-500 dark:text-gray-400">○ Zárt</span>
                      <span>{ep.chiefComplaint}</span>
                      <span className="text-gray-400 dark:text-gray-500">
                        {new Date(ep.openedAt).toLocaleDateString('hu-HU')}
                      </span>
                      {(ep.carePathwayName || ep.assignedProviderName) && (
                        <span className="text-gray-500 dark:text-gray-400 text-xs">
                          {[ep.carePathwayName, ep.assignedProviderName].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Legacy stádium-űrlap — régi telepítésen (useNewModel=false) nincs
              beágyazott stepper, a régi űrlap közvetlenül az epizód-kártya alatt áll */}
          {!useNewModel && (
            <PatientStageSelector
              patientId={patientId}
              currentStage={currentStage}
              onStageChanged={handleStageChanged}
              activeEpisodeId={activeEpisode?.id ?? null}
              reason={patientReason}
              useNewModel={useNewModel}
            />
          )}

          {/* 2) Kezelési terv — munkafázisok + tervezett ütemezés EGY kártyán,
              fejlécében a sablon + felelős orvos metasorral. A foglalás a terv
              soraiból történik (worklist-motor), a lánc-foglalással együtt. */}
          {activeEpisode && (
            <EpisodeStepsManager
              // Egyedi kulcs: a testvér EpisodeRecallPanel ugyanezt az epizód-id-t
              // használta kulcsnak, és a duplikált key újrarendereléskor árva
              // (duplikált) kártya-példányokat hagyott a DOM-ban.
              key={`plan-${activeEpisode.id}`}
              episodeId={activeEpisode.id}
              patientId={patientId}
              carePathwayId={activeEpisode.carePathwayId ?? null}
              carePathwayName={activeEpisode.carePathwayName ?? null}
              episodePathways={activeEpisode.episodePathways?.map((ep) => ({
                id: ep.id,
                carePathwayId: ep.carePathwayId,
                pathwayName: ep.pathwayName,
                jaw: ep.jaw,
              }))}
              assignedProviderId={activeEpisode.assignedProviderId ?? null}
              assignedProviderName={activeEpisode.assignedProviderName ?? null}
              showProvider
              canEditProvider={canEditEpisodeSettings}
              onProviderChanged={() => {
                // A felelős orvos váltása az epizód adata: a kártya-fejléc, a
                // foglalási motor (worklist, intentek) és a stádium-javaslat is frissül.
                refreshStagesAndEpisodes();
                setSettingsVersion((v) => v + 1);
              }}
              refreshTrigger={settingsVersion}
              settingsPanel={
                canEditEpisodeSettings ? (
                  <EpisodePathwayEditor
                    episodeId={activeEpisode.id}
                    patientId={patientId}
                    carePathwayId={activeEpisode.carePathwayId}
                    carePathwayName={activeEpisode.carePathwayName}
                    treatmentTypeId={activeEpisode.treatmentTypeId}
                    onSaved={() => {
                      refreshStagesAndEpisodes();
                      setSettingsVersion((v) => v + 1);
                    }}
                    compact
                  />
                ) : undefined
              }
              onStepChanged={refreshStagesAndEpisodes}
            />
          )}

          {/* 2/b) Gondozás — rövid és hosszú távú visszarendelések egy kártyán.
              Üres állapotban is látszik (kézi visszarendelés így is felvehető);
              a rizikócsoport-választó csak a javasolt kadenciát állítja. */}
          {activeEpisode && (
            <EpisodeRecallPanel
              key={`recall-${activeEpisode.id}`}
              episodeId={activeEpisode.id}
              patientId={patientId}
            />
          )}

          {/* 3) Gyors foglalás — tervfüggetlen időpontfoglalás (konzultáció, kontroll)
              + a beteg összes lefoglalt időpontjának kezelése. A terv-vezérelt
              foglalás a fenti Kezelési terv kártya soraiban él. */}
          <div
            id="gyors-foglalas"
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 scroll-mt-20 sm:scroll-mt-24"
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-medical-primary" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Gyors foglalás</h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Időpont kezelési terv nélkül is foglalható (pl. konzultáció, kontroll). Itt kezelhető a
              beteg összes lefoglalt időpontja is.
            </p>
            <AppointmentBookingSection
              patientId={patientId}
              episodeId={activeEpisode?.id ?? null}
              pool={activeEpisode ? 'work' : undefined}
              isViewOnly={false}
              standalone
            />
          </div>

          {/* Betegnek küldött időpont-ajánlatok (admin) — egy kártya: fejlécben az
              „Új ajánlat küldése" gomb, alatta állapot-chipes lista. Saját
              kártya-chrome-mal, ezért a Gyors foglalás kártyán KÍVÜL áll
              (kártya-a-kártyában elkerülése). */}
          {userRole === 'admin' && (
            <ConditionalAppointmentOffers patientId={patientId} patientEmail={patient.email || null} />
          )}

          {/* 4) Feladatok */}
          <PatientQuickTaskBlock patientId={patientId} />

          {/* 5) Előzmények (teljes timeline) — alapból lecsukva */}
          <details className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 group">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer font-semibold text-gray-900 dark:text-gray-100 list-none [&::-webkit-details-marker]:hidden">
              <Calendar className="w-5 h-5 text-medical-primary" />
              Előzmények (teljes timeline)
              <ChevronRight className="w-4 h-4 ml-auto text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-2 pb-2">
              <PatientCareTimeline
                key={refreshKey}
                patientId={patientId}
                onRefresh={handleStageChanged}
                canEditStageStart={userRole === 'admin'}
              />
            </div>
          </details>
        </div>
    </AppShell>
  );
}
