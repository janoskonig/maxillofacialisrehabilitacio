'use client';

import { useState } from 'react';
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { formatDateForInput, calculateAge } from '@/lib/dateUtils';
import { MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { DatePicker } from '../DatePicker';
import { ReadField, ReadGrid, SectionShell, isEmptyValue } from './read/ReadView';

interface SzemelyesAdatokSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  setValue: UseFormSetValue<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  sectionErrors: Record<string, number>;
  userRole?: string;
  /** Csak születési dátum + nem (gyors új beteg rögzítés) */
  compactPersonalFields?: boolean;
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

const NEM_LABELS: Record<string, string> = { ferfi: 'Férfi', no: 'Nő' };

export function SzemelyesAdatokSection({
  register,
  watch,
  setValue,
  errors,
  isViewOnly,
  userRole,
  compactPersonalFields = false,
}: SzemelyesAdatokSectionProps) {
  const [editing, setEditing] = useState(false);

  // A hook-okat a feltételes return ELŐTT kell meghívni.
  const szuletesiDatum = watch('szuletesiDatum');
  const nem = watch('nem');
  const halalDatum = watch('halalDatum');
  const cim = watch('cim');
  const varos = watch('varos');
  const iranyitoszam = watch('iranyitoszam');

  if (userRole === 'technikus') return null;

  const expected = compactPersonalFields
    ? [szuletesiDatum, nem]
    : [szuletesiDatum, nem, cim, varos, iranyitoszam];
  const missingCount = expected.filter(isEmptyValue).length;

  const age = calculateAge(szuletesiDatum);
  const birthDisplay = szuletesiDatum
    ? `${fmtDate(szuletesiDatum)}${age != null ? ` (${age} é)` : ''}`
    : '';

  return (
    <SectionShell
      id="szemelyes"
      title="Személyes adatok"
      icon={<MapPin className="w-5 h-5" />}
      missingCount={missingCount}
      editing={editing}
      onToggleEdit={() => setEditing(e => !e)}
      isViewOnly={isViewOnly}
    >
      {editing ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={`form-label ${compactPersonalFields ? 'form-label-required' : ''}`}>
              Születési dátum
            </label>
            <DatePicker
              selected={szuletesiDatum ? new Date(szuletesiDatum || '') : null}
              onChange={(date: Date | null) => {
                const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                setValue('szuletesiDatum', formatted, { shouldValidate: true });
              }}
              placeholder="Válasszon dátumot"
              disabled={isViewOnly}
              maxDate={new Date()}
            />
            {errors.szuletesiDatum && (
              <p className="text-red-500 text-sm mt-1">{errors.szuletesiDatum.message as string}</p>
            )}
          </div>
          <div>
            <label className={`form-label ${compactPersonalFields ? 'form-label-required' : ''}`}>Nem</label>
            <select {...register('nem')} className={`form-input ${errors.nem ? 'border-red-500' : ''}`}>
              <option value="">Válasszon...</option>
              <option value="ferfi">Férfi</option>
              <option value="no">Nő</option>
            </select>
            {errors.nem && <p className="text-red-500 text-sm mt-1">{errors.nem.message as string}</p>}
          </div>
          {!compactPersonalFields && (
            <>
              <div>
                <label className="form-label">Halál dátuma</label>
                <DatePicker
                  selected={halalDatum ? new Date(halalDatum || '') : null}
                  onChange={(date: Date | null) => {
                    const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                    setValue('halalDatum', formatted, { shouldValidate: true });
                  }}
                  placeholder="Válasszon dátumot"
                  disabled={isViewOnly}
                  maxDate={new Date()}
                />
                {errors.halalDatum && (
                  <p className="text-red-500 text-sm mt-1">{errors.halalDatum.message}</p>
                )}
              </div>
              <div>
                <label className="form-label">Cím</label>
                <input {...register('cim')} className="form-input" placeholder="Lakcím" />
              </div>
              <div>
                <label className="form-label">Város</label>
                <input {...register('varos')} className="form-input" placeholder="Város" />
              </div>
              <div>
                <label className="form-label">Irányítószám</label>
                <input {...register('iranyitoszam')} className="form-input" placeholder="Irányítószám" />
              </div>
            </>
          )}
        </div>
      ) : (
        <ReadGrid>
          <ReadField label="Születési dátum" value={birthDisplay} required={compactPersonalFields} />
          <ReadField label="Nem" value={nem ? NEM_LABELS[nem] ?? nem : ''} required={compactPersonalFields} />
          {!compactPersonalFields && (
            <>
              {!isEmptyValue(halalDatum) && <ReadField label="Halál dátuma" value={fmtDate(halalDatum)} />}
              <ReadField label="Cím" value={cim} />
              <ReadField label="Város" value={varos} />
              <ReadField label="Irányítószám" value={iranyitoszam} />
            </>
          )}
        </ReadGrid>
      )}
    </SectionShell>
  );
}
