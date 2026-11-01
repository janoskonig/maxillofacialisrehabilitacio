'use client';

import { useCallback,useEffect,useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight,ClipboardList,Plus } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import type { Patient,PatientEpisode } from '@/lib/types';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import type { EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';
import { episodeDevices,episodeOverviewHref,EPISODE_TRIGGER_LABELS,selectEpisode,type EpisodeContext } from '@/lib/episode-overview';
import { financingAt,financingSummary,formatFinancingAmount } from '@/lib/episode-financing/model';
import { budapestToday,PROSTHESIS_TYPES } from '@/lib/aftercare/model';
import { useToast } from '@/contexts/ToastContext';
import { PatientHeaderBar } from '@/components/PatientHeaderBar';
import { PatientTabsNav } from '@/components/PatientTabsNav';
import { PatientEpisodeForm } from '@/components/PatientEpisodeForm';
import { EpisodeProviderControl } from '@/components/EpisodeProviderControl';
import { EpisodePathwayEditor } from '@/components/EpisodePathwayEditor';
import { EpisodeTreatmentPlanEditor } from '@/components/EpisodeTreatmentPlanEditor';
import { ClinicalEntryForm } from '@/components/prosthesis-lifecycle/ClinicalEntryForm';
import { FormModeSwitch,useClinicalFormMode } from '@/components/prosthesis-lifecycle/FormMode';
import { primaryButton,secondaryButton } from '@/components/prosthesis-lifecycle/WorkflowForm';
import { EpisodeContextEditor } from './EpisodeContextEditor';
import { EpisodeClinicalReviewPanel } from './EpisodeClinicalReviewPanel';
import { OHIP14Section } from '@/components/OHIP14Section';

async function read<T>(url:string,signal?:AbortSignal):Promise<T>{const response=await fetch(url,{credentials:'include',cache:'no-store',signal});const result=await response.json();if(!response.ok)throw new Error(result.error||'Az epizód adatai nem tölthetők be.');return result;}
const idle={dirty:false,saving:false};
const statusLabel:Record<string,string>={open:'Folyamatban',closed:'Lezárt',paused:'Szünetel'};
const day=(value:string)=>new Intl.DateTimeFormat('hu-HU',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

export function PatientEpisodeWorkspace({patientId,initialEpisodeId,initiallyEditing=false,initiallyCreating=false}:{patientId:string;initialEpisodeId?:string;initiallyEditing?:boolean;initiallyCreating?:boolean}){
  const router=useRouter(),{confirm,showToast}=useToast(),{expert}=useClinicalFormMode();
  const [patient,setPatient]=useState<Patient|null>(null),[episodes,setEpisodes]=useState<PatientEpisode[]>([]),[data,setData]=useState<ClinicalWorkspace|null>(null),[role,setRole]=useState('');
  const [selected,setSelected]=useState<string|null>(initialEpisodeId??null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [editing,setEditing]=useState(initiallyEditing),[creating,setCreating]=useState(initiallyCreating),[clinicalAction,setClinicalAction]=useState<'register'|'status'>('register'),[registering,setRegistering]=useState(false),[registrationDirty,setRegistrationDirty]=useState(false),[registrationSaving,setRegistrationSaving]=useState(false),[planRefresh,setPlanRefresh]=useState(0);
  const [creationState,setCreationState]=useState(idle),[contextState,setContextState]=useState(idle),[clinicalState,setClinicalState]=useState(idle),[planState,setPlanState]=useState(idle),[records,setRecords]=useState<Record<string,EpisodeTreatmentPlanRecord>>({});
  const dirty=creationState.dirty||contextState.dirty||clinicalState.dirty||planState.dirty||registrationDirty;
  const saving=creationState.saving||contextState.saving||clinicalState.saving||planState.saving||registrationSaving;
  const canEdit=role==='admin'||role==='fogpótlástanász';
  const active=data?selectEpisode(episodes,data,selected):null;
  const load=useCallback(async(signal?:AbortSignal)=>{
    const [profile,ep,clinical]=await Promise.all([read<{patient:Patient}>(`/api/patients/${patientId}`,signal),read<{episodes:PatientEpisode[]}>(`/api/patients/${patientId}/episodes`,signal),read<ClinicalWorkspace>(`/api/patients/${patientId}/prosthesis-lifecycle`,signal)]);
    if(!signal?.aborted){setPatient(profile.patient);setEpisodes(ep.episodes);setData(clinical);setError('');}
  },[patientId]);
  useEffect(()=>{
    const controller=new AbortController();
    void(async()=>{try{const user=await getCurrentUser();if(controller.signal.aborted)return;if(!user){router.push('/login');return;}if(!['admin','fogpótlástanász','beutalo_orvos'].includes(user.role)){router.push(`/patients/${patientId}/view`);return;}setRole(user.role);await load(controller.signal);}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted)setLoading(false);}})();
    return()=>controller.abort();
  },[load,patientId,router]);
  useEffect(()=>{if(expert)setEditing(true);},[expert]);
  useEffect(()=>{setSelected(initialEpisodeId??null);},[initialEpisodeId]);
  useEffect(()=>{const open=()=>{if(initiallyEditing||window.location.hash==='#kezelesi-terv'||window.location.hash==='#finanszirozas')setEditing(true);};open();window.addEventListener('hashchange',open);return()=>window.removeEventListener('hashchange',open);},[initiallyEditing]);
  useEffect(()=>{if(!dirty)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
  const recordChanged=useCallback((record:EpisodeTreatmentPlanRecord)=>setRecords(previous=>previous[record.episodeId]===record?previous:{...previous,[record.episodeId]:record}),[]);
  async function canLeave(){if(saving)return false;return !dirty||await confirm('Az epizód módosításai még nincsenek mentve. Elveted őket és továbblépsz?');}
  async function choose(id:string){
    if(!await canLeave())return;
    setSelected(id);setRegistering(false);setRegistrationDirty(false);setContextState(idle);setClinicalState(idle);setPlanState(idle);setEditing(expert);setCreating(false);setError('');
    window.history.replaceState(null,'',episodeOverviewHref(patientId,id));
  }
  function contextSaved(context:EpisodeContext){setEpisodes(items=>items.map(e=>e.id===active?.id?{...e,...context}:e));}
  async function refreshEpisodes(){try{const result=await read<{episodes:PatientEpisode[]}>(`/api/patients/${patientId}/episodes`);setEpisodes(result.episodes);}catch(e){setError((e as Error).message);}}
  async function register(body:unknown){
    setRegistrationSaving(true);setError('');
    try{const response=await fetch(`/api/patients/${patientId}/prosthesis-lifecycle`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'A fogpótlás nem rögzíthető.');await load();setRegistering(false);setRegistrationDirty(false);setPlanRefresh(v=>v+1);showToast((body as any).action==='register'?'A fogpótlás ehhez az epizódhoz kapcsolva.':'Vizsgálati állapot rögzítve. A tervnél válaszd ki kiindulásként.','success');}catch(e){setError((e as Error).message);}finally{setRegistrationSaving(false);}
  }
  async function closeRegistration(){if(registrationSaving)return;if(registrationDirty&&!await confirm('A kitöltött klinikai adatok még nincsenek mentve. Elveted őket?'))return;setRegistering(false);setRegistrationDirty(false);}

  if(loading)return <p role="status" className="p-4">Epizódok betöltése…</p>;
  if(!patient||!data)return <div role="alert" className="rounded-xl border p-4">{error||'Az epizód adatai nem érhetők el.'}<button type="button" className="ml-3 underline" onClick={()=>load().catch(e=>setError(e.message))}>Újrapróbálás</button></div>;
  const devices=active?episodeDevices(data,active.id):[];
  const cached=active?records[active.id]:null;
  const plan=cached??data.episodePlans.find(p=>p.episodeId===active?.id);
  const finance=active?(cached?.financing?.current??financingAt(data.financingEvents.filter(f=>f.episode_id===active.id),budapestToday(),plan?.clinicalPlan?.id??null)):undefined;
  const baseline=cached?.states?.find(s=>s.id===plan?.clinicalPlan?.baselineStateId)??data.states.find(s=>s.id===plan?.clinicalPlan?.baselineStateId);
  const repair=data.repairs.find(r=>r.episode_id===active?.id);
  const parent=episodes.find(e=>e.id===active?.parentEpisodeId);
  const related=active?episodes.filter(e=>e.id!==active.id&&(e.id===active.parentEpisodeId||e.parentEpisodeId===active.id||!!active.parentEpisodeId&&e.parentEpisodeId===active.parentEpisodeId)):[];
  const isDeceased=!!patient.halalDatum;
  const actualReason=active?.chiefComplaint?.trim();
  const nameOnly=!!actualReason&&actualReason===active?.caseTitle?.trim();

  return <div className="space-y-4">
    <PatientHeaderBar patient={patient} currentStage={null} canSeeNextStep={false} canAssignDoctor={canEdit} onGoToScheduling={async()=>{if(await canLeave())router.push(`/patients/${patientId}/stages${active?`?episodeId=${active.id}`:''}#gyors-foglalas`);}}/>
    <PatientTabsNav patientId={patientId} activeTab="epizod" episodeId={active?.id} onNavigate={async href=>{if(await canLeave())router.push(href);}}/>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Epizód és terv</h1><p className="mt-1 text-sm text-slate-500">Miért indult az ellátás, mit készítünk és milyen finanszírozással?</p></div><FormModeSwitch/></div>
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-medium">Epizód kiválasztása<select className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900" aria-label="Epizód kiválasztása" value={active?.id??''} onChange={e=>{void choose(e.target.value);}}><option value="" disabled>Válassz epizódot…</option>{episodes.map(e=><option key={e.id} value={e.id}>{e.caseTitle||e.chiefComplaint||'Névtelen epizód'} · {statusLabel[e.status]} · {day(e.openedAt)}</option>)}</select></label>{!isDeceased&&<button type="button" disabled={saving} className={secondaryButton} onClick={async()=>{if(await canLeave())setCreating(true);}}><Plus className="h-4 w-4"/>Új epizód</button>}</div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {creating&&<div className="rounded-2xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-950"><PatientEpisodeForm patientId={patientId} embedded onStateChange={setCreationState} onClose={()=>setCreating(false)} onEpisodeCreated={episode=>{setSelected(episode.id);setEditing(expert);setRecords({});window.history.replaceState(null,'',episodeOverviewHref(patientId,episode.id));void load().catch(e=>setError(e.message));}}/></div>}
    {!active?<div className="rounded-2xl border border-dashed p-6 text-sm text-slate-500">{selected?'A hivatkozott epizód nem található ennél a betegnél. Válassz a fenti listából.':'Még nincs epizód. Új epizód indításakor először az ellátás indokát adod meg, majd ehhez kapcsolhatod a tervezett fogpótlást.'}</div>:<>
      <section aria-label="Az epizód áttekintése" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{statusLabel[active.status]}</span><span className="py-1 text-slate-500">Indítás: {day(active.openedAt)}{active.closedAt&&` · lezárás: ${day(active.closedAt)}`}</span></div><h2 className="text-lg font-semibold">{active.caseTitle||'Ellátási epizód'}</h2></div><Link href={`/patients/${patientId}/stages?episodeId=${active.id}`} onClick={async e=>{e.preventDefault();if(await canLeave())router.push(`/patients/${patientId}/stages?episodeId=${active.id}`);}} className={primaryButton}>Kezelés megnyitása<ArrowRight className="h-4 w-4"/></Link></div>
        <dl className="mt-5 grid gap-4 md:grid-cols-2"><div><dt className="text-sm font-semibold">Miért indult ez az epizód?</dt><dd className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{actualReason||'Az indítás konkrét oka még nincs rögzítve.'}</dd>{nameOnly&&<p className="mt-2 text-xs text-amber-700">A megnevezés és az indok megegyezik. A konkrét ellátási ok az alapadatoknál pontosítható.</p>}</div><div><dt className="text-sm font-semibold">Az ellátás alapjául szolgáló állapot</dt><dd className="mt-2 text-sm capitalize">{active.reason}</dd><dt className="mt-3 text-xs text-slate-500">Indító esemény</dt><dd className="mt-1 text-sm">{active.triggerType?EPISODE_TRIGGER_LABELS[active.triggerType]:'Nincs megadva'}</dd></div></dl>
        {parent&&<div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800"><p>Előzmény: <button type="button" className="underline" onClick={()=>choose(parent.id)}>{parent.caseTitle||parent.chiefComplaint}</button></p>{nameOnly&&parent.chiefComplaint&&<p className="mt-1">Az előzményben rögzített panasz / indok: {parent.chiefComplaint}</p>}</div>}
      </section>
      <EpisodeClinicalReviewPanel key={`clinical-${active.id}`} patientId={patientId} episodeId={active.id} canEdit={['admin','fogpótlástanász','beutalo_orvos'].includes(role)} states={data.states} onStateChange={setClinicalState} onSaved={()=>{void refreshEpisodes();}}/>
      <details className="rounded-2xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-950"><summary className="cursor-pointer text-sm font-medium">Az epizód életminőség-felmérései · OHIP-14</summary><div className="mt-3"><OHIP14Section key={`ohip-${active.id}`} patientId={patientId} episodeId={active.id} isViewOnly={!canEdit}/></div></details>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <section aria-label="Az epizód fogpótlása" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950 lg:col-span-2"><h3 className="font-semibold">{repair?'Melyik fogpótlást javítjuk?':'Milyen fogpótlást tervezünk?'}</h3>
          {devices.length?devices.map(p=><article key={p.id} className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><p className="font-semibold">{p.label}</p><p className="mt-1 text-sm">{p.jaw==='felso'?'Felső':'Alsó'} állcsont · {p.role==='provisional'?'Ideiglenes':p.role==='definitive'?'Végleges':'Szerepe nem ismert'} · {PROSTHESIS_TYPES[p.prosthesis_type as keyof typeof PROSTHESIS_TYPES]??p.prosthesis_type}</p><p className="mt-1 text-xs text-slate-500">{repair?'A meglévő készülék javítási epizódja':p.origin==='external'?'Máshol készült készülék':p.origin==='local'?'Ebben az epizódban készül / készült':'Eredete nem ismert'}{p.mapping_review_required?' · korábbi megfeleltetés ellenőrizendő':''}</p><Link className="mt-2 inline-block text-xs underline" href={`/patients/${patientId}/prostheses?episodeId=${active.id}`}>Készülék és gondozási előzmények</Link></article>):<><p className="mt-3 text-sm text-slate-500">Még nincs ehhez az epizódhoz kapcsolt fogpótlás.</p>{canEdit&&active.status==='open'&&!isDeceased&&<button type="button" className={`${secondaryButton} mt-3`} disabled={dirty||saving||registering} onClick={()=>{setClinicalAction('register');setRegistering(true);}}><Plus className="h-4 w-4"/>Fogpótlás megadása ehhez az epizódhoz</button>}{dirty&&<p className="mt-2 text-xs text-slate-500">Előbb mentsd az epizód vagy a terv módosításait.</p>}</>}
          {(plan?.treatmentPlanUpper||plan?.treatmentPlanLower||plan?.treatmentPlan)&&<div className="mt-4 border-t border-slate-100 pt-3 text-sm dark:border-slate-800"><p className="font-medium">Rögzített kezelési terv{plan.clinicalPlan?` · ${plan.clinicalPlan.version}. változat · ${plan.clinicalPlan.approved?'klinikailag jóváhagyott':'tervezet'}`:''}</p>{plan.jaw!=='also'&&plan.treatmentPlanUpper&&<p className="mt-2 whitespace-pre-wrap">{plan.treatmentPlanUpper}</p>}{plan.jaw!=='felso'&&plan.treatmentPlanLower&&<p className="mt-2 whitespace-pre-wrap">{plan.treatmentPlanLower}</p>}{!plan.treatmentPlanUpper&&!plan.treatmentPlanLower&&plan.treatmentPlan&&<p className="mt-2 whitespace-pre-wrap">{plan.treatmentPlan}</p>}</div>}
          {repair&&!plan?.clinicalPlan&&<p className="mt-3 whitespace-pre-wrap text-sm">Javítás indításakor rögzített terv: {repair.plan}</p>}
          <p className="mt-3 text-xs text-slate-500">Kiindulási vizsgálat: {baseline?`${baseline.occurred_on} · ${baseline.source}`:'Még nincs a tervhez kapcsolva'}</p>{canEdit&&!baseline&&<button type="button" disabled={dirty||saving||registering} className="mt-2 text-sm font-medium underline disabled:opacity-40" onClick={()=>{setClinicalAction('status');setRegistering(true);}}>Kiindulási vizsgálat rögzítése</button>}
        </section>
        <div className="space-y-4"><section aria-label="Az epizód finanszírozásának összefoglalója" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950"><h3 className="font-semibold">Finanszírozás</h3><p className="mt-3 text-sm">{financingSummary(finance)}</p>{finance?.event&&<><p className="mt-2 text-sm">Beteg terhe: <strong>{formatFinancingAmount(finance.event.patient_amount,finance.event.currency)}</strong></p><p className="mt-1 text-xs text-slate-500">Érvényes: {finance.event.effective_on}-tól</p></>}</section><section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950"><h3 className="mb-3 font-semibold">Ki felel az ellátásért?</h3><EpisodeProviderControl episodeId={active.id} patientId={patientId} assignedProviderId={active.assignedProviderId??null} assignedProviderName={active.assignedProviderName??null} canEdit={canEdit} onChanged={()=>{void refreshEpisodes();}} compact/></section></div>
      </div>
      {registering&&<ClinicalEntryForm key={`${clinicalAction}-${active.id}`} data={{...data,episodes:data.episodes.filter(e=>e.id===active.id)}} initial={clinicalAction==='register'?{action:'register',episodeId:active.id,episodeMode:'existing',origin:'local'}:{action:'status',episodeId:active.id,mode:'assessment'}} onSave={register} onCancel={()=>{void closeRegistration();}} onDirtyChange={setRegistrationDirty} busy={registrationSaving}/>}
      {<div className="flex flex-wrap items-center gap-3"><button type="button" className={secondaryButton} disabled={saving||registering} onClick={async()=>{if(editing&&!await canLeave())return;setEditing(v=>!v);}}><ClipboardList className="h-4 w-4"/>{editing?'Részletek bezárása':canEdit?'Epizód, terv és finanszírozás szerkesztése':'Részletes terv és előzmények'}</button>{dirty&&<span role="status" className="text-xs text-amber-700">Nem mentett epizódadatok</span>}</div>}
      {(editing||!canEdit&&expert)&&<div className="space-y-4" id="epizod-szerkesztes">{canEdit&&<EpisodeContextEditor key={`context-${active.id}`} episode={active} onSaved={contextSaved} onStateChange={setContextState}/>}<div id="kezelesi-terv" className="scroll-mt-24"><EpisodeTreatmentPlanEditor key={`plan-${active.id}-${planRefresh}`} episodeId={active.id} canEdit={canEdit} unified onStateChange={setPlanState} onRecordChange={recordChanged}/></div>{canEdit&&<details className="rounded-2xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-950" open={expert}><summary className="cursor-pointer text-sm font-medium">Elkészítési munkafázisok sablonja</summary><div className="mt-3"><EpisodePathwayEditor episodeId={active.id} patientId={patientId} carePathwayId={active.carePathwayId} carePathwayName={active.carePathwayName} treatmentTypeId={active.treatmentTypeId} onSaved={()=>{void refreshEpisodes();}} compact/></div></details>}</div>}
      {!!related.length&&<section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950"><h3 className="text-sm font-semibold">Kapcsolódó epizódok</h3><p className="mt-1 text-xs text-slate-500">A másik állcsont, az ideiglenes készülék és a javítás saját epizódban követhető.</p><div className="mt-3 space-y-2">{related.map(e=><button key={e.id} type="button" className="block w-full rounded-xl bg-slate-50 p-3 text-left text-sm dark:bg-slate-900" onClick={()=>choose(e.id)}>{e.caseTitle||e.chiefComplaint} · {statusLabel[e.status]}</button>)}</div></section>}
    </>}
  </div>;
}
