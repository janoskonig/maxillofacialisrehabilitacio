'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PatientForm } from '@/components/PatientForm';
import { Patient, PatientStageEntry } from '@/lib/types';
import { User } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PatientHeaderBar } from '@/components/PatientHeaderBar';
import { PatientOverviewTab } from '@/components/PatientOverviewTab';
import { PatientCommunicationTab } from '@/components/PatientCommunicationTab';
import { PatientTabsNav, type PatientProfileTabId } from '@/components/PatientTabsNav';

type TabType = PatientProfileTabId;

const VALID_TABS: TabType[] = [
  'attekintes',
  'torzsadatok',
  'anamnezis',
  'kommunikacio',
  'adminisztracio',
];

/** Régi (linkelt) fülnevek → új fül azonosító. Megőrzi a meglévő deep-linkeket. */
const LEGACY_TAB_MAP: Record<string, TabType> = {
  alapadatok: 'torzsadatok',
  torzsadatok: 'torzsadatok',
  anamnezis: 'anamnezis',
  adminisztracio: 'adminisztracio',
  documents: 'adminisztracio',
  konzilium: 'kommunikacio',
  uzenet: 'kommunikacio',
  kommunikacio: 'kommunikacio',
  attekintes: 'attekintes',
};

/**
 * A régi „Kezelési terv & időpont" fül tartalma a /patients/[id]/stages hub-ra
 * költözött — az ide mutató deep-linkeket oda irányítjuk át.
 */
const STAGES_REDIRECT_TABS = new Set(['idopont', 'terv_idopont']);
const STAGES_REDIRECT_SECTIONS = new Set(['section-idopont', 'section-stadium']);

/** `#section-X` horgony → melyik fülön él az adott szekció. */
const SECTION_TAB_MAP: Record<string, TabType> = {
  'section-alapadatok': 'torzsadatok',
  'section-szemelyes': 'torzsadatok',
  'section-beutalo': 'torzsadatok',
  'section-anamnezis': 'anamnezis',
  'section-betegvizsgalat': 'anamnezis',
  'section-ohip14': 'anamnezis',
  'section-adminisztracio': 'adminisztracio',
};


export default function PatientViewPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const patientId = params.id as string;
  const highlightDocumentId = searchParams.get('documentId');
  const [authorized, setAuthorized] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [patientEmail, setPatientEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('attekintes');
  const [loadedTabs, setLoadedTabs] = useState<Set<TabType>>(new Set<TabType>(['attekintes']));
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

        try {
          const response = await fetch(`/api/patients/${patientId}`, {
            credentials: 'include',
          });

          if (!response.ok) {
            if (response.status === 403 || response.status === 404) {
              router.push('/');
              return;
            }
            throw new Error('Failed to fetch patient');
          }

          const data = await response.json();
          setPatient(data.patient);
          setPatientEmail(data.patient?.email || null);
          setAuthorized(true);

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

  // Deep-link: ?tab=… (régi nevekkel is) + #section-… horgonyból fül kikövetkeztetése.
  useEffect(() => {
    if (!authorized) return;
    const tabParam = searchParams.get('tab');
    const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';

    // A régi terv/időpont fülre mutató linkek a terv-hub oldalra visznek.
    if ((tabParam && STAGES_REDIRECT_TABS.has(tabParam)) || STAGES_REDIRECT_SECTIONS.has(hash)) {
      router.replace(`/patients/${patientId}/stages`);
      return;
    }

    let resolved: TabType | undefined = tabParam ? LEGACY_TAB_MAP[tabParam] : undefined;
    if (!resolved && hash && SECTION_TAB_MAP[hash]) {
      resolved = SECTION_TAB_MAP[hash];
    }

    if (!resolved || !VALID_TABS.includes(resolved)) return;
    setActiveTab(resolved);
    setLoadedTabs((prev) => new Set<TabType>([...Array.from(prev), resolved!]));
  }, [authorized, searchParams, router, patientId]);

  // #section-… → görgetés a szekcióhoz a fül betöltése után.
  useEffect(() => {
    if (!authorized || typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
    return () => clearTimeout(timer);
  }, [authorized, activeTab, loadedTabs]);

  const handleBack = () => router.back();

  const handleImpersonate = async () => {
    if (!patientId) return;
    try {
      const response = await fetch('/api/patient-portal/auth/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patientId }),
      });
      if (response.ok) {
        const data = await response.json();
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

  const handleSavePatient = async (savedPatient: Patient) => {
    setPatient(savedPatient);
  };

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    setLoadedTabs((prev) => (prev.has(tab) ? prev : new Set<TabType>([...Array.from(prev), tab])));
  }, []);

  const isSchedulingRole =
    userRole === 'admin' || userRole === 'beutalo_orvos' || userRole === 'fogpótlástanász';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Betöltés...</div>
      </div>
    );
  }

  if (!authorized || !patient) {
    return null;
  }

  return (
    <AppShell
      title="Beteg profil"
      backTo="/"
      maxWidth="xl"
      actions={
        userRole === 'admin' && patientId ? (
          <button
            onClick={handleImpersonate}
            className="btn-secondary flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-purple-600 dark:text-purple-300 hover:text-purple-700"
            title="Belépés betegként"
          >
            <User className="w-4 h-4" />
            <span className="hidden sm:inline">Belépés betegként</span>
          </button>
        ) : undefined
      }
    >
      {/* Állandó beteg-fejléc — minden fülön */}
      <PatientHeaderBar
        patient={patient}
        currentStage={currentStage}
        canSeeNextStep
        canAssignDoctor={userRole === 'admin' || userRole === 'fogpótlástanász'}
        onGoToScheduling={
          isSchedulingRole ? () => router.push(`/patients/${patientId}/stages`) : undefined
        }
      />

      {/* Fülek — közös fülsor a terv-hub oldallal (a „Kezelési terv & időpont" fül oda navigál) */}
      <PatientTabsNav
        patientId={patientId}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        showStadiumok={isSchedulingRole}
      />

      {/* Fültartalom */}
      <div className="space-y-4 sm:space-y-6">
        {activeTab === 'attekintes' && loadedTabs.has('attekintes') && (
          <PatientOverviewTab
            patient={patient}
            onGoToTab={(tab) => handleTabChange(tab as TabType)}
            onGoToScheduling={
              isSchedulingRole ? () => router.push(`/patients/${patientId}/stages`) : undefined
            }
            canSeeClinical
          />
        )}

        {activeTab === 'torzsadatok' && loadedTabs.has('torzsadatok') && (
          <PatientForm
            patient={patient}
            isViewOnly={false}
            onSave={handleSavePatient}
            onCancel={handleBack}
            showOnlySections={['alapadatok', 'szemelyes', 'beutalo']}
          />
        )}

        {activeTab === 'anamnezis' && loadedTabs.has('anamnezis') && (
          <PatientForm
            patient={patient}
            isViewOnly={false}
            onSave={handleSavePatient}
            onCancel={handleBack}
            showOnlySections={['anamnezis', 'betegvizsgalat', 'ohip14']}
          />
        )}

        {activeTab === 'kommunikacio' && loadedTabs.has('kommunikacio') && patient?.id && (
          <PatientCommunicationTab
            patientId={patient.id}
            patientName={patient.nev || null}
            patientEmail={patientEmail}
            userRole={userRole}
          />
        )}

        {activeTab === 'adminisztracio' && loadedTabs.has('adminisztracio') && (
          <PatientForm
            patient={patient}
            isViewOnly={false}
            onSave={handleSavePatient}
            onCancel={handleBack}
            showOnlySections={['adminisztracio']}
            highlightDocumentId={highlightDocumentId}
          />
        )}
      </div>
    </AppShell>
  );
}
