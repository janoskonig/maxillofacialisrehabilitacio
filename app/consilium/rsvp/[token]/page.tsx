import { Suspense } from 'react';
import ConsiliumRsvpPageClient from './ConsiliumRsvpPageClient';

function ConsiliumRsvpPageFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-pulse text-gray-500">Betöltés...</div>
    </div>
  );
}

export default function ConsiliumRsvpPage() {
  return (
    <Suspense fallback={<ConsiliumRsvpPageFallback />}>
      <ConsiliumRsvpPageClient />
    </Suspense>
  );
}
