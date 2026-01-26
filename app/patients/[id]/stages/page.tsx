'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Patient } from '@/lib/types';
import { ArrowLeft, Calendar } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { MobileMenu } from '@/components/MobileMenu';
import { PatientStageSelector } from '@/components/PatientStageSelector';
import { PatientStageTimeline } from '@/components/PatientStageTimeline';
import { useToast } from '@/contexts/ToastContext';

export default function PatientStagesPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;
  const { showToast } = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        setUserRole(user.role);

        // Only admin and doctors can access this page
        if (user.role !== 'admin' && user.role !== 'sebészorvos' && user.role !== 'fogpótlástanász') {
          showToast('Nincs jogosultsága az oldal megtekintéséhez', 'error');
          router.push('/');
          return;
        }

        // Fetch patient data
        try {
          const response = await fetch(`/api/patients/${patientId}`, {
            credentials: 'include',
          });

          if (!response.ok) {
            if (response.status === 403) {
              router.push('/');
              return;
            }
            if (response.status === 404) {
              router.push('/');
              return;
            }
            throw new Error('Failed to fetch patient');
          }

          const data = await response.json();
          setPatient(data.patient);
          setAuthorized(true);
        } catch (error) {
          console.error('Error fetching patient:', error);
          router.push('/');
          return;
        }

        // Fetch current stage
        try {
          const stagesResponse = await fetch(`/api/patients/${patientId}/stages`, {
            credentials: 'include',
          });

          if (stagesResponse.ok) {
            const stagesData = await stagesResponse.json();
            setCurrentStage(stagesData.timeline?.currentStage || null);
          }
        } catch (error) {
          console.error('Error fetching current stage:', error);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    if (patientId) {
      checkAuth();
    }
  }, [router, patientId, showToast]);

  const handleBack = () => {
    router.back();
  };

  const handleStageChanged = () => {
    setRefreshKey((prev) => prev + 1);
    // Refresh current stage
    fetch(`/api/patients/${patientId}/stages`, {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        setCurrentStage(data.timeline?.currentStage || null);
      })
      .catch((error) => {
        console.error('Error refreshing stage:', error);
      });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
        </div>
      </div>
    );
  }

  if (!authorized || !patient) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                aria-label="Vissza"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Logo />
            </div>
            <MobileMenu />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-medical-primary" />
            Betegstádiumok - {patient.nev || 'Névtelen beteg'}
          </h1>
          <p className="text-gray-600 mt-1">
            Stádiumok kezelése és timeline megtekintése
          </p>
        </div>

        <div className="space-y-6">
          {/* Stage Selector - only for admin and doctors */}
          {(userRole === 'admin' || userRole === 'sebészorvos' || userRole === 'fogpótlástanász') && (
            <PatientStageSelector
              patientId={patientId}
              currentStage={currentStage}
              onStageChanged={handleStageChanged}
            />
          )}

          {/* Timeline */}
          <PatientStageTimeline key={refreshKey} patientId={patientId} />
        </div>
      </main>
    </div>
  );
}
