import { Suspense } from 'react';
import PatientPortalDashboardPageClient from './PatientPortalDashboardPageClient';

function PatientPortalDashboardFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-pulse text-gray-500">Betöltés...</div>
    </div>
  );
}

export default function PatientPortalDashboardPage() {
  return (
    <Suspense fallback={<PatientPortalDashboardFallback />}>
      <PatientPortalDashboardPageClient />
    </Suspense>
  );
}
