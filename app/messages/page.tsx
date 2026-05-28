import { Suspense } from 'react';
import MessagesPageClient from './MessagesPageClient';

function MessagesPageFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-pulse text-gray-500">Betöltés...</div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<MessagesPageFallback />}>
      <MessagesPageClient />
    </Suspense>
  );
}
