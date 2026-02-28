'use client';

import { UseFormRegister } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { AlertTriangle } from 'lucide-react';
import { ToothCheckbox } from './ToothCheckbox';

interface ImplantatumokSectionProps {
  register: UseFormRegister<Patient>;
  isViewOnly: boolean;
  implantatumok: Record<string, string>;
  handleToothToggle: (toothNumber: string) => void;
  handleImplantatumDetailsChange: (toothNumber: string, details: string) => void;
  nemIsmertPoziciokbanImplantatum: boolean | undefined;
}

export function ImplantatumokSection({
  register,
  isViewOnly,
  implantatumok,
  handleToothToggle,
  handleImplantatumDetailsChange,
  nemIsmertPoziciokbanImplantatum,
}: ImplantatumokSectionProps) {
  return (
    <div className="card">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <AlertTriangle className="w-5 h-5 mr-2 text-medical-primary" />
        Meglévő implantátumok, ha vannak
      </h4>
      
      {/* Zsigmondy-kereszt */}
      <div className="mb-6">
        <div className="bg-gray-50 p-3 sm:p-4 rounded-lg overflow-x-auto">
          {/* Felső sor */}
          <div className="flex justify-between mb-2 min-w-[600px] sm:min-w-0">
            <div className="flex gap-1 sm:gap-1">
              {[18, 17, 16, 15, 14, 13, 12, 11].map(tooth => {
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
            <div className="flex gap-1 sm:gap-1">
              {[21, 22, 23, 24, 25, 26, 27, 28].map(tooth => {
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
          </div>
          
          {/* Alsó sor */}
          <div className="flex justify-between min-w-[600px] sm:min-w-0">
            <div className="flex gap-1 sm:gap-1">
              {[48, 47, 46, 45, 44, 43, 42, 41].map(tooth => {
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
            <div className="flex gap-1 sm:gap-1">
              {[31, 32, 33, 34, 35, 36, 37, 38].map(tooth => {
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
          </div>
        </div>
      </div>

      {/* Implantátum részletek */}
      {Object.keys(implantatumok).length > 0 && (
        <div className="space-y-3 sm:space-y-4 mb-4">
          <h5 className="font-medium text-gray-700 mb-3 text-sm sm:text-base">Implantátum részletek</h5>
          {Object.keys(implantatumok)
            .sort()
            .map(toothNumber => (
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

      {/* Nem ismert pozíciókban implantátum */}
      <div className="border-t pt-4 mt-4">
        <div className="flex items-center mb-3">
          <input
            {...register('nemIsmertPoziciokbanImplantatum')}
            type="checkbox"
            className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
            disabled={isViewOnly}
          />
          <label className="ml-2 text-sm font-medium text-gray-700">
            Nem ismert pozíciókban
          </label>
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
    </div>
  );
}
