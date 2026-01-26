'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PatientForm } from '@/components/PatientForm';
import { Patient, patientStageOptions, PatientStageEntry } from '@/lib/types';
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
  const [currentStage, setCurrentStage] = useState<PatientStageEntry | null>(null);

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

          // Fetch current stage
          try {
            const stagesResponse = await fetch(`/api/patients/${patientId}/stages`, {
              credentials: 'include',
            });

            if (stagesResponse.ok) {
              const stagesData = await stagesResponse.json();
              setCurrentStage(stagesData.timeline?.currentStage || null);
            }
          } catch (error) {
            console.error('Error fetching current stage:', error);
          }
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

  const handleImpersonate = async () => {
    if (!patientId) return;
    
    try {
      const response = await fetch('/api/patient-portal/auth/impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ patientId }),
      });

      if (response.ok) {
        const data = await response.json();
        // Redirect to patient portal
        window.location.href = data.redirectUrl || '/patient-portal/dashboard';
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt a bejelentkezéskor');
      }
    } catch (error) {
      console.error('Error impersonating patient:', error);
      alert('Hiba történt a bejelentkezéskor');
    }
  };

  const handleSavePatient = async (savedPatient: Patient, options?: { source?: 'auto' | 'manual' }) => {
    // Frissítjük a beteg adatokat a mentés után
    // Auto-save és manual save esetén is frissítjük
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

  const tabs: Array<{ id: TabType; label: string; shortLabel: string; icon: React.ReactNode }> = [
    { id: 'alapadatok', label: 'Alapadatok', shortLabel: 'Alap', icon: <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
    { id: 'anamnezis', label: 'Anamnézis és betegvizsgálat', shortLabel: 'Anamnézis', icon: <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
    { id: 'adminisztracio', label: 'Adminisztráció', shortLabel: 'Admin', icon: <ClipboardList className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
    { id: 'idopont', label: 'Időpontfoglalás', shortLabel: 'Időpont', icon: <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
    { id: 'konzilium', label: 'Konzílium', shortLabel: 'Konzílium', icon: <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
    { id: 'uzenet', label: 'Üzenet a betegnek', shortLabel: 'Üzenet', icon: <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8">
          <div className="flex items-center justify-between py-2 sm:py-4">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
              <div className="hidden sm:block">
                <Logo width={50} height={58} />
              </div>
              <div className="block sm:hidden">
                <Logo width={40} height={46} />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base sm:text-lg lg:text-xl font-bold text-medical-primary truncate">
                  Beteg profil
                </h1>
                <div className="flex items-center gap-2 flex-wrap">
                  {patient.nev && (
                    <p className="text-xs sm:text-sm text-gray-600 truncate">{patient.nev}</p>
                  )}
                  {currentStage && (() => {
                    const stageLabel = patientStageOptions.find(opt => opt.value === currentStage.stage)?.label || currentStage.stage;
                    const getStageColor = (stage: string) => {
                      const colors: Record<string, string> = {
                        uj_beteg: 'bg-blue-100 text-blue-800',
                        onkologiai_kezeles_kesz: 'bg-purple-100 text-purple-800',
                        arajanlatra_var: 'bg-yellow-100 text-yellow-800',
                        implantacios_sebeszi_tervezesre_var: 'bg-orange-100 text-orange-800',
                        fogpotlasra_var: 'bg-amber-100 text-amber-800',
                        fogpotlas_keszul: 'bg-indigo-100 text-indigo-800',
                        fogpotlas_kesz: 'bg-green-100 text-green-800',
                        gondozas_alatt: 'bg-gray-100 text-gray-800',
                      };
                      return colors[stage] || 'bg-gray-100 text-gray-800';
                    };
                    return (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStageColor(currentStage.stage)}`}
                        title={currentStage.notes || stageLabel}
                      >
                        {stageLabel}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {userRole === 'admin' && patientId && (
                <button
                  onClick={handleImpersonate}
                  className="btn-secondary flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-purple-600 hover:text-purple-700"
                  title="Belépés betegként"
                >
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">Belépés betegként</span>
                </button>
              )}
              <MobileMenu showBackButton={true} />
              <button
                onClick={handleBack}
                className="btn-secondary flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Vissza</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-4 sm:py-6">
        {/* Tabs */}
        <div className="mb-4 sm:mb-6 border-b border-gray-200 -mx-2 sm:mx-0">
          <nav 
            className="flex gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide px-2 sm:px-0" 
            aria-label="Betegűrlap fülök"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'text-medical-primary border-medical-primary'
                    : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-4 sm:space-y-6">
          {activeTab === 'alapadatok' && loadedTabs.has('alapadatok') && (
            <PatientForm
              patient={patient}
              isViewOnly={false}
              onSave={handleSavePatient}
              onCancel={handleBack}
              showOnlySections={['alapadatok', 'szemelyes', 'beutalo', 'kezeloorvos', 'stadium']}
            />
          )}

          {activeTab === 'anamnezis' && loadedTabs.has('anamnezis') && (
            <PatientForm
              patient={patient}
              isViewOnly={false}
              onSave={handleSavePatient}
              onCancel={handleBack}
              showOnlySections={['anamnezis', 'betegvizsgalat', 'ohip14', 'kezelesi_terv']}
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
