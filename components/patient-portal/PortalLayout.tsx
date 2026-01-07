'use client';

import { ReactNode, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { LogOut, LayoutDashboard, Calendar, FileText, User, MessageCircle } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface PortalLayoutProps {
  children: ReactNode;
}

export function PortalLayout({ children }: PortalLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const [patientName, setPatientName] = useState<string | null>(null);

  useEffect(() => {
    // Fetch patient name for header
    const fetchPatientInfo = async () => {
      try {
        const response = await fetch('/api/patient-portal/patient', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setPatientName(data.patient?.nev || null);
        }
      } catch (error) {
        console.error('Error fetching patient info:', error);
      }
    };
    fetchPatientInfo();
  }, []);

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/patient-portal/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (response.ok) {
        showToast('Sikeresen kijelentkezett', 'success');
        router.push('/patient-portal');
      }
    } catch (error) {
      console.error('Error logging out:', error);
      // Still redirect even if logout fails
      router.push('/patient-portal');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <Logo width={50} height={58} />
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-medical-primary">
                  Páciens portál
                </h1>
                {patientName && (
                  <p className="text-sm text-gray-600">{patientName}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Kijelentkezés</span>
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto">
            <a
              href="/patient-portal/dashboard"
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                pathname === '/patient-portal/dashboard'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Áttekintés
            </a>
            <a
              href="/patient-portal/appointments"
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                pathname === '/patient-portal/appointments'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Időpontok
            </a>
            <a
              href="/patient-portal/documents"
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                pathname === '/patient-portal/documents'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <FileText className="w-4 h-4" />
              Dokumentumok
            </a>
            <a
              href="/patient-portal/messages"
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                pathname === '/patient-portal/messages'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <MessageCircle className="w-4 h-4" />
              Üzenetek
            </a>
            <a
              href="/patient-portal/profile"
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                pathname === '/patient-portal/profile'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <User className="w-4 h-4" />
              Adataim
            </a>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}

