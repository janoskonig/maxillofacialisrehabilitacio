'use client';

import { useState } from 'react';
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { formatDateForInput, calculateAge } from '@/lib/dateUtils';
import { requiresGuardian } from '@/lib/legal/legal-capacity';
import { MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { DatePicker } from '../DatePicker';
import { FieldErrorText, fieldAriaProps, fieldErrorId } from './field-a11y';
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
  const kepviseloNev = watch('torvenyesKepviseloNev');
  const kepviseloKapcsolat = watch('torvenyesKepviseloKapcsolat');
  const kepviseloEmail = watch('torvenyesKepviseloEmail');

  if (userRole === 'technikus') return null;

  // 18 alatt a nyilatkozatokat a törvényes képviselő teszi meg — a nevét
  // a mentés (POST /api/patients) is megköveteli, ezért itt is kötelező mező.
  const isMinor = requiresGuardian(szuletesiDatum);

  const expected: unknown[] = [
    ...(compactPersonalFields
      ? [szuletesiDatum, nem]
      : [szuletesiDatum, nem, cim, varos, iranyitoszam]),
    ...(isMinor ? [kepviseloNev] : []),
  ];
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
              ariaInvalid={!!errors.szuletesiDatum}
              ariaDescribedBy={errors.szuletesiDatum ? fieldErrorId('szuletesiDatum') : undefined}
            />
            <FieldErrorText name="szuletesiDatum" message={errors.szuletesiDatum?.message as string | undefined} />
          </div>
          <div>
            <label className={`form-label ${compactPersonalFields ? 'form-label-required' : ''}`}>Nem</label>
            <select
              {...register('nem')}
              className={`form-input ${errors.nem ? 'border-red-500' : ''}`}
              {...fieldAriaProps('nem', !!errors.nem)}
            >
              <option value="">Válasszon...</option>
              <option value="ferfi">Férfi</option>
              <option value="no">Nő</option>
            </select>
            <FieldErrorText name="nem" message={errors.nem?.message as string | undefined} />
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
                  ariaInvalid={!!errors.halalDatum}
                  ariaDescribedBy={errors.halalDatum ? fieldErrorId('halalDatum') : undefined}
                />
                <FieldErrorText name="halalDatum" message={errors.halalDatum?.message} />
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

          {/* Törvényes képviselő — csak kiskorúnál, a gyors felvételnél is */}
          {isMinor && (
            <div className="md:col-span-2 border-t border-gray-200 dark:border-gray-800 pt-4 mt-1 space-y-4">
              <p className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-lg p-3">
                A megadott születési dátum alapján a páciens kiskorú. A nyilatkozatokat
                (adatkezelési tájékoztató, kutatási hozzájárulás) a törvényes képviselő teszi
                meg — a neve a mentéshez kötelező.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="form-label form-label-required">Törvényes képviselő neve</label>
                  <input
                    {...register('torvenyesKepviseloNev')}
                    className={`form-input ${errors.torvenyesKepviseloNev ? 'border-red-500' : ''}`}
                    placeholder="Kovács Anna"
                    {...fieldAriaProps('torvenyesKepviseloNev', !!errors.torvenyesKepviseloNev)}
                  />
                  <FieldErrorText
                    name="torvenyesKepviseloNev"
                    message={errors.torvenyesKepviseloNev?.message as string | undefined}
                  />
                </div>
                <div>
                  <label className="form-label">Kapcsolat a pácienssel</label>
                  <input
                    {...register('torvenyesKepviseloKapcsolat')}
                    className="form-input"
                    placeholder="szülő / gyám"
                  />
                </div>
                <div>
                  <label className="form-label">Törvényes képviselő email címe</label>
                  <input
                    type="email"
                    {...register('torvenyesKepviseloEmail')}
                    className="form-input"
                    placeholder="kepviselo@example.com"
                  />
                </div>
              </div>
            </div>
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
          {isMinor && (
            <>
              <ReadField label="Törvényes képviselő neve" value={kepviseloNev} required />
              <ReadField label="Kapcsolat a pácienssel" value={kepviseloKapcsolat} />
              <ReadField label="Törvényes képviselő email címe" value={kepviseloEmail} />
            </>
          )}
        </ReadGrid>
      )}
    </SectionShell>
  );
}
