'use client';

import { useState } from 'react';
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { Patient, nyakiBlokkdisszekcioOptions } from '@/lib/types';
import { REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { formatDateForInput } from '@/lib/dateUtils';
import { Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { DatePicker } from '../DatePicker';
import { BNOAutocomplete } from '../BNOAutocomplete';
import { ReadField, ReadGrid, SectionShell, isEmptyValue } from './read/ReadView';

interface AnamnezisEtcSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  setValue: UseFormSetValue<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  selectedIndok: string | null | undefined;
  radioterapia: boolean | undefined;
  chemoterapia: boolean | undefined;
  sectionErrors: Record<string, number>;
}

function fmtDate(value?: string | null): string {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return format(d, 'yyyy. MMM d.', { locale: hu });
  } catch {
    return value;
  }
}

const isReq = (key: keyof Patient) => REQUIRED_FIELDS.some(f => f.key === key);

export function AnamnezisSection({
  register,
  watch,
  setValue,
  errors,
  isViewOnly,
  selectedIndok,
  radioterapia,
  chemoterapia,
}: AnamnezisEtcSectionProps) {
  const [editing, setEditing] = useState(false);

  const kezelesreErkezesIndoka = watch('kezelesreErkezesIndoka');
  const diagnozis = watch('diagnozis');
  const bno = watch('bno');
  const missingCount = [
    { v: kezelesreErkezesIndoka, req: isReq('kezelesreErkezesIndoka') },
    { v: diagnozis, req: isReq('diagnozis') },
  ].filter(f => f.req && isEmptyValue(f.v)).length;

  const v = (key: keyof Patient) => watch(key) as unknown as string | null | undefined;
  const veleszuletett = (watch('veleszuletettRendellenessegek') as unknown as string[] | undefined) || [];

  /** Olvasó-mező csak ha van érték (opcionális mezők); a kötelezőket külön mindig kiírjuk. */
  const Opt = ({ label, value, full }: { label: string; value?: string | null; full?: boolean }) =>
    isEmptyValue(value) ? null : <ReadField label={label} value={value} full={full} />;

  return (
    <SectionShell
      id="anamnezis"
      title="Anamnézis"
      icon={<Calendar className="w-5 h-5" />}
      missingCount={missingCount}
      editing={editing}
      onToggleEdit={() => setEditing(e => !e)}
      isViewOnly={isViewOnly}
    >
      {editing ? (
        <div className="space-y-4">
          <div>
            <label className={`form-label ${isReq('kezelesreErkezesIndoka') ? 'form-label-required' : ''}`}>
              Kezelésre érkezés indoka
            </label>
            <select {...register('kezelesreErkezesIndoka')} className="form-input" disabled={isViewOnly}>
              <option value="">Válasszon...</option>
              <option value="traumás sérülés">traumás sérülés</option>
              <option value="veleszületett rendellenesség">veleszületett rendellenesség</option>
              <option value="onkológiai kezelés utáni állapot">onkológiai kezelés utáni állapot</option>
            </select>
          </div>
          <div>
            <label className="form-label">Alkoholfogyasztás</label>
            <textarea {...register('alkoholfogyasztas')} rows={2} className="form-input" placeholder="Szabadszavas leírás" readOnly={isViewOnly} />
          </div>
          <div>
            <label className="form-label">Dohányzás (n szál/nap)</label>
            <input {...register('dohanyzasSzam')} className="form-input" placeholder="pl. 10 szál/nap" readOnly={isViewOnly} />
          </div>
          <div>
            <label className="form-label">BNO</label>
            <BNOAutocomplete
              value={watch('bno') || ''}
              onChange={(kod, nev) => {
                setValue('bno', kod, { shouldDirty: true, shouldValidate: true });
                setValue('diagnozis', nev, { shouldDirty: true, shouldValidate: true });
              }}
              placeholder="Kezdjen el gépelni a BNO kód vagy név alapján..."
              readOnly={isViewOnly}
              disabled={isViewOnly}
            />
          </div>
          <div>
            <label className={`form-label ${isReq('diagnozis') ? 'form-label-required' : ''}`}>Diagnózis</label>
            <input {...register('diagnozis')} className="form-input" placeholder="Diagnózis" readOnly={isViewOnly} />
          </div>

          {selectedIndok === 'traumás sérülés' && (
            <>
              <div>
                <label className="form-label">Baleset időpontja</label>
                <DatePicker
                  selected={watch('balesetIdopont') ? new Date(watch('balesetIdopont') || '') : null}
                  onChange={(date: Date | null) => {
                    const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                    setValue('balesetIdopont', formatted, { shouldValidate: true });
                  }}
                  placeholder="Válasszon dátumot"
                  disabled={isViewOnly}
                  maxDate={new Date()}
                />
              </div>
              <div>
                <label className="form-label">Baleset etiológiája</label>
                <textarea {...register('balesetEtiologiaja')} rows={2} className="form-input" placeholder="Szabadszavas leírás (pl. közlekedési baleset, esés stb.)" readOnly={isViewOnly} />
              </div>
              <div>
                <label className="form-label">Egyéb körülmények, műtétek</label>
                <textarea {...register('balesetEgyeb')} rows={2} className="form-input" placeholder="Egyéb körülmények, műtétek, stb. (szabadszavas)" readOnly={isViewOnly} />
              </div>
            </>
          )}

          {selectedIndok === 'onkológiai kezelés utáni állapot' && (
            <>
              <div>
                <label className="form-label">Tumor szövettani típusa</label>
                <input {...register('szovettaniDiagnozis')} className="form-input" placeholder="Szövettani diagnózis" readOnly={isViewOnly} />
              </div>
              <div>
                <label className="form-label">TNM-staging</label>
                <input {...register('tnmStaging')} className="form-input" placeholder="pl. pT3N2bM0, UICC 8. ed." readOnly={isViewOnly} />
              </div>
              <div>
                <label className="form-label">Műtét ideje</label>
                <DatePicker
                  selected={watch('mutetIdeje') ? new Date(watch('mutetIdeje') || '') : null}
                  onChange={(date: Date | null) => {
                    const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                    setValue('mutetIdeje', formatted, { shouldValidate: true });
                  }}
                  placeholder="Válasszon dátumot"
                  disabled={isViewOnly}
                  maxDate={new Date()}
                />
              </div>
              <div>
                <label className="form-label">Primer műtét leírása</label>
                <textarea {...register('primerMutetLeirasa')} rows={2} className="form-input" placeholder="Primer műtét rövid leírása (szabadszavas)" readOnly={isViewOnly} />
              </div>
              <div>
                <label className="form-label">Nyaki blokkdisszekció</label>
                <select {...register('nyakiBlokkdisszekcio')} className="form-input" disabled={isViewOnly}>
                  <option value="">Válasszon...</option>
                  {nyakiBlokkdisszekcioOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h5 className="text-md font-semibold text-gray-900 mb-4">Adjuváns terápiák</h5>
                <div className="space-y-4">
                  <div className="flex items-center">
                    <input {...register('radioterapia')} type="checkbox" className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary" disabled={isViewOnly} />
                    <label className="ml-2 text-sm text-gray-700">Radioterápia</label>
                  </div>
                  {radioterapia && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                      <div>
                        <label className="form-label">Dózis (n Gy)</label>
                        <input {...register('radioterapiaDozis')} className="form-input" placeholder="pl. 60 Gy" readOnly={isViewOnly} />
                      </div>
                      <div>
                        <label className="form-label">Dátumintervallum</label>
                        <input {...register('radioterapiaDatumIntervallum')} className="form-input" placeholder="pl. 2023.01.15 - 2023.03.15" readOnly={isViewOnly} />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center">
                    <input {...register('chemoterapia')} type="checkbox" className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary" disabled={isViewOnly} />
                    <label className="ml-2 text-sm text-gray-700">Kemoterápia</label>
                  </div>
                  {chemoterapia && (
                    <div className="ml-6">
                      <label className="form-label">Mikor, mit, mennyit</label>
                      <textarea {...register('chemoterapiaLeiras')} rows={3} className="form-input" placeholder="Részletes leírás: mikor, milyen készítmény, mennyiség" readOnly={isViewOnly} />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {selectedIndok === 'veleszületett rendellenesség' && (
            <>
              <div>
                <label className="form-label">Milyen rendellenesség(ek) áll(nak) fenn?</label>
                <div className="flex flex-col gap-2 ml-4">
                  {["kemény szájpadhasadék", "lágyszájpad inszufficiencia", "állcsonthasadék", "ajakhasadék"].map(opt => (
                    <label key={opt} className="flex items-center">
                      <input type="checkbox" value={opt} {...register('veleszuletettRendellenessegek')} className="mr-2" disabled={isViewOnly} />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">Műtétek leírása, legutolsó beavatkozás</label>
                <textarea {...register('veleszuletettMutetekLeirasa')} rows={2} className="form-input" placeholder="Műtétek leírása, legutolsó beavatkozás (szabadszavas)" readOnly={isViewOnly} />
              </div>
            </>
          )}
        </div>
      ) : (
        <ReadGrid>
          <ReadField label="Kezelésre érkezés indoka" value={kezelesreErkezesIndoka} required={isReq('kezelesreErkezesIndoka')} />
          <ReadField label="Diagnózis" value={diagnozis} required={isReq('diagnozis')} />
          <Opt label="BNO" value={bno} />
          <Opt label="Alkoholfogyasztás" value={v('alkoholfogyasztas')} full />
          <Opt label="Dohányzás" value={v('dohanyzasSzam')} />

          {selectedIndok === 'traumás sérülés' && (
            <>
              <Opt label="Baleset időpontja" value={fmtDate(v('balesetIdopont'))} />
              <Opt label="Baleset etiológiája" value={v('balesetEtiologiaja')} full />
              <Opt label="Egyéb körülmények, műtétek" value={v('balesetEgyeb')} full />
            </>
          )}

          {selectedIndok === 'onkológiai kezelés utáni állapot' && (
            <>
              <Opt label="Tumor szövettani típusa" value={v('szovettaniDiagnozis')} />
              <Opt label="TNM-staging" value={v('tnmStaging')} />
              <Opt label="Műtét ideje" value={fmtDate(v('mutetIdeje'))} />
              <Opt label="Primer műtét leírása" value={v('primerMutetLeirasa')} full />
              <Opt label="Nyaki blokkdisszekció" value={v('nyakiBlokkdisszekcio')} />
              <ReadField label="Radioterápia" value={radioterapia ? 'Igen' : 'Nem'} />
              {radioterapia && <Opt label="Radioterápia dózis" value={v('radioterapiaDozis')} />}
              {radioterapia && <Opt label="Radioterápia időszak" value={v('radioterapiaDatumIntervallum')} />}
              <ReadField label="Kemoterápia" value={chemoterapia ? 'Igen' : 'Nem'} />
              {chemoterapia && <Opt label="Kemoterápia leírás" value={v('chemoterapiaLeiras')} full />}
            </>
          )}

          {selectedIndok === 'veleszületett rendellenesség' && (
            <>
              <Opt label="Rendellenesség(ek)" value={veleszuletett.join(', ')} full />
              <Opt label="Műtétek leírása" value={v('veleszuletettMutetekLeirasa')} full />
            </>
          )}
        </ReadGrid>
      )}
    </SectionShell>
  );
}
