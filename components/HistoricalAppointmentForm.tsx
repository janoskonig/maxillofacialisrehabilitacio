'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { budapestToday } from '@/lib/aftercare/model';
import { APPOINTMENT_TYPE_OPTIONS } from '@/lib/appointment-constants';
type Options={clinicians:Array<{id:string;email:string;name:string}>;episodes:Array<{id:string;label:string;status:string}>;appointments:Array<{id:string;day:string;status:string|null}>};
const input='block w-full rounded border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900';
export function HistoricalAppointmentForm({patientId,episodeId,onSaved,onCancel}:{patientId:string;episodeId?:string|null;onSaved:(id:string)=>void|Promise<void>;onCancel:()=>void}){
  const [options,setOptions]=useState<Options|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [key]=useState(()=>crypto.randomUUID()),[date,setDate]=useState(budapestToday()),[time,setTime]=useState(''),[exact,setExact]=useState(false);
  const [clinicianId,setClinicianId]=useState(''),[episode,setEpisode]=useState(episodeId??''),[type,setType]=useState('munkafazis');
  const [source,setSource]=useState('Korabeli karton'),[notes,setNotes]=useState(''),[minutes,setMinutes]=useState(''),[existing,setExisting]=useState('');
  const url=`/api/patients/${patientId}/historical-appointments`;
  useEffect(()=>{let alive=true;fetch(url,{cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);if(alive){setOptions(data);if(data.clinicians.length===1)setClinicianId(data.clinicians[0].id);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[url]);
  async function save(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const body={requestKey:key,occurredOn:date,precision:exact?'exact':'day',occurredAt:exact?new Date(`${date}T${time}`).toISOString():null,
        clinicianId,episodeId:episode||null,appointmentType:type,clinicalMinutes:minutes?Number(minutes):null,source,notes,existingAppointmentId:existing||null};
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();
      if(!response.ok)throw new Error(result.error||'Az időpont nem rögzíthető');
      await onSaved(result.appointmentId);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <form className="my-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3 dark:bg-gray-950" onSubmit={save} aria-label="Korábbi megtörtént időpont felvétele">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">Korábbi megtörtént időpont felvétele</h3><button type="button" onClick={onCancel}>Bezárás</button></div>
    <p className="text-sm">A beteg időpontlistájában és a naptárban is megjelenik. Az elvégzett munkát ezután ehhez az időponthoz dokumentálhatja.</p>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {!options?<p role="status">Adatok betöltése…</p>:<>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">Mikor történt?<input className={input} required type="date" max={budapestToday()} value={date} onChange={e=>{setDate(e.target.value);setExisting('');}}/></label>
        <label className="text-sm">Ellátó orvos<select className={input} required value={clinicianId} onChange={e=>setClinicianId(e.target.value)}><option value="">Válasszon</option>{options.clinicians.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-sm">Epizód<select className={input} value={episode} onChange={e=>setEpisode(e.target.value)}><option value="">Általános vizit / nincs kijelölt epizód</option>{options.episodes.map(ep=><option key={ep.id} value={ep.id}>{ep.label} ({ep.status})</option>)}</select></label>
        <label className="text-sm">Ellátás típusa<select className={input} value={type} onChange={e=>setType(e.target.value)}>{APPOINTMENT_TYPE_OPTIONS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
      </div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={exact} onChange={e=>setExact(e.target.checked)}/>A pontos óra és perc is ismert</label>
      {exact&&<label className="block text-sm">Tényleges kezdés<input type="time" className={input} required value={time} onChange={e=>setTime(e.target.value)}/></label>}
      <label className="block text-sm">Már meglévő időponthoz kapcsolás<select className={input} value={existing} onChange={e=>setExisting(e.target.value)}><option value="">Új korábbi időpont létrehozása</option>{options.appointments.filter(a=>a.day===date).map(a=><option key={a.id} value={a.id}>{a.day} · {a.status||'nincs kimenetel'}</option>)}</select></label>
      <label className="block text-sm">Klinikai idő percben, ha ismert<input type="number" className={input} min={1} max={1440} value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
      <label className="block text-sm">Dokumentálás forrása<input className={input} required maxLength={500} value={source} onChange={e=>setSource(e.target.value)}/></label>
      <label className="block text-sm">Megjegyzés<textarea className={input} rows={2} maxLength={10000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      <p className="text-xs text-gray-600 dark:text-gray-300">Megtörténtként kerül a kartonba. A mai rögzítési idő és a rögzítő neve külön megmarad.</p>
      <button type="submit" disabled={busy} className="rounded bg-blue-700 text-white px-4 py-2 disabled:opacity-50">{busy?'Mentés…':'Korábbi időpont mentése'}</button>
    </>}
  </form>;
}
