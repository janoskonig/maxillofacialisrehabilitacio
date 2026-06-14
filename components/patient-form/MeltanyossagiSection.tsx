'use client';

import { useState } from 'react';
import { UseFormRegister, UseFormWatch, FieldErrors } from 'react-hook-form';
import { Patient } from '@/lib/types';
import { EQUITY_REQUEST_CONFIG } from '@/lib/equity-request-config';
import { FileText, Download } from 'lucide-react';
import { ReadField, ReadGrid, SectionShell, isEmptyValue } from './read/ReadView';

interface MeltanyossagiSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  patientId: string | null;
  currentPatientName: string | null | undefined;
  showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => string;
}

export function MeltanyossagiSection({
  register,
  watch,
  errors,
  isViewOnly,
  patientId,
  currentPatientName,
  showToast,
}: MeltanyossagiSectionProps) {
  const [editing, setEditing] = useState(false);
  const kortortenet = watch('kortortenetiOsszefoglalo') as unknown as string | undefined;
  const szakvelemeny = watch('szakorvosiVelemény') as unknown as string | undefined;
  const missingCount = [kortortenet, szakvelemeny].filter(isEmptyValue).length;

  const downloadDoc = async (path: string, filenamePrefix: string, ext: string, progress: string) => {
    if (!patientId) {
      showToast('Először mentse el a beteg adatait!', 'error');
      return;
    }
    try {
      showToast(progress, 'info');
      const response = await fetch(`/api/patients/${patientId}/${path}`, { method: 'GET', credentials: 'include' });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Dokumentum generálási hiba');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenamePrefix}_${currentPatientName || 'Beteg'}_${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast('Dokumentum sikeresen generálva', 'success');
    } catch (error) {
      console.error('Dokumentum generálási hiba:', error);
      showToast(error instanceof Error ? error.message : 'Hiba történt a dokumentum generálása során', 'error');
    }
  };

  return (
    <SectionShell
      id="meltanyossagi"
      title="Méltányossági kérelemhez szükséges adatok"
      icon={<FileText className="w-5 h-5" />}
      missingCount={missingCount}
      editing={editing}
      onToggleEdit={() => setEditing(e => !e)}
      isViewOnly={isViewOnly}
    >
      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="form-label">Kórtörténeti összefoglaló (3 hónapnál nem régebbi)</label>
            <textarea {...register('kortortenetiOsszefoglalo')} className="form-input min-h-[100px]" placeholder="Kórtörténeti összefoglaló..." readOnly={isViewOnly} rows={4} />
            {errors.kortortenetiOsszefoglalo && (
              <p className="text-red-500 text-sm mt-1">{errors.kortortenetiOsszefoglalo.message}</p>
            )}
          </div>
          <div>
            <label className="form-label">Szakorvosi vélemény az eszközrendelés szükségességéről (orvosszakmai indok)</label>
            <textarea {...register('szakorvosiVelemény')} className="form-input min-h-[100px]" placeholder="Szakorvosi vélemény..." readOnly={isViewOnly} rows={4} />
            {errors.szakorvosiVelemény && (
              <p className="text-red-500 text-sm mt-1">{errors.szakorvosiVelemény.message}</p>
            )}
          </div>
        </div>
      ) : (
        <ReadGrid>
          <ReadField label="Kórtörténeti összefoglaló" value={kortortenet} full />
          <ReadField label="Szakorvosi vélemény" value={szakvelemeny} full />
        </ReadGrid>
      )}

      {/* Nyilatkozat — statikus */}
      <div className="mt-4">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Nyilatkozat a tervezett ellátás vállalásáról</div>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-md border border-gray-200 dark:border-gray-700">
          <p className="text-gray-700 dark:text-gray-200 text-sm">
            {EQUITY_REQUEST_CONFIG.megbizottNeve} megbízásából alulírott, a kezelési tervben foglaltak elvégzését vállalom.
          </p>
        </div>
      </div>

      {/* Dokumentum generálás — olvasó módban is elérhető */}
      {!isViewOnly && (
        <div className="pt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => downloadDoc('generate-equity-request-pdf', 'Meltanyossagi_kerelm', 'pdf', 'PDF generálása folyamatban...')}
            className="btn-primary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Méltányossági kérelem PDF generálása
          </button>
          <button
            type="button"
            onClick={() => downloadDoc('generate-allergy-referral-docx', 'Allergia_vizsgalat_kerese', 'docx', 'Allergia vizsgálat kérés generálása...')}
            className="btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Allergia vizsgálat kérés
          </button>
        </div>
      )}
    </SectionShell>
  );
}
