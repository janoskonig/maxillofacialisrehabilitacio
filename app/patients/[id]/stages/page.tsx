'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Patient } from '@/lib/types';
import type { AftercareWorkspace } from '@/lib/aftercare/model';
import { treatmentWorkspacePhase } from '@/lib/treatment-workspace';
import { stageDisplay } from '@/components/TreatmentPlanGantt/stage-display';
import { useTimelineData } from '@/components/TreatmentPlanGantt/useTimelineData';
import type { TimelineStep } from '@/components/TreatmentPlanGantt/types';
import { PatientTreatmentJourney } from '@/components/PatientTreatmentJourney';
import { PatientAftercare } from '@/components/aftercare/PatientAftercare';
import { ProsthesisLifecycle } from '@/components/prosthesis-lifecycle/ProsthesisLifecycle';
import { FormModeSwitch } from '@/components/prosthesis-lifecycle/FormMode';
import type { PatientEpisode, PatientStageEntry, StageEventEntry } from '@/lib/types';
import Link from 'next/link';
import { BarChart3, CalendarClock, ChevronDown, HeartPulse, Plus } from 'lucide-react';
import { ToothIcon } from '@/components/icons/ToothIcon';
import { AppShell } from '@/components/layout/AppShell';
import { PatientHeaderBar } from '@/components/PatientHeaderBar';
import { PatientTabsNav } from '@/components/PatientTabsNav';
import { EpisodeStepsManager } from '@/components/EpisodeStepsManager';
import { AppointmentBookingSection } from '@/components/AppointmentBookingSection';
import { ConditionalAppointmentOffers } from '@/components/ConditionalAppointmentOffers';
import { PatientStageSelector } from '@/components/PatientStageSelector';
import { PatientStageStepper } from '@/components/PatientStageStepper';
import { PatientCareTimeline } from '@/components/PatientCareTimeline';
import { PatientQuickTaskBlock } from '@/components/PatientQuickTaskBlock';
import { episodeOverviewHref, episodeAnamnesisHref } from '@/lib/episode-overview';
import { EpisodeRecallPanel } from '@/components/EpisodeRecallPanel';
import { EpisodeObstaclesPanel } from '@/components/EpisodeObstaclesPanel';
import { useToast } from '@/contexts/ToastContext';

function WorkspaceSection({ id, title, open, onToggle, children }: {
  id?: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return <section id={id} className="scroll-mt-24 rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      {title}<ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="border-t border-gray-100 p-3 sm:p-4 dark:border-gray-800">{children}</div>}
  </section>;
}

export default function PatientStagesPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;
  const workspaceQuery=useSearchParams().toString();
  const { showToast, confirm } = useToast();
  const [entryState,setEntryState]=useState({dirty:false,saving:false});
  const canLeaveWork=async()=>!entryState.saving&&(!entryState.dirty||await confirm('A kitöltött ellátási adatok még nincsenek mentve. Elveted őket és továbblépsz?'));
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [appointmentsOpen, setAppointmentsOpen] = useState(false);
  const [statusAppointmentId, setStatusAppointmentId] = useState<string | null>(null);
  const handleStatusOpened = useCallback(() => setStatusAppointmentId(null), []);
  const [recallOpen, setRecallOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workView, setWorkView] = useState<'plan' | 'aftercare' | 'prostheses' | null>(null);
  const [care, setCare] = useState<AftercareWorkspace | null>(null);
  const [careError, setCareError] = useState('');
  const [careRetry, setCareRetry] = useState(0);
  const [requestedAppointment, setRequestedAppointment] = useState<string | undefined>();
  const handleCareChanged = useCallback((data: AftercareWorkspace) => {
    setCare(data);
    setSettingsVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController();
    setCareError('');
    fetch(`/api/patients/${patientId}/aftercare`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error('A gondozási adatok nem tölthetők be.'); return res.json(); })
      .then((data) => { if (!controller.signal.aborted) setCare(data); })
      .catch((error) => { if (!controller.signal.aborted) setCareError(error.message); });
    return () => controller.abort();
  }, [authorized, patientId, careRetry]);

  const openAppointments = useCallback((appointmentId?: string) => {
    setStatusAppointmentId(appointmentId ?? null);
    setAppointmentsOpen(true);
    document.getElementById('gyors-foglalas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  // Existing links from the profile and coordinator keep opening the booking area.
  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash === '#gyors-foglalas') setAppointmentsOpen(true);
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);
  // Több nyitott epizódnál a felhasználó által kiválasztott epizód vezérli a
  // terv-kártyát, a steppert és a foglalást. Alapérték: az első nyitott.
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(workspaceQuery);
    setSelectedEpisodeId(query.get('episodeId'));
    const view=query.get('view');
    setWorkView(view==='aftercare'||view==='plan'||view==='prostheses'?view:null);
    setRequestedAppointment(query.get('appointmentId')??undefined);
    if (!query.get('appointmentId')&&(query.get('plan')==='1'||['#kezelesi-terv','#finanszirozas'].includes(window.location.hash))){router.replace(episodeOverviewHref(patientId,query.get('episodeId'),window.location.hash==='#finanszirozas'?'financing':'plan'));return;}
    if (query.get('appointmentId')) { setRequestedAppointment(query.get('appointmentId')!); if(query.get('view')!=='prostheses')setWorkView('aftercare'); }
  }, [router,patientId,workspaceQuery]);

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
  const activeEpisode = episodes.find((e) => e.id === selectedEpisodeId) ?? openEpisodes[0] ?? episodes[0] ?? null;
  const selectableEpisodes = episodes;
  const timeline = useTimelineData({ status: 'all', providerId: '', searchDebounced: '', patientId,
    careWorkspace: care, episodeId: activeEpisode?.id, enabled: authorized && !!activeEpisode,
    refreshTrigger: settingsVersion + refreshKey });
  const timelineEpisode = timeline.episodes.find((e) => e.episodeId === activeEpisode?.id) ?? null;
  const phase = treatmentWorkspacePhase(timelineEpisode, care, activeEpisode?.id ?? '');
  const aftercareDefault = phase === 'aftercare' || (phase === 'mixed' && ['STAGE_6', 'STAGE_7'].includes(timelineEpisode?.currentStageCode ?? ''));
  const shownView = workView ?? (aftercareDefault ? 'aftercare' : 'plan');
  const currentStageDisplay = stageDisplay(timelineEpisode?.currentStageCode);
  async function chooseWorkView(view:'plan'|'aftercare'|'prostheses'){
    if(view===shownView||!await canLeaveWork())return;
    setWorkView(view);setRequestedAppointment(undefined);setEntryState({dirty:false,saving:false});
    const query=new URLSearchParams({view});if(activeEpisode)query.set('episodeId',activeEpisode.id);
    window.history.replaceState(null,'',`/patients/${patientId}/stages?${query}${view==='prostheses'?'#fogpotlasok':view==='aftercare'?'#gondozas':''}`);
  }
  useEffect(()=>{if(!entryState.dirty)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[entryState.dirty]);
  useEffect(() => {
    if (!requestedAppointment || !care) return;
    const appointment = care.appointments.find((a) => a.id === requestedAppointment);
    if (appointment?.episodeId) setSelectedEpisodeId(appointment.episodeId);
  }, [requestedAppointment, care]);
  const openTimelineStep = async (step: TimelineStep) => {
    if (step.appointmentId && (step.stepCode.startsWith('care:') || step.status === 'completed')) {
      await openCareVisit(step.appointmentId);
    } else if (step.appointmentId && step.status === 'booked') openAppointments(step.appointmentId);
    else await chooseWorkView('plan');
  };
  async function openCareVisit(appointmentId:string){
    if(shownView==='aftercare'&&requestedAppointment===appointmentId)return;
    if(!await canLeaveWork())return;
    const episodeId=care?.appointments.find(a=>a.id===appointmentId)?.episodeId??activeEpisode?.id;
    setRequestedAppointment(appointmentId);setWorkView('aftercare');setEntryState({dirty:false,saving:false});
    if(episodeId)setSelectedEpisodeId(episodeId);
    const query=new URLSearchParams({view:'aftercare',appointmentId});if(episodeId)query.set('episodeId',episodeId);
    window.history.replaceState(null,'',`/patients/${patientId}/stages?${query}#gondozas`);
  }
  useEffect(() => {
    if (workView === 'plan') document.getElementById('kezelesi-alkalmak')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (workView === 'aftercare' && requestedAppointment) document.getElementById('gondozas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (workView === 'prostheses') document.getElementById('fogpotlasok')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [workView, requestedAppointment]);
  const isDeceased = Boolean(patient?.halalDatum);
  const canEditEpisodeSettings = userRole === 'admin' || userRole === 'fogpótlástanász';
  const rawReason = activeEpisode?.reason ?? patient?.kezelesreErkezesIndoka ?? null;
  const patientReason =
    !rawReason ? undefined : (rawReason as 'traumás sérülés' | 'veleszületett rendellenesség' | 'onkológiai kezelés utáni állapot');
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
      title="Kezelés és gondozás"
      backTo={`/patients/${patientId}/view`}
      maxWidth="xl"
      actions={
        <Link
          href={`/treatment-plans?tplan_patient=${patientId}&tplan_status=all&tplan_view=merged`}
          aria-label="Várólista és idővonal"
          className="inline-flex shrink-0 items-center gap-2 px-2 py-2 sm:px-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
        >
          <BarChart3 className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Várólista és idővonal</span>
        </Link>
      }
    >
      {/* Állandó beteg-fejléc — ugyanaz, mint a beteg profilon */}
      <PatientHeaderBar
        patient={patient}
        currentStage={headerStage}
        canSeeNextStep={false}
        canAssignDoctor={userRole === 'admin' || userRole === 'fogpótlástanász'}
        onGoToScheduling={openAppointments}
      />

      {/* Közös fülsor a profillal — itt a „Kezelés menete" fül az aktív */}
      <PatientTabsNav patientId={patientId} activeTab="stadiumok" episodeId={activeEpisode?.id} onNavigate={async href=>{if(await canLeaveWork())router.push(href);}}/>

      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Kezelés, fogpótlások és gondozás</h1><p className="mt-1 text-sm text-slate-500">Közös idővonal az elkészítéstől az átadáson át a kontrollokig.</p></div><FormModeSwitch/></div>
        <section className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              {activeEpisode ? <>
                {selectableEpisodes.length > 1 ? <label className="block text-xs text-gray-500 dark:text-gray-400">Epizód kiválasztása
                  <select value={activeEpisode.id} onChange={async (e) => { const id = e.target.value;if(!await canLeaveWork())return; setSelectedEpisodeId(id); setWorkView(null); setRequestedAppointment(undefined);setEntryState({dirty:false,saving:false});const query=new URLSearchParams({episodeId:id});window.history.replaceState(null,'',`/patients/${patientId}/stages?${query}`); }} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                    {selectableEpisodes.map((ep) => <option key={ep.id} value={ep.id}>{ep.caseTitle || ep.chiefComplaint}{ep.status === 'closed' ? ' · Lezárt' : ep.status === 'paused' ? ' · Szünetel' : ''}</option>)}
                  </select>
                </label> : <>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{activeEpisode.status === 'open' ? 'Aktív epizód' : 'Korábbi epizód'}</p>
                  <h2 className="mt-0.5 font-semibold text-gray-900 dark:text-gray-100">{activeEpisode.caseTitle || activeEpisode.chiefComplaint}</h2>
                </>}
                {timelineEpisode?.currentStageCode && <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${currentStageDisplay.badge}`}>{timelineEpisode.currentStageLabel && timelineEpisode.currentStageLabel !== timelineEpisode.currentStageCode ? timelineEpisode.currentStageLabel : currentStageDisplay.label}</span>}
                {activeEpisode.chiefComplaint&&<p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">Indok: {activeEpisode.chiefComplaint}</p>}
                {activeEpisode.assignedProviderName && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Felelős orvos: {activeEpisode.assignedProviderName}</p>}
              </> : <p className="text-sm text-gray-500 dark:text-gray-400">{isDeceased ? 'Az ellátás lezárult.' : 'Nincs aktív kezelés.'}</p>}
            </div>
            <div className="flex items-center gap-4">
              {activeEpisode&&<Link href={episodeOverviewHref(patientId,activeEpisode.id)} onClick={async e=>{e.preventDefault();if(await canLeaveWork())router.push(episodeOverviewHref(patientId,activeEpisode.id));}} className="text-sm font-medium text-medical-primary underline">Epizód és terv megnyitása</Link>}
              {!activeEpisode&&!isDeceased&&<Link href={`${episodeOverviewHref(patientId)}?new=1`} className="inline-flex items-center gap-1 text-sm font-medium text-medical-primary"><Plus className="h-4 w-4"/>Új epizód indítása</Link>}
              {activeEpisode&&<button type="button" onClick={()=>setDetailsOpen(v=>!v)} aria-expanded={detailsOpen} className="inline-flex items-center gap-1 text-sm text-gray-500">Stádium módosítása<ChevronDown className={`h-4 w-4 ${detailsOpen?'rotate-180':''}`}/></button>}
            </div>
          </div>
          {detailsOpen&&activeEpisode&&<div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
            {useNewModel?<PatientStageStepper key={`stepper-${activeEpisode.id}`} episodeId={activeEpisode.id} currentStage={currentStage} onStageChanged={handleStageChanged} refreshTrigger={refreshKey} embedded/>:<PatientStageSelector patientId={patientId} currentStage={currentStage} onStageChanged={handleStageChanged} activeEpisodeId={activeEpisode.id} reason={patientReason} useNewModel={useNewModel}/>}
          </div>}
        </section>

          {activeEpisode && (
            <EpisodeObstaclesPanel
              key={`obstacles-${activeEpisode.id}`}
              compactEmpty
              episodeId={activeEpisode.id}
              onChanged={() => setSettingsVersion((version) => version + 1)}
            />
          )}

        {activeEpisode && <>
          {timelineEpisode && <PatientTreatmentJourney key={`journey-${activeEpisode.id}`} episode={timelineEpisode} care={care} serverNow={timeline.meta?.serverNow} onOpenStep={openTimelineStep} />}
          {timeline.error && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Az idővonal nem tölthető be. <button type="button" className="underline" onClick={() => setSettingsVersion((v) => v + 1)}>Újra</button></p>}
        </>}
        <div role="group" aria-label="Kezelési munkanézet" className="grid gap-2 sm:grid-cols-3">
          {([
            {id:'plan',title:'Kezelési alkalmak',hint:'Munkafázisok és időpontok',icon:CalendarClock},
            {id:'prostheses',title:'Fogpótlások',hint:'Készülékek, átadás és javítások',icon:ToothIcon},
            {id:'aftercare',title:'Gondozás / igazítás',hint:'Vizitek és visszarendelés',icon:HeartPulse},
          ] as const).map(item=><button key={item.id} type="button" aria-label={item.title} aria-pressed={shownView===item.id} disabled={!activeEpisode&&item.id!=='prostheses'} onClick={()=>{void chooseWorkView(item.id);}}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left disabled:opacity-40 sm:p-4 ${shownView===item.id?'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100':'border-slate-200 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'}`}>
            <item.icon className="h-6 w-6 shrink-0"/><span><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs opacity-70">{item.hint}</span></span>
          </button>)}
        </div>
        {phase==='mixed'&&<p className="text-xs text-amber-700 dark:text-amber-300">Készítés és gondozás párhuzamosan</p>}
        {activeEpisode&&(phase==='assessment'||phase==='planning')&&<Link href={episodeAnamnesisHref(patientId,activeEpisode.id)} className="inline-block text-sm text-medical-primary underline">Anamnézis és vizsgálati adatok</Link>}
        {shownView==='prostheses'?<section id="fogpotlasok" className="scroll-mt-24">
          <ProsthesisLifecycle key={`devices-${activeEpisode?.id??'all'}-${requestedAppointment??''}`} patientId={patientId} selectedEpisodeId={activeEpisode?.id} initialAppointmentId={requestedAppointment} embedded onStateChange={setEntryState} onOpenLegacyVisit={id=>{void openCareVisit(id);}} onSaved={()=>{setCareRetry(v=>v+1);refreshStagesAndEpisodes();setSettingsVersion(v=>v+1);}}/>
        </section>:activeEpisode&&<>
          {shownView === 'aftercare' ? <div id="gondozas" className="scroll-mt-24 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <button type="button" onClick={()=>{void chooseWorkView('prostheses');}} className="mb-4 text-sm font-medium text-medical-primary underline">Fogpótlások, javítások és gondozási előzmények</button>
            {care ? <PatientAftercare key={`aftercare-${activeEpisode.id}`} patientId={patientId} selectedEpisodeId={activeEpisode.id} embedded workspace={care} onStateChange={setEntryState} initialAppointmentId={requestedAppointment} onWorkspaceChanged={handleCareChanged} onRequestScheduling={() => { setRecallOpen(true); openAppointments(); }} />
              : careError ? <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{careError} <button type="button" className="underline" onClick={() => setCareRetry((v) => v + 1)}>Újrapróbálás</button></p>
                : <p role="status" className="text-sm text-gray-500">Gondozási adatok betöltése…</p>}
          </div> : <div id="kezelesi-alkalmak" className="scroll-mt-24 space-y-3">
          {activeEpisode?.status === 'open' ? (
            <EpisodeStepsManager
              // Egyedi kulcs: a testvér EpisodeRecallPanel ugyanezt az epizód-id-t
              // használta kulcsnak, és a duplikált key újrarendereléskor árva
              // (duplikált) kártya-példányokat hagyott a DOM-ban.
              key={`plan-${activeEpisode.id}`}
              presentation="workspace"
              onManageAppointments={openAppointments}
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
              canEditProvider={false}
              canEditPalette={canEditEpisodeSettings}
              onProviderChanged={() => {
                // A felelős orvos váltása az epizód adata: a kártya-fejléc, a
                // foglalási motor (worklist, intentek) és a stádium-javaslat is frissül.
                refreshStagesAndEpisodes();
                setSettingsVersion((v) => v + 1);
              }}
              refreshTrigger={settingsVersion}
              onStepChanged={refreshStagesAndEpisodes}
            />
          ) : <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-900">Lezárt kezelés · az alkalmak az idővonalon és az előzményekben érhetők el.</p>}
          </div>}
        </>}

        <div className="space-y-2">
          <WorkspaceSection id="gyors-foglalas" title="Összes időpont · státusz és egyéb foglalás" open={appointmentsOpen} onToggle={() => setAppointmentsOpen((v) => !v)}>
            <AppointmentBookingSection patientId={patientId} episodeId={activeEpisode?.id ?? null} pool={activeEpisode ? 'work' : undefined} isViewOnly={false} standalone openStatusAppointmentId={statusAppointmentId} onStatusOpened={handleStatusOpened} />
            {userRole === 'admin' && <div className="mt-4"><ConditionalAppointmentOffers patientId={patientId} patientEmail={patient.email || null} /></div>}
          </WorkspaceSection>
          {activeEpisode && <WorkspaceSection title="Kontroll és visszarendelés" open={recallOpen} onToggle={() => setRecallOpen((v) => !v)}>
            <EpisodeRecallPanel key={`recall-${activeEpisode.id}`} episodeId={activeEpisode.id} patientId={patientId} />
          </WorkspaceSection>}
          <WorkspaceSection title="Beteghez kapcsolódó feladatok" open={tasksOpen} onToggle={() => setTasksOpen((v) => !v)}>
            <PatientQuickTaskBlock patientId={patientId} />
          </WorkspaceSection>
          <WorkspaceSection title="Ellátási előzmények" open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)}>
            <PatientCareTimeline key={refreshKey} patientId={patientId} onRefresh={handleStageChanged} canEditStageStart={userRole === 'admin'} />
          </WorkspaceSection>
        </div>
      </div>
    </AppShell>
  );
}
