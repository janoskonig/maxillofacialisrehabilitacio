import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getPatientPortalSessionInfo } from '@/lib/patient-portal-server';
import PatientPortalPageClient from './PatientPortalPageClient';

export const dynamic = 'force-dynamic';

function PatientPortalPageFallback() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="animate-pulse text-gray-500 dark:text-gray-400">Betöltés...</div>
    </div>
  );
}

export default async function PatientPortalPage() {
  if (await getPatientPortalSessionInfo()) {
    redirect('/patient-portal/dashboard');
  }
  return (
    <Suspense fallback={<PatientPortalPageFallback />}>
      <PatientPortalPageClient />
    </Suspense>
  );
}
