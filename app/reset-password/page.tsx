import { Suspense } from 'react';
import ResetPasswordPageClient from './ResetPasswordPageClient';

function ResetPasswordPageFallback() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="animate-pulse text-gray-500 dark:text-gray-400">Betöltés...</div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordPageFallback />}>
      <ResetPasswordPageClient />
    </Suspense>
  );
}
