'use client';

import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { formatDateForInput } from '@/lib/dateUtils';
import { MapPin } from 'lucide-react';
import { DatePicker } from '../DatePicker';

interface SzemelyesAdatokSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  setValue: UseFormSetValue<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  sectionErrors: Record<string, number>;
}

export function SzemelyesAdatokSection({
  register,
  watch,
  setValue,
  errors,
  isViewOnly,
  sectionErrors,
}: SzemelyesAdatokSectionProps) {
  return (
    <div id="section-szemelyes" className="card scroll-mt-20 sm:scroll-mt-24">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <MapPin className="w-5 h-5 mr-2 text-medical-primary" />
        SZEMÉLYES ADATOK
        {sectionErrors['szemelyes'] > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
            {sectionErrors['szemelyes']}
          </span>
        )}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="form-label">Születési dátum</label>
          <DatePicker
            selected={watch('szuletesiDatum') ? new Date(watch('szuletesiDatum') || '') : null}
            onChange={(date: Date | null) => {
              const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
              setValue('szuletesiDatum', formatted, { shouldValidate: true });
            }}
            placeholder="Válasszon dátumot"
            disabled={isViewOnly}
            maxDate={new Date()}
          />
        </div>
        <div>
          <label className="form-label">Nem</label>
          <select {...register('nem')} className="form-input">
            <option value="">Válasszon...</option>
            <option value="ferfi">Férfi</option>
            <option value="no">Nő</option>
          </select>
        </div>
        <div>
          <label className="form-label">Halál dátuma</label>
          <DatePicker
            selected={watch('halalDatum') ? new Date(watch('halalDatum') || '') : null}
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
          <input
            {...register('cim')}
            className="form-input"
            placeholder="Lakcím"
          />
        </div>
        <div>
          <label className="form-label">Város</label>
          <input
            {...register('varos')}
            className="form-input"
            placeholder="Város"
          />
        </div>
        <div>
          <label className="form-label">Irányítószám</label>
          <input
            {...register('iranyitoszam')}
            className="form-input"
            placeholder="Irányítószám"
          />
        </div>
      </div>
    </div>
  );
}
