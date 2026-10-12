import type { Patient } from '@/lib/types';
import { calculateAge, formatDateForDisplay } from '@/lib/dateUtils';

interface PatientDemographicsProps {
  patient: Patient;
  className?: string;
}

/** A beteg azonosításához szükséges életkor, nem és dátumok. */
export function PatientDemographics({ patient, className }: PatientDemographicsProps) {
  const calculatedAge = calculateAge(patient.szuletesiDatum, patient.halalDatum);
  const age = calculatedAge != null && Number.isFinite(calculatedAge) && calculatedAge >= 0
    ? calculatedAge
    : null;
  const gender = patient.nem === 'ferfi' ? 'Férfi' : patient.nem === 'no' ? 'Nő' : null;
  const demographics = [
    gender,
    age == null ? null : patient.halalDatum ? `${age} évesen hunyt el` : `${age} éves`,
  ].filter(Boolean);
  const dates = [
    patient.szuletesiDatum ? `Szül.: ${formatDateForDisplay(patient.szuletesiDatum)}` : null,
    patient.halalDatum ? `Elhunyt: ${formatDateForDisplay(patient.halalDatum)}` : null,
  ].filter(Boolean);

  if (!demographics.length && !dates.length) return null;

  return (
    <div className={className ?? 'text-xs text-gray-600 dark:text-gray-400'}>
      {demographics.length > 0 && <p>{demographics.join(' · ')}</p>}
      {dates.length > 0 && <p>{dates.join(' · ')}</p>}
    </div>
  );
}
