'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PatientHistory } from '@/components/PatientHistory';
import { Clock } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';

export default function PatientHistoryPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;
  const [authorized, setAuthorized] = useState(false);
  const [patientName, setPatientName] = useState<string | null>(null);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Clock className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-500 dark:text-gray-400">Betöltés...</p>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <AppShell title="Páciens életút" backTo="/" maxWidth="xl">
      <div className="mb-6">
        {patientName && (
          <p className="text-gray-600 dark:text-gray-400">
            {patientName}
          </p>
        )}
      </div>

      <PatientHistory patientId={patientId} />
    </AppShell>
  );
}

