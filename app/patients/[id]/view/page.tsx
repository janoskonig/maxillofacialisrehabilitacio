'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PatientForm } from '@/components/PatientForm';
import { Patient } from '@/lib/types';
import { ArrowLeft, User, FileText, Calendar, ClipboardList, MessageCircle, Users } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { MobileMenu } from '@/components/MobileMenu';
import { CommunicationLog } from '@/components/CommunicationLog';
import { PatientMessages } from '@/components/PatientMessages';
import { DoctorMessagesForPatient } from '@/components/DoctorMessagesForPatient';

type TabType = 'alapadatok' | 'anamnezis' | 'adminisztracio' | 'idopont' | 'konzilium' | 'uzenet';

export default function PatientViewPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;
  const [authorized, setAuthorized] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [patientEmail, setPatientEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('alapadatok');
  const [loadedTabs, setLoadedTabs] = useState<Set<TabType>>(new Set<TabType>(['alapadatok']));

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        setUserRole(user.role);

        // Fetch patient data to verify access
        try {
          const response = await fetch(`/api/patients/${patientId}`, {
            credentials: 'include',
          });

          if (!response.ok) {
            if (response.status === 403) {
              router.push('/');
              return;
            }
            if (response.status === 404) {
              router.push('/');
              return;
            }
            throw new Error('Failed to fetch patient');
          }

          const data = await response.json();
          setPatient(data.patient);
          setPatientEmail(data.patient?.email || null);
          setAuthorized(true);
        } catch (error) {
          console.error('Error fetching patient:', error);
          router.push('/');
          return;
        }
      } catch (error) {
        console.error('Auth check error:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    if (patientId) {
      checkAuth();
    }
  }, [router, patientId]);

  const handleBack = () => {
    router.back();
  };

  const handleSavePatient = async (savedPatient: Patient) => {
    // Frissítjük a beteg adatokat a mentés után
    setPatient(savedPatient);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    // Lazy load: csak akkor töltjük be a tab tartalmát, amikor először megnyitjuk
    if (!loadedTabs.has(tab)) {
      setLoadedTabs(prev => new Set<TabType>([...Array.from(prev), tab]));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Betöltés...</div>
      </div>
    );
  }

  if (!authorized || !patient) {
    return null;
  }

  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: 'alapadatok', label: 'Alapadatok', icon: <User className="w-4 h-4" /> },
    { id: 'anamnezis', label: 'Anamnézis és betegvizsgálat', icon: <FileText className="w-4 h-4" /> },
    { id: 'adminisztracio', label: 'Adminisztráció', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'idopont', label: 'Időpontfoglalás', icon: <Calendar className="w-4 h-4" /> },
    { id: 'konzilium', label: 'Konzílium', icon: <Users className="w-4 h-4" /> },
    { id: 'uzenet', label: 'Üzenet a betegnek', icon: <MessageCircle className="w-4 h-4" /> },
  ];

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
                  Beteg profil
                </h1>
                {patient.nev && (
                  <p className="text-sm text-gray-600">{patient.nev}</p>
                )}
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
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Betegűrlap fülök">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'text-medical-primary border-medical-primary'
                    : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'alapadatok' && loadedTabs.has('alapadatok') && (
            <PatientForm
              patient={patient}
              isViewOnly={false}
              onSave={handleSavePatient}
              onCancel={handleBack}
              showOnlySections={['alapadatok', 'szemelyes', 'beutalo', 'kezeloorvos']}
            />
          )}

          {activeTab === 'anamnezis' && loadedTabs.has('anamnezis') && (
            <PatientForm
              patient={patient}
              isViewOnly={false}
              onSave={handleSavePatient}
              onCancel={handleBack}
              showOnlySections={['anamnezis', 'betegvizsgalat']}
            />
          )}

          {activeTab === 'adminisztracio' && loadedTabs.has('adminisztracio') && (
            <PatientForm
              patient={patient}
              isViewOnly={false}
              onSave={handleSavePatient}
              onCancel={handleBack}
              showOnlySections={['adminisztracio']}
            />
          )}

          {activeTab === 'idopont' && loadedTabs.has('idopont') && (
            <PatientForm
              patient={patient}
              isViewOnly={false}
              onSave={handleSavePatient}
              onCancel={handleBack}
              showOnlySections={['idopont']}
            />
          )}

          {activeTab === 'konzilium' && loadedTabs.has('konzilium') && patient?.id && (
            <DoctorMessagesForPatient patientId={patient.id} patientName={patient.nev || null} />
          )}

          {activeTab === 'uzenet' && loadedTabs.has('uzenet') && patientEmail && patient?.id && (
            <PatientMessages patientId={patient.id} patientName={patient.nev || null} />
          )}

          {/* Communication Log - mindig látható az alapadatok tab alatt */}
          {activeTab === 'alapadatok' && patient?.id && (
            <CommunicationLog patientId={patient.id} patientName={patient.nev || null} />
          )}
        </div>
      </main>
    </div>
  );
}
