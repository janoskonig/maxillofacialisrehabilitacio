'use client';

import { useState } from 'react';
import { UseFormRegister, FieldErrors, UseFormWatch } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { User, AlertTriangle } from 'lucide-react';
import { ReadField, ReadGrid, SectionShell, isEmptyValue } from './read/ReadView';

interface AlapadatokSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  handleTAJChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePhoneChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sectionErrors: Record<string, number>;
  userRole?: string;
  tajChecksumWarning?: boolean;
  /** Gyors új beteg: kötelező név+TAJ; telefon és email opcionális (nem NEAK lista) */
  minimalNewPatient?: boolean;
}

export function AlapadatokSection({
  register,
  watch,
  errors,
  isViewOnly,
  handleTAJChange,
  handlePhoneChange,
  userRole,
  tajChecksumWarning,
  minimalNewPatient = false,
}: AlapadatokSectionProps) {
  const isTechnikus = userRole === 'technikus';
  const [editing, setEditing] = useState(false);
  const req = (key: keyof Patient) =>
    minimalNewPatient
      ? key === 'nev' || key === 'taj'
      : REQUIRED_FIELDS.some(f => f.key === key);

  const nev = watch('nev');
  const taj = watch('taj');
  const telefonszam = watch('telefonszam');
  const email = watch('email');

  // Hiányzó adatok száma a látható mezőkből.
  const missingCount = [
    { v: nev, req: req('nev'), show: true },
    { v: taj, req: req('taj'), show: !isTechnikus },
    { v: telefonszam, req: false, show: !isTechnikus },
    { v: email, req: req('email'), show: !isTechnikus },
  ].filter(f => f.show && isEmptyValue(f.v)).length;

  return (
    <SectionShell
      id="alapadatok"
      title="Alapadatok"
      icon={<User className="w-5 h-5" />}
      missingCount={missingCount}
      editing={editing}
      onToggleEdit={() => setEditing(e => !e)}
      isViewOnly={isViewOnly}
    >
      {editing ? (
        <div className="space-y-4">
          <div>
            <label className={`form-label ${req('nev') ? 'form-label-required' : ''}`}>Név</label>
            <input
              {...register('nev')}
              className="form-input"
              placeholder="Teljes név"
              readOnly={isViewOnly}
            />
            {errors.nev && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.nev.message}</p>}
          </div>
          {!isTechnikus && (
            <>
              <div>
                <label className={`form-label ${req('taj') ? 'form-label-required' : ''}`}>TAJ</label>
                <input
                  {...register('taj')}
                  onChange={handleTAJChange}
                  className={`form-input ${errors.taj ? 'border-red-500' : tajChecksumWarning ? 'border-amber-400' : ''}`}
                  placeholder="000-000-000"
                  readOnly={isViewOnly}
                />
                {errors.taj ? (
                  <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.taj.message}</p>
                ) : tajChecksumWarning ? (
                  <p className="text-amber-600 dark:text-amber-300 text-xs mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    Az ellenőrző számjegy nem megfelelő. Kérjük, ellenőrizze a TAJ számot.
                  </p>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">Formátum: XXX-XXX-XXX (9 számjegy)</p>
                )}
              </div>
              <div>
                <label className="form-label">
                  Telefonszám
                  {minimalNewPatient && <span className="font-normal text-gray-500 dark:text-gray-400"> (opcionális)</span>}
                </label>
                <input
                  {...register('telefonszam')}
                  onChange={handlePhoneChange}
                  className={`form-input ${errors.telefonszam ? 'border-red-500' : ''}`}
                  placeholder="+36..."
                  readOnly={isViewOnly}
                />
                {errors.telefonszam && (
                  <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.telefonszam.message}</p>
                )}
              </div>
              <div>
                <label className={`form-label ${req('email') ? 'form-label-required' : ''}`}>
                  Email
                  {minimalNewPatient && <span className="font-normal text-gray-500 dark:text-gray-400"> (opcionális)</span>}
                </label>
                <input
                  {...register('email')}
                  type="email"
                  className={`form-input ${errors.email ? 'border-red-500' : ''}`}
                  placeholder="nev@example.com"
                  readOnly={isViewOnly}
                />
                {errors.email && <p className="text-red-500 dark:text-red-400 text-sm mt-1">{errors.email.message}</p>}
              </div>
            </>
          )}
        </div>
      ) : (
        <ReadGrid>
          <ReadField label="Név" value={nev} required={req('nev')} full />
          {!isTechnikus && (
            <>
              <ReadField label="TAJ" value={taj} required={req('taj')} />
              <ReadField label="Telefonszám" value={telefonszam} accent />
              <ReadField label="Email" value={email} required={req('email')} accent full />
            </>
          )}
        </ReadGrid>
      )}
    </SectionShell>
  );
}
