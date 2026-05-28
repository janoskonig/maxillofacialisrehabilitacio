import { Suspense } from 'react';
import PatientPortalPageClient from './PatientPortalPageClient';

function PatientPortalPageFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-pulse text-gray-500">Betöltés...</div>
    </div>
  );
}

export default function PatientPortalPage() {
  return (
    <Suspense fallback={<PatientPortalPageFallback />}>
      <PatientPortalPageClient />
    </Suspense>
  );
}
