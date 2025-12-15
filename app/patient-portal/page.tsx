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
          showToast('Ez a bejelentkezési link már felhasználva lett', 'error');
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-center">
            <Logo width={60} height={69} />
            <div className="ml-4">
              <h1 className="text-xl sm:text-2xl font-bold text-medical-primary">
                Maxillofaciális Rehabilitáció
              </h1>
              <p className="text-sm text-gray-600">Páciens portál</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center py-8 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          {/* Message */}
          <div className="mb-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-900 font-medium">
                Ha Ön páciens, kérem kattintson az alábbi linkre és kövesse az utasításokat.
              </p>
            </div>
          </div>

          {/* Magic Link Form */}
          <PortalLogin />

          {/* Info */}
          <div className="mt-6 text-center text-sm text-gray-600">
            <p>Beutaló szükséges az időpontfoglaláshoz.</p>
            <p className="mt-2">
              Kérdéseivel forduljon:{' '}
              <a
                href="mailto:konig.janos@semmelweis.hu"
                className="text-medical-primary hover:underline"
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








