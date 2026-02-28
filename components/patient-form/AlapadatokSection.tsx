'use client';

import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { User } from 'lucide-react';

interface AlapadatokSectionProps {
  register: UseFormRegister<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  handleTAJChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePhoneChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sectionErrors: Record<string, number>;
}

export function AlapadatokSection({
  register,
  errors,
  isViewOnly,
  handleTAJChange,
  handlePhoneChange,
  sectionErrors,
}: AlapadatokSectionProps) {
  return (
    <div id="section-alapadatok" className="card scroll-mt-20 sm:scroll-mt-24">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <User className="w-5 h-5 mr-2 text-medical-primary" />
        ALAPADATOK
        {sectionErrors['alapadatok'] > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
            {sectionErrors['alapadatok']}
          </span>
        )}
      </h4>
      <div className="space-y-4">
        <div>
          <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'nev') ? 'form-label-required' : ''}`}>
            NÉV
          </label>
          <input
            {...register('nev')}
            className="form-input"
            placeholder="Teljes név"
            readOnly={isViewOnly}
          />
          {errors.nev && (
            <p className="text-red-500 text-sm mt-1">{errors.nev.message}</p>
          )}
        </div>
        <div>
          <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'taj') ? 'form-label-required' : ''}`}>
            TAJ
          </label>
          <input
            {...register('taj')}
            onChange={handleTAJChange}
            className={`form-input ${errors.taj ? 'border-red-500' : ''}`}
            placeholder="000-000-000"
            readOnly={isViewOnly}
          />
          {errors.taj ? (
            <p className="text-red-500 text-sm mt-1">{errors.taj.message}</p>
          ) : (
            <p className="text-gray-500 text-xs mt-1">Formátum: XXX-XXX-XXX (9 számjegy)</p>
          )}
        </div>
        <div>
          <label className="form-label">
            TELEFONSZÁM
          </label>
          <input
            {...register('telefonszam')}
            onChange={handlePhoneChange}
            className={`form-input ${errors.telefonszam ? 'border-red-500' : ''}`}
            placeholder="+36..."
            readOnly={isViewOnly}
          />
          {errors.telefonszam ? (
            <p className="text-red-500 text-sm mt-1">{errors.telefonszam.message}</p>
          ) : (
            <p className="text-gray-500 text-xs mt-1">Formátum: +36XXXXXXXXX (pl. +36123456789)</p>
          )}
        </div>
        <div>
          <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'email') ? 'form-label-required' : ''}`}>
            EMAIL
          </label>
          <input
            {...register('email')}
            type="email"
            className={`form-input ${errors.email ? 'border-red-500' : ''}`}
            placeholder="nev@example.com"
            readOnly={isViewOnly}
          />
          {errors.email ? (
            <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
          ) : (
            <p className="text-gray-500 text-xs mt-1">Formátum: nev@example.com</p>
          )}
        </div>
      </div>
    </div>
  );
}
