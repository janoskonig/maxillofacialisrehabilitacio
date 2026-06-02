'use client';

import { ClipboardList } from 'lucide-react';
import { QuickTaskForm } from './QuickTaskForm';

export interface PatientQuickTaskBlockProps {
  patientId: string;
}

/**
 * Beteg kartonjáról kézi Feladataim teendő létrehozása (magamnak vagy kollégának),
 * a beteghez kötve. Az "Adminisztráció" fülön jelenik meg.
 */
export function PatientQuickTaskBlock({ patientId }: PatientQuickTaskBlockProps) {
  return (
    <div className="card p-4">
      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <ClipboardList className="w-5 h-5 text-medical-primary" />
        Feladat hozzáadása
      </h3>
      <p className="text-sm text-gray-600 mb-3">
        A teendő ehhez a beteghez kötve jön létre, és a felelős Feladataim listáján jelenik meg.
      </p>
      <QuickTaskForm patientId={patientId} />
    </div>
  );
}
