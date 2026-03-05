'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Patient, patientSchema } from '@/lib/types';
import { savePatient } from '@/lib/storage';
import { PatientForm } from '@/components/PatientForm';
import { useToast } from '@/contexts/ToastContext';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';

export default function NewPatientPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.push('/login');
        return;
      }
      if (user.role !== 'admin' && user.role !== 'fogpótlástanász' && user.role !== 'sebészorvos') {
        router.push('/');
        return;
      }
      setAuthorized(true);
    };
    checkAuth();
  }, [router]);

  const handleSave = async (patientData: Patient, options?: { source: 'auto' | 'manual' }) => {
    const source = options?.source || 'manual';

    try {
      if (patientData.id) {
        if (source === 'manual') {
          showToast('Betegadat sikeresen mentve', 'success');
        }
        return;
      }

      const validatedPatient = patientSchema.parse(patientData);
      const savedPatient = await savePatient(validatedPatient);

      if (source === 'manual') {
        showToast('Új beteg sikeresen létrehozva', 'success');
        if (savedPatient?.id) {
          router.push(`/patients/${savedPatient.id}/view`);
        } else {
          router.push('/');
        }
      }
    } catch (error: any) {
      let errorMessage = 'Kérjük, ellenőrizze az összes kötelező mezőt és próbálja újra.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('Load failed') || errorMessage.includes('csatlakozni')) {
        errorMessage = 'Nem sikerült csatlakozni a szerverhez. Ellenőrizze az internetkapcsolatot és próbálja újra.';
      }

      if (source === 'manual') {
        showToast(`Hiba a mentés során: ${errorMessage}`, 'error');
      }
    }
  };

  const handleCancel = () => {
    router.push('/');
  };

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary mx-auto mb-4"></div>
          <p className="text-gray-500">Betöltés...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-soft border-b border-gray-200/60 sticky top-0 z-40 backdrop-blur-sm bg-white/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-2 md:py-3">
            <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
              <div className="flex-shrink-0">
                <Logo width={32} height={37} className="md:w-[50px] md:h-[58px]" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base md:text-xl font-semibold text-medical-primary truncate tracking-tight">
                  Új beteg
                </h1>
                <p className="text-xs text-gray-500 hidden sm:block font-medium mt-0.5">
                  ÚJ BETEG FELVÉTELE
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Vissza</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-20 md:pb-4">
        <PatientForm
          patient={null}
          onSave={handleSave}
          onCancel={handleCancel}
          isViewOnly={false}
        />
      </main>

      <MobileBottomNav />
    </div>
  );
}
