'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PortalLogin } from '@/components/patient-portal/PortalLogin';
import { PortalRegister } from '@/components/patient-portal/PortalRegister';
import { Logo } from '@/components/Logo';
import { useToast } from '@/contexts/ToastContext';

export default function PatientPortalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
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
          {/* Toggle between login and register */}
          <div className="flex rounded-lg border border-gray-200 bg-white mb-6 overflow-hidden">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                isLogin
                  ? 'bg-medical-primary text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Bejelentkezés
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors border-l ${
                !isLogin
                  ? 'bg-medical-primary text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Regisztráció
            </button>
          </div>

          {/* Login or Register Form */}
          {isLogin ? <PortalLogin /> : <PortalRegister />}

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


