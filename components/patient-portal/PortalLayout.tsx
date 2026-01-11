'use client';

import { ReactNode, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { LogOut, LayoutDashboard, Calendar, FileText, User, MessageCircle, Menu, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface PortalLayoutProps {
  children: ReactNode;
}

export function PortalLayout({ children }: PortalLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const [patientName, setPatientName] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
          <div className="flex items-center justify-between py-3 sm:py-4">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0">
                <Logo width={40} height={46} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg lg:text-xl font-bold text-medical-primary truncate">
                  Páciens portál
                </h1>
                {patientName && (
                  <p className="text-xs sm:text-sm text-gray-600 truncate">{patientName}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="btn-secondary flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 flex-shrink-0"
            >
              <LogOut className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Kijelentkezés</span>
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
          {/* Mobile Menu Button */}
          <div className="sm:hidden flex items-center justify-between py-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex items-center gap-2 px-3 py-2 text-gray-700 hover:text-medical-primary transition-colors"
              aria-label="Menü"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
              <span className="text-sm font-medium">Menü</span>
            </button>
          </div>

          {/* Mobile Menu Dropdown */}
          {mobileMenuOpen && (
            <div className="sm:hidden border-t">
              <div className="flex flex-col">
                <a
                  href="/patient-portal/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-l-4 transition-colors ${
                    pathname === '/patient-portal/dashboard'
                      ? 'text-medical-primary border-medical-primary bg-medical-primary/5'
                      : 'text-gray-700 border-transparent hover:text-medical-primary hover:border-medical-primary hover:bg-gray-50'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Áttekintés
                </a>
                <a
                  href="/patient-portal/appointments"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-l-4 transition-colors ${
                    pathname === '/patient-portal/appointments'
                      ? 'text-medical-primary border-medical-primary bg-medical-primary/5'
                      : 'text-gray-700 border-transparent hover:text-medical-primary hover:border-medical-primary hover:bg-gray-50'
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                  Időpontok
                </a>
                <a
                  href="/patient-portal/documents"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-l-4 transition-colors ${
                    pathname === '/patient-portal/documents'
                      ? 'text-medical-primary border-medical-primary bg-medical-primary/5'
                      : 'text-gray-700 border-transparent hover:text-medical-primary hover:border-medical-primary hover:bg-gray-50'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Dokumentumok
                </a>
                <a
                  href="/patient-portal/messages"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-l-4 transition-colors ${
                    pathname === '/patient-portal/messages'
                      ? 'text-medical-primary border-medical-primary bg-medical-primary/5'
                      : 'text-gray-700 border-transparent hover:text-medical-primary hover:border-medical-primary hover:bg-gray-50'
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                  Üzenetek
                </a>
                <a
                  href="/patient-portal/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-l-4 transition-colors ${
                    pathname === '/patient-portal/profile'
                      ? 'text-medical-primary border-medical-primary bg-medical-primary/5'
                      : 'text-gray-700 border-transparent hover:text-medical-primary hover:border-medical-primary hover:bg-gray-50'
                  }`}
                >
                  <User className="w-4 h-4" />
                  Adataim
                </a>
              </div>
            </div>
          )}

          {/* Desktop Navigation */}
          <div className="hidden sm:flex gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide">
            <a
              href="/patient-portal/dashboard"
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                pathname === '/patient-portal/dashboard'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden xs:inline">Áttekintés</span>
              <span className="xs:hidden">Áttek.</span>
            </a>
            <a
              href="/patient-portal/appointments"
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                pathname === '/patient-portal/appointments'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden xs:inline">Időpontok</span>
              <span className="xs:hidden">Időpont</span>
            </a>
            <a
              href="/patient-portal/documents"
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                pathname === '/patient-portal/documents'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Dokumentumok
            </a>
            <a
              href="/patient-portal/messages"
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                pathname === '/patient-portal/messages'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden xs:inline">Üzenetek</span>
              <span className="xs:hidden">Üzenet</span>
            </a>
            <a
              href="/patient-portal/profile"
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                pathname === '/patient-portal/profile'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden xs:inline">Adataim</span>
              <span className="xs:hidden">Adatok</span>
            </a>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
        {children}
      </main>
    </div>
  );
}

