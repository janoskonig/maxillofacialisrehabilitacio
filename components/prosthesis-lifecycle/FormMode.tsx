'use client';

import { useEffect, useState } from 'react';

type FormMode='guided'|'expert';
const key='clinical-form-mode';
const eventName='clinical-form-mode-changed';
export function useClinicalFormMode(){
  const [mode,setMode]=useState<FormMode>('guided');
  useEffect(()=>{
    const read=()=>{try{setMode(window.localStorage.getItem(key)==='expert'?'expert':'guided');}catch{/* A private browser may disallow persistence. */}};
    const changed=(e:Event)=>{const next=(e as CustomEvent<FormMode>).detail;if(next==='guided'||next==='expert')setMode(next);};
    const storage=(e:StorageEvent)=>{if(e.key===key||e.key===null)read();};
    read();window.addEventListener(eventName,changed);window.addEventListener('storage',storage);
    return()=>{window.removeEventListener(eventName,changed);window.removeEventListener('storage',storage);};
  },[]);
  function change(next:FormMode){
    setMode(next);try{window.localStorage.setItem(key,next);}catch{/* The preference still applies to mounted forms. */}
    window.dispatchEvent(new CustomEvent(eventName,{detail:next}));
  }
  return {expert:mode==='expert',mode,setMode:change};
}

export function FormModeSwitch(){
  const {mode,setMode}=useClinicalFormMode();
  return <div role="group" aria-label="Kitöltési mód" className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
    <span className="px-2 text-xs text-slate-500">Kitöltés</span>
    {([{id:'guided',label:'Vezetett'},{id:'expert',label:'Szakértői'}] as const).map(option=><button key={option.id} type="button" aria-pressed={mode===option.id} onClick={()=>setMode(option.id)} className={`rounded-lg px-3 py-2 text-xs ${mode===option.id?'bg-white font-semibold text-blue-800 shadow-sm dark:bg-slate-700 dark:text-blue-100':'text-slate-500 dark:text-slate-400'}`}>{option.label}</button>)}
  </div>;
}
