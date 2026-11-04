'use client';

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useForm } from 'react-hook-form';
import type { Patient } from '@/lib/types';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import { clinicalTemplate, DENTAL_FIELDS, type EpisodeClinicalContent, type EpisodeDentalStatus } from '@/lib/episode-clinical/model';
import { canonical } from '@/lib/prosthesis-lifecycle/model';
import { AnamnezisSection } from '@/components/patient-form/AnamnezisSection';
import { BetegvizsgalatSection } from '@/components/patient-form/BetegvizsgalatSection';
import { ImplantatumokSection } from '@/components/patient-form/ImplantatumokSection';
import { Odontogram } from '@/components/patient-form/odontogram/Odontogram';
import { existingTypes } from '@/lib/prosthesis-types';

function formPatient(content?: EpisodeClinicalContent, dental?: EpisodeDentalStatus): Patient {
  const snapshot = content?.dental ?? dental;
  return {
    ...content?.basics, ...content?.anamnesis, ...snapshot,
    kezelesreErkezesIndoka: content?.reason,
    meglevoFogak: snapshot?.meglevoFogak ?? {},
    meglevoImplantatumok: snapshot?.meglevoImplantatumok ?? {},
  } as Patient;
}

/** The familiar chart controls edit the episode draft, never the shared patient record. */
export function EpisodeClinicalFields({ content, dental, onChange, readOnly = false, dentalOnly = false }: {
  content?: EpisodeClinicalContent;
  dental?: EpisodeDentalStatus;
  onChange?: (content: EpisodeClinicalContent) => void;
  readOnly?: boolean;
  dentalOnly?: boolean;
}) {
  const form = useForm<Patient>({ defaultValues: formPatient(content, dental) });
  const { register, watch, setValue, getValues, reset } = form;
  const contentRef = useRef(content);
  const onChangeRef = useRef(onChange);
  const published = useRef(canonical(content ?? dental));
  const resetting = useRef(false);
  const disabled = readOnly || !onChange;
  onChangeRef.current = onChange;

  useEffect(() => {
    contentRef.current = content;
    if (canonical(content ?? dental) !== published.current) {
      resetting.current = true;
      reset(formPatient(content, dental));
      resetting.current = false;
      published.current = canonical(content ?? dental);
    }
  }, [content, dental, reset]);

  useEffect(() => {
    if (disabled) return;
    const subscription = watch((_values, { name }) => {
      if (resetting.current || !name) return;
      const patient = getValues();
      const mapped = clinicalTemplate(patient, patient.kezelesreErkezesIndoka as EpisodeClinicalContent['reason']);
      const original = contentRef.current;
      if (!original) return;
      const key = name.split('.')[0];
      let next = original;
      if (key === 'kezelesreErkezesIndoka') next = { ...original, reason: mapped.reason };
      else if (key in original.basics) next = { ...original, basics: { ...original.basics, [key]: mapped.basics[key as keyof typeof mapped.basics] } };
      else if (key in original.anamnesis) next = { ...original, anamnesis: { ...original.anamnesis, [key]: mapped.anamnesis[key as keyof typeof mapped.anamnesis] } };
      else if (DENTAL_FIELDS.some(field => field === key)) {
        const field = key as typeof DENTAL_FIELDS[number];
        next = { ...original, dental: { ...(original.dental ?? mapped.dental!), [field]: mapped.dental![field] } };
      } else return;
      published.current = canonical(next);
      contentRef.current = next;
      onChangeRef.current?.(next);
    });
    return () => subscription.unsubscribe();
  }, [disabled, getValues, watch]);

  const fogak = watch('meglevoFogak') ?? {};
  const implants = watch('meglevoImplantatumok') ?? {};
  const setFogak: Dispatch<SetStateAction<Record<string, ToothStatus>>> = update => {
    if (disabled) return;
    const current = getValues('meglevoFogak') ?? {};
    setValue('meglevoFogak', typeof update === 'function' ? update(current) : update, { shouldDirty: true });
  };

  return <div className="space-y-5" aria-label="Epizód klinikai kartonja">
    {!dentalOnly && <>
      <AnamnezisSection register={register} watch={watch} setValue={setValue} errors={form.formState.errors}
        isViewOnly={disabled} alwaysEditing selectedIndok={watch('kezelesreErkezesIndoka')}
        radioterapia={watch('radioterapia')} chemoterapia={watch('chemoterapia')} sectionErrors={{}} />
      <div className="card grid gap-3 sm:grid-cols-2">
        {([
          ['beutaloOrvos', 'Beutaló orvos'], ['beutaloIntezmeny', 'Beutaló intézmény'],
          ['beutaloIndokolas', 'Beutalás indokolása'], ['kortortenetiOsszefoglalo', 'Kórtörténeti összefoglaló'],
          ['szakorvosiVelemény', 'Szakorvosi vélemény'],
        ] as const).map(([key, label]) => <label key={key} className="block text-sm">{label}
          <textarea {...register(key)} aria-label={label} rows={2} readOnly={disabled} className="form-input mt-1" />
        </label>)}
      </div>
      <BetegvizsgalatSection register={register} watch={watch} setValue={setValue} errors={form.formState.errors}
        isViewOnly={disabled} fogak={fogak} setFogak={setFogak} showToothTreatments={false}
        handleToothStatusToggle={() => {}} handleToothStatusSelect={() => {}} handleToothStatusDetailsChange={() => {}}
        felsoFogpotlasVan={watch('felsoFogpotlasVan')} felsoFogpotlasElegedett={watch('felsoFogpotlasElegedett')}
        alsoFogpotlasVan={watch('alsoFogpotlasVan')} alsoFogpotlasElegedett={watch('alsoFogpotlasElegedett')}
        patientId={null} currentPatientName={watch('nev')} patient={getValues()} showToast={() => ''} sectionErrors={{}} />
    </>}
    {dentalOnly && <div className="card"><h4 className="mb-3 font-semibold">Fogazati státusz</h4>
      <Odontogram fogak={fogak} setFogak={setFogak} editing={!disabled} isViewOnly={disabled} />
    </div>}
    {dentalOnly && <div className="grid gap-3 sm:grid-cols-2">{(['felso','also'] as const).map(jaw=>{
      const patient=getValues();
      const types=existingTypes(patient[`${jaw}FogpotlasTipusok`],patient[`${jaw}FogpotlasTipus`]);
      const present=patient[`${jaw}FogpotlasVan`];
      return <div key={jaw} className="card"><h4 className="mb-2 font-semibold">{jaw==='felso'?'Felső':'Alsó'} · meglévő fogpótlások</h4>
        {present===false?<p className="text-sm text-slate-500">Nincs meglévő fogpótlás</p>:<>
          {types.length?<div className="flex flex-wrap gap-2">{types.map(type=><span key={type} className="rounded-lg bg-blue-50 px-2 py-1 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">{type}</span>)}</div>:<p className="text-sm text-slate-500">A típus még nincs megadva.</p>}
          {patient[`${jaw}FogpotlasMikor`]&&<p className="mt-2 text-sm">Készült: {patient[`${jaw}FogpotlasMikor`]}</p>}
          {patient[`${jaw}FogpotlasKeszito`]&&<p className="mt-1 text-sm">Készítő: {patient[`${jaw}FogpotlasKeszito`]}</p>}
          {patient[`${jaw}FogpotlasProblema`]&&<p className="mt-1 whitespace-pre-wrap text-sm">{patient[`${jaw}FogpotlasProblema`]}</p>}
        </>}
      </div>;
    })}</div>}
    <ImplantatumokSection register={register} watch={watch} isViewOnly={disabled} implantatumok={implants}
      nemIsmertPoziciokbanImplantatum={watch('nemIsmertPoziciokbanImplantatum')}
      handleToothToggle={position => {
        if (disabled) return;
        const next = { ...getValues('meglevoImplantatumok') };
        if (position in next) delete next[position]; else next[position] = '';
        setValue('meglevoImplantatumok', next, { shouldDirty: true });
      }}
      handleImplantatumDetailsChange={(position, description) => {
        if (!disabled) setValue('meglevoImplantatumok', { ...getValues('meglevoImplantatumok'), [position]: description }, { shouldDirty: true });
      }} />
  </div>;
}
