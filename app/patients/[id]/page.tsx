'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { CommunicationLog } from '@/components/CommunicationLog';
import { PatientMessages } from '@/components/PatientMessages';
import { DoctorMessagesForPatient } from '@/components/DoctorMessagesForPatient';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { MobileMenu } from '@/components/MobileMenu';

export default function PatientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;
  const [authorized, setAuthorized] = useState(false);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [patientEmail, setPatientEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        // Fetch patient data to verify access and get name
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
          setPatientName(data.patient?.nev || null);
          setPatientEmail(data.patient?.email || null);
          setAuthorized(true);
        } catch (error) {
          console.error('Error fetching patient:', error);
          router.push('/');
          return;
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
  }, [router, patientId]);

  const handleBack = () => {
    router.push('/');
  };

  // #region agent log
  useEffect(() => {
    if (authorized && patientId) {
      fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/patients/[id]/page.tsx:71',message:'Rendering DoctorMessagesForPatient',data:{patientId,patientName,authorized},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    }
  }, [authorized, patientId, patientName]);
  // #endregion

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Betöltés...</div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <Logo width={50} height={58} />
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-medical-primary">
                  Beteg részletek
                </h1>
                {patientName && (
                  <p className="text-sm text-gray-600">{patientName}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MobileMenu showBackButton={true} />
              <button
                onClick={handleBack}
                className="btn-secondary flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Vissza</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">
          {/* Chat Messages - csak ha van email-cím */}
          {patientEmail && (
            <PatientMessages patientId={patientId} patientName={patientName} />
          )}
          
          {/* Konzílium - Orvos-orvos üzenetek */}
          <DoctorMessagesForPatient patientId={patientId} patientName={patientName} />
          
          {/* Communication Log - mindig látható */}
          <CommunicationLog patientId={patientId} patientName={patientName} />
        </div>
      </main>
    </div>
  );
}

