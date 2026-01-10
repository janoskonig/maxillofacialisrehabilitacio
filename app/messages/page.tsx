'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { DoctorMessages } from '@/components/DoctorMessages';
import { PatientMessagesList } from '@/components/PatientMessagesList';
import { ArrowLeft, MessageCircle, Users } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { MobileMenu } from '@/components/MobileMenu';

export default function MessagesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'doctor-doctor' | 'doctor-patient'>('doctor-doctor');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        setAuthorized(true);
      } catch (error) {
        console.error('Auth check error:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  // Set active tab from URL query parameter
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'doctor-patient' || tab === 'doctor-doctor') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleBack = () => {
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Betöltés...</div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

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
                  Üzenetek
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MobileMenu showBackButton={true} />
              <button
                onClick={handleBack}
                className="btn-secondary flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Vissza</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tabs */}
        <div className="mb-4 border-b border-gray-200">
          <nav className="flex gap-1" aria-label="Üzenetek fülök">
            <button
              onClick={() => setActiveTab('doctor-doctor')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'doctor-doctor'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <Users className="w-4 h-4" />
              Orvos-orvos
            </button>
            <button
              onClick={() => setActiveTab('doctor-patient')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'doctor-patient'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <MessageCircle className="w-4 h-4" />
              Orvos-beteg
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'doctor-doctor' ? (
          <DoctorMessages />
        ) : (
          <PatientMessagesList />
        )}
      </main>
    </div>
  );
}

