'use client';

import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { EQUITY_REQUEST_CONFIG } from '@/lib/equity-request-config';
import { FileText, Download } from 'lucide-react';

interface MeltanyossagiSectionProps {
  register: UseFormRegister<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  patientId: string | null;
  currentPatientName: string | null | undefined;
  showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => string;
}

export function MeltanyossagiSection({
  register,
  errors,
  isViewOnly,
  patientId,
  currentPatientName,
  showToast,
}: MeltanyossagiSectionProps) {
  return (
    <div className="card">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <FileText className="w-5 h-5 mr-2 text-medical-primary" />
        Méltányossági kérelemhez szükséges adatok
      </h4>
      <div className="space-y-4">
        {/* Kórtörténeti összefoglaló */}
        <div>
          <label className="form-label">
            Kórtörténeti összefoglaló (3 hónapnál nem régebbi)
          </label>
          <textarea
            {...register('kortortenetiOsszefoglalo')}
            className="form-input min-h-[100px]"
            placeholder="Kórtörténeti összefoglaló..."
            readOnly={isViewOnly}
            rows={4}
          />
          {errors.kortortenetiOsszefoglalo && (
            <p className="text-red-500 text-sm mt-1">{errors.kortortenetiOsszefoglalo.message}</p>
          )}
        </div>

        {/* Szakorvosi vélemény */}
        <div>
          <label className="form-label">
            Szakorvosi vélemény az eszközrendelés szükségességéről (orvosszakmai indok)
          </label>
          <textarea
            {...register('szakorvosiVelemény')}
            className="form-input min-h-[100px]"
            placeholder="Szakorvosi vélemény..."
            readOnly={isViewOnly}
            rows={4}
          />
          {errors.szakorvosiVelemény && (
            <p className="text-red-500 text-sm mt-1">{errors.szakorvosiVelemény.message}</p>
          )}
        </div>

        {/* Nyilatkozat */}
        <div>
          <label className="form-label">Nyilatkozat a kezelési tervben rögzített, tervezett ellátás vállalásáról</label>
          <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
            <p className="text-gray-700">
              {EQUITY_REQUEST_CONFIG.megbizottNeve} megbízásából alulírott, a kezelési tervben foglaltak elvégzését vállalom.
            </p>
          </div>
        </div>

        {/* PDF generáló gomb */}
        {!isViewOnly && (
          <div className="pt-4">
            <button
              type="button"
              onClick={async () => {
                if (!patientId) {
                  showToast('Először mentse el a beteg adatait!', 'error');
                  return;
                }
                
                try {
                  showToast('PDF generálása folyamatban...', 'info');
                  const response = await fetch(`/api/patients/${patientId}/generate-equity-request-pdf`, {
                    method: 'GET',
                    credentials: 'include',
                  });

                  if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'PDF generálási hiba');
                  }

                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `Meltanyossagi_kerelm_${currentPatientName || 'Beteg'}_${Date.now()}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                  showToast('PDF sikeresen generálva és letöltve', 'success');
                } catch (error) {
                  console.error('PDF generálási hiba:', error);
                  showToast(
                    error instanceof Error ? error.message : 'Hiba történt a PDF generálása során',
                    'error'
                  );
                }
              }}
              className="btn-primary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Méltányossági kérelem PDF generálása
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
