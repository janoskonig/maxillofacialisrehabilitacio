'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { OHIP14Section } from '@/components/OHIP14Section';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface Patient {
  id: string;
  nev: string | null;
}

export function PatientOHIP14View() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<Patient | null>(null);

  useEffect(() => {
    fetchPatient();
  }, []);

  const fetchPatient = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/patient-portal/patient', {
        credentials: 'include',
      });

      if (!response.ok || response.status === 401) {
        router.push('/patient-portal');
        return;
      }

      const data = await response.json();
      setPatient(data.patient);
    } catch (error) {
      console.error('Hiba a beteg adatok betöltésekor:', error);
      showToast('Hiba történt az adatok betöltésekor', 'error');
      router.push('/patient-portal');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-10 h-10 animate-spin text-medical-primary" />
        <p className="mt-4 text-gray-600">Betöltés...</p>
      </div>
    );
  }

  if (!patient?.id) {
    return null;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-4">OHIP-14 kérdőív</h2>
      <p className="text-gray-600 mb-6">
        Kérjük, töltse ki a szájegészségével kapcsolatos kérdőívet. A kitöltés a jelenlegi kezelési
        stádiumának megfelelő időpontra érhető el.
      </p>
      <OHIP14Section
        patientId={patient.id}
        isViewOnly={false}
        isPatientPortal={true}
      />
    </div>
  );
}
