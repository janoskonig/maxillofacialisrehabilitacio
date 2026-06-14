'use client';

import { useState } from 'react';
import { UseFormRegister, UseFormWatch } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { FileText } from 'lucide-react';
import { ReadField, ReadGrid, SectionShell, isEmptyValue } from './read/ReadView';

interface BeutaloSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  isViewOnly: boolean;
  vanBeutalo: boolean;
  onVanBeutaloChange: () => void;
  doctorOptions: Array<{ name: string; intezmeny: string | null }>;
  institutionOptions: string[];
}

export function BeutaloSection({
  register,
  watch,
  isViewOnly,
  vanBeutalo,
  onVanBeutaloChange,
  doctorOptions,
  institutionOptions,
}: BeutaloSectionProps) {
  const [editing, setEditing] = useState(false);

  const beutaloOrvos = watch('beutaloOrvos');
  const beutaloIntezmeny = watch('beutaloIntezmeny');
  const beutaloIndokolas = watch('beutaloIndokolas');

  const missingCount = vanBeutalo
    ? [beutaloOrvos, beutaloIntezmeny].filter(isEmptyValue).length
    : 0;

  return (
    <SectionShell
      id="beutalo"
      title="Beutaló"
      icon={<FileText className="w-5 h-5" />}
      missingCount={missingCount}
      editing={editing}
      onToggleEdit={() => setEditing(e => !e)}
      isViewOnly={isViewOnly}
    >
      {editing ? (
        <>
          <div className="flex items-center mb-4">
            <input
              id="beutalo-toggle"
              type="checkbox"
              checked={vanBeutalo}
              onChange={onVanBeutaloChange}
              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
              disabled={isViewOnly}
            />
            <label htmlFor="beutalo-toggle" className="ml-2 text-sm text-gray-700">Van beutaló?</label>
          </div>

          {vanBeutalo && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Beutaló orvos</label>
                <input
                  {...register('beutaloOrvos')}
                  list="beutalo-orvos-options"
                  className="form-input"
                  placeholder="Beutaló orvos neve"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
                <datalist id="beutalo-orvos-options">
                  {doctorOptions.map((doctor) => (
                    <option key={doctor.name} value={doctor.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="form-label">Beutaló intézmény</label>
                <input
                  {...register('beutaloIntezmeny')}
                  list="beutalo-intezmeny-options"
                  className="form-input"
                  placeholder="Válasszon vagy írjon be új intézményt..."
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
                <datalist id="beutalo-intezmeny-options">
                  {institutionOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="md:col-span-2">
                <label className="form-label">Indokolás</label>
                <textarea
                  {...register('beutaloIndokolas')}
                  rows={3}
                  className="form-input"
                  placeholder="Miért kapott beutalót?"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
              </div>
            </div>
          )}
        </>
      ) : vanBeutalo ? (
        <ReadGrid>
          <ReadField label="Beutaló orvos" value={beutaloOrvos} />
          <ReadField label="Beutaló intézmény" value={beutaloIntezmeny} />
          {!isEmptyValue(beutaloIndokolas) && (
            <ReadField label="Indokolás" value={beutaloIndokolas} full />
          )}
        </ReadGrid>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nincs beutaló rögzítve.</p>
      )}
    </SectionShell>
  );
}
