'use client';

import { useState, type FormEvent } from 'react';
import { FOLLOWUP_STATUSES, budapestToday, observationEnd, type Prosthesis, type followupSchema } from '@/lib/aftercare/model';
import type { z } from 'zod';
import { Field, inputClass, Options, Rating } from './Fields';

export function FollowupForm({ prosthesis, busy, onSave, onCancel }: {
  prosthesis: Prosthesis; busy: boolean; onSave: (value: z.infer<typeof followupSchema>) => Promise<void>; onCancel: () => void;
}) {
  const [value, setValue] = useState<z.infer<typeof followupSchema>>({ action: 'followup', prosthesisId: prosthesis.id,
    assessedOn: budapestToday(), status: 'unknown', contactMethod: 'record_review', unresolved: null,
    functionScore: null, comfortScore: null, note: '',
  });
  const set = <K extends keyof typeof value>(key: K, v: typeof value[K]) => setValue((prev) => ({ ...prev, [key]: v }));
  const unknown = value.status === 'unknown';
  function submit(e: FormEvent) { e.preventDefault(); void onSave(value); }
  return <form onSubmit={submit} className="space-y-4" aria-label="Háromhavi követés">
    <h2 className="font-semibold">Háromhavi követés · {prosthesis.label}</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Követés állapota"><select className={inputClass} value={value.status} onChange={(e) => {
        const status = e.target.value as typeof value.status;
        setValue((v) => ({ ...v, status, unresolved: status === 'comfortable' ? false : status === 'ongoing_problem' ? true : null,
          functionScore: null, comfortScore: null,
          contactMethod: ['comfortable', 'ongoing_problem'].includes(status) ? 'phone' : 'record_review' }));
      }}><Options options={FOLLOWUP_STATUSES} /></select></Field>
      <Field label="Információ forrása"><select className={inputClass} value={value.contactMethod} onChange={(e) => set('contactMethod', e.target.value as typeof value.contactMethod)}>
        <option value="in_person">Személyes vizit</option><option value="phone">Telefon</option><option value="portal">Betegportál</option>
        {!['comfortable', 'ongoing_problem'].includes(value.status) && <option value="record_review">Karton áttekintése / elérési kísérlet</option>}
      </select></Field>
    </div>
    <details><summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400">Megjegyzés és további adatok</summary>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      <Field label="Felmérés dátuma"><input type="date" required className={inputClass} min={observationEnd(prosthesis.deliveryDate!)} max={budapestToday()}
        value={value.assessedOn} onChange={(e) => set('assessedOn', e.target.value)} /></Field>
      {!['comfortable', 'ongoing_problem', 'unknown'].includes(value.status) && <Field label="Fennálló probléma"><select className={inputClass} value={value.unresolved === null ? '' : String(value.unresolved)}
        disabled={unknown || ['comfortable', 'ongoing_problem'].includes(value.status)}
        onChange={(e) => set('unresolved', e.target.value === '' ? null : e.target.value === 'true')}>
        <option value="">Nem ismert</option><option value="false">Nincs</option><option value="true">Van</option></select></Field>}
      {!unknown && <><Rating label="Funkció" value={value.functionScore} onChange={(v) => set('functionScore', v)} />
        <Rating label="Komfort" value={value.comfortScore} onChange={(v) => set('comfortScore', v)} /></>}
    </div>
    <Field label="Rövid megjegyzés (opcionális)"><textarea className={inputClass} maxLength={1000} value={value.note} onChange={(e) => set('note', e.target.value)} /></Field>
    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Funkció és komfort: 0 = legrosszabb, 10 = legjobb.</p>
    </details>
    <div className="flex gap-2"><button disabled={busy} className="btn-primary">{busy ? 'Mentés…' : 'Mentés'}</button><button type="button" className="btn-secondary" onClick={onCancel}>Mégse</button></div>
  </form>;
}
