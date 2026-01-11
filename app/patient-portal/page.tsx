'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PortalLogin } from '@/components/patient-portal/PortalLogin';
import { Logo } from '@/components/Logo';
import { useToast } from '@/contexts/ToastContext';

export default function PatientPortalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      switch (error) {
        case 'missing_token':
          showToast('Hiányzó vagy érvénytelen token', 'error');
          break;
        case 'invalid_token':
          showToast('Érvénytelen vagy lejárt token', 'error');
          break;
        case 'token_used':
          showToast('Ez a bejelentkezési link már felhasználva lett. Kérjük, jelentkezzen be újra.', 'error');
          break;
        case 'verification_failed':
          showToast('Email megerősítés sikertelen', 'error');
          break;
        case 'database_error':
          showToast('Adatbázis hiba. Kérjük, lépjen kapcsolatba az adminisztrációval.', 'error');
          break;
        default:
          showToast('Hiba történt', 'error');
      }
    }
  }, [searchParams, showToast]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-center">
            <div className="w-[50px] h-[58px] sm:w-[60px] sm:h-[69px] flex-shrink-0">
              <Logo width={50} height={58} />
            </div>
            <div className="ml-3 sm:ml-4">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-medical-primary">
                Maxillofaciális Rehabilitáció
              </h1>
              <p className="text-xs sm:text-sm text-gray-600">Páciens portál</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center py-6 sm:py-8 px-3 sm:px-4 lg:px-8">
        <div className="w-full max-w-md">
          {/* Message */}
          <div className="mb-4 sm:mb-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4">
              <p className="text-xs sm:text-sm text-green-900 font-medium">
                Ha Ön páciens, kérem kattintson az alábbi linkre és kövesse az utasításokat.
              </p>
            </div>
          </div>

          {/* Magic Link Form */}
          <PortalLogin />

          {/* Info */}
          <div className="mt-4 sm:mt-6 text-center text-xs sm:text-sm text-gray-600">
            <p>Beutaló szükséges az időpontfoglaláshoz.</p>
            <p className="mt-1.5 sm:mt-2">
              Kérdéseivel forduljon:{' '}
              <a
                href="mailto:konig.janos@semmelweis.hu"
                className="text-medical-primary hover:underline break-all"
              >
                konig.janos@semmelweis.hu
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}








