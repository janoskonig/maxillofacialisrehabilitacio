'use client';

import { useState } from 'react';
import { UseFormRegister, UseFormWatch } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { CircleDot } from 'lucide-react';
import { ToothCheckbox } from './ToothCheckbox';
import { SectionShell } from './read/ReadView';

interface ImplantatumokSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  isViewOnly: boolean;
  implantatumok: Record<string, string>;
  handleToothToggle: (toothNumber: string) => void;
  handleImplantatumDetailsChange: (toothNumber: string, details: string) => void;
  nemIsmertPoziciokbanImplantatum: boolean | undefined;
}

const UPPER = [
  [18, 17, 16, 15, 14, 13, 12, 11],
  [21, 22, 23, 24, 25, 26, 27, 28],
];
const LOWER = [
  [48, 47, 46, 45, 44, 43, 42, 41],
  [31, 32, 33, 34, 35, 36, 37, 38],
];

export function ImplantatumokSection({
  register,
  watch,
  isViewOnly,
  implantatumok,
  handleToothToggle,
  handleImplantatumDetailsChange,
  nemIsmertPoziciokbanImplantatum,
}: ImplantatumokSectionProps) {
  const [editing, setEditing] = useState(false);
  const positions = Object.keys(implantatumok).sort();
  const nemIsmertReszletek = watch('nemIsmertPoziciokbanImplantatumRészletek') as unknown as string | undefined;
  const hasAny = positions.length > 0 || !!nemIsmertPoziciokbanImplantatum;

  const renderRow = (groups: number[][]) => (
    <div className="flex justify-between min-w-[600px] sm:min-w-0">
      {groups.map((group, gi) => (
        <div key={gi} className="flex gap-1">
          {group.map(tooth => {
            const toothStr = tooth.toString();
            const implantValue = toothStr in implantatumok
              ? { description: implantatumok[toothStr] || '' }
              : undefined;
            return (
              <ToothCheckbox
                key={tooth}
                toothNumber={toothStr}
                value={implantValue}
                onChange={() => handleToothToggle(toothStr)}
                disabled={isViewOnly}
                idPrefix="implant"
              />
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <SectionShell
      id="implantatumok"
      title="Meglévő implantátumok"
      icon={<CircleDot className="w-5 h-5" />}
      editing={editing}
      onToggleEdit={() => setEditing(e => !e)}
      isViewOnly={isViewOnly}
    >
      {editing ? (
        <>
          <div className="mb-6">
            <div className="bg-gray-50 p-3 sm:p-4 rounded-lg overflow-x-auto">
              <div className="mb-2">{renderRow(UPPER)}</div>
              {renderRow(LOWER)}
            </div>
          </div>

          {positions.length > 0 && (
            <div className="space-y-3 sm:space-y-4 mb-4">
              <h5 className="font-medium text-gray-700 mb-3 text-sm sm:text-base">Implantátum részletek</h5>
              {positions.map(toothNumber => (
                <div key={toothNumber} className="border border-gray-200 rounded-md p-3 sm:p-4">
                  <label className="form-label font-medium text-sm sm:text-base">
                    {toothNumber}. fog - Implantátum típusa, gyári száma, stb.
                  </label>
                  <textarea
                    value={implantatumok[toothNumber] || ''}
                    onChange={(e) => handleImplantatumDetailsChange(toothNumber, e.target.value)}
                    rows={2}
                    className="form-input text-base sm:text-sm"
                    placeholder="Pl. Straumann BLT 4.1x10mm, Gyári szám: 028.015, Dátum: 2023.05.15"
                    readOnly={isViewOnly}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="border-t pt-4 mt-4">
            <div className="flex items-center mb-3">
              <input
                {...register('nemIsmertPoziciokbanImplantatum')}
                type="checkbox"
                className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm font-medium text-gray-700">Nem ismert pozíciókban</label>
            </div>
            {nemIsmertPoziciokbanImplantatum && (
              <div className="ml-6">
                <label className="form-label">Részletek (típus, mennyiség, stb.)</label>
                <textarea
                  {...register('nemIsmertPoziciokbanImplantatumRészletek')}
                  rows={3}
                  className="form-input"
                  placeholder="Pl. Straumann implantátumok, pontos pozíció nem ismert, mennyiség: 3 db"
                  readOnly={isViewOnly}
                />
              </div>
            )}
          </div>
        </>
      ) : hasAny ? (
        <div className="space-y-2">
          {positions.map(toothNumber => (
            <div key={toothNumber} className="text-sm">
              <span className="font-medium text-gray-900 dark:text-gray-100">{toothNumber}. fog</span>
              {implantatumok[toothNumber] ? (
                <span className="text-gray-600 dark:text-gray-300"> — {implantatumok[toothNumber]}</span>
              ) : null}
            </div>
          ))}
          {nemIsmertPoziciokbanImplantatum && (
            <div className="text-sm">
              <span className="font-medium text-gray-900 dark:text-gray-100">Nem ismert pozíciókban</span>
              {nemIsmertReszletek ? (
                <span className="text-gray-600 dark:text-gray-300"> — {nemIsmertReszletek}</span>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nincs rögzített implantátum.</p>
      )}
    </SectionShell>
  );
}
