'use client';

import { UseFormRegister } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { FileText } from 'lucide-react';

interface BeutaloSectionProps {
  register: UseFormRegister<Patient>;
  isViewOnly: boolean;
  vanBeutalo: boolean;
  onVanBeutaloChange: () => void;
  doctorOptions: Array<{ name: string; intezmeny: string | null }>;
  institutionOptions: string[];
}

export function BeutaloSection({
  register,
  isViewOnly,
  vanBeutalo,
  onVanBeutaloChange,
  doctorOptions,
  institutionOptions,
}: BeutaloSectionProps) {
  return (
    <div id="section-beutalo" className="card scroll-mt-20 sm:scroll-mt-24">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <FileText className="w-5 h-5 mr-2 text-medical-primary" />
        BEUTALÓ
      </h4>

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
    </div>
  );
}
