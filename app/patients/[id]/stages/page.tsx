'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Patient } from '@/lib/types';
import type { PatientEpisode } from '@/lib/types';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Calendar } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { MobileMenu } from '@/components/MobileMenu';
import { PatientStageSelector } from '@/components/PatientStageSelector';
import { PatientStageTimeline } from '@/components/PatientStageTimeline';
import { PatientEpisodeForm } from '@/components/PatientEpisodeForm';
import { useToast } from '@/contexts/ToastContext';

export default function PatientStagesPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;
  const { showToast } = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<unknown>(null);
  const [episodes, setEpisodes] = useState<PatientEpisode[]>([]);
  const [useNewModel, setUseNewModel] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshStagesAndEpisodes = useCallback(() => {
    setRefreshKey((k) => k + 1);
    fetch(`/api/patients/${patientId}/stages`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setCurrentStage(data.timeline?.currentStage ?? null);
        setUseNewModel(!!data.useNewModel);
      })
      .catch(() => {});
    fetch(`/api/patients/${patientId}/episodes`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setEpisodes(data.episodes ?? []))
      .catch(() => setEpisodes([]));
  }, [patientId]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        setUserRole(user.role);

        if (user.role !== 'admin' && user.role !== 'sebészorvos' && user.role !== 'fogpótlástanász') {
          showToast('Nincs jogosultsága az oldal megtekintéséhez', 'error');
          router.push('/');
          return;
        }

        try {
          const response = await fetch(`/api/patients/${patientId}`, { credentials: 'include' });
          if (!response.ok) {
            if (response.status === 403 || response.status === 404) router.push('/');
            else throw new Error('Failed to fetch patient');
            return;
          }
          const data = await response.json();
          setPatient(data.patient);
          setAuthorized(true);
        } catch (error) {
          console.error('Error fetching patient:', error);
          router.push('/');
          return;
        }

        try {
          const stagesResponse = await fetch(`/api/patients/${patientId}/stages`, { credentials: 'include' });
          if (stagesResponse.ok) {
            const stagesData = await stagesResponse.json();
            setCurrentStage(stagesData.timeline?.currentStage ?? null);
            setUseNewModel(!!stagesData.useNewModel);
          }
        } catch (error) {
          console.error('Error fetching current stage:', error);
        }

        try {
          const epRes = await fetch(`/api/patients/${patientId}/episodes`, { credentials: 'include' });
          if (epRes.ok) {
            const epData = await epRes.json();
            setEpisodes(epData.episodes ?? []);
          }
        } catch (error) {
          console.error('Error fetching episodes:', error);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    if (patientId) checkAuth();
  }, [router, patientId, showToast]);

  const handleBack = () => router.back();

  const handleStageChanged = () => refreshStagesAndEpisodes();

  const activeEpisode = episodes.find((e) => e.status === 'open') ?? null;
  const patientReason = patient?.kezelesreErkezesIndoka ?? activeEpisode?.reason ?? null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
        </div>
      </div>
    );
  }

  if (!authorized || !patient) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                aria-label="Vissza"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Logo />
            </div>
            <MobileMenu />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-medical-primary" />
              Betegstádiumok - {patient.nev || 'Névtelen beteg'}
            </h1>
            <p className="text-gray-600 mt-1">
              Stádiumok kezelése és timeline megtekintése
            </p>
          </div>
          <Link
            href="/patients/stages/gantt"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <BarChart3 className="w-4 h-4" />
            GANTT nézet
          </Link>
        </div>

        <div className="space-y-6">
          {/* Epizódok (új modell) */}
          {episodes.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ellátási epizódok</h3>
              <ul className="space-y-1 text-sm text-gray-700">
                {episodes.slice(0, 10).map((ep) => (
                  <li key={ep.id} className="flex items-center gap-2">
                    <span className={ep.status === 'open' ? 'text-green-600 font-medium' : 'text-gray-500'}>
                      {ep.status === 'open' ? '● Aktív' : '○ Zárt'}
                    </span>
                    <span>{ep.chiefComplaint}</span>
                    <span className="text-gray-400">
                      {new Date(ep.openedAt).toLocaleDateString('hu-HU')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Új ellátási epizód indítása */}
          {(userRole === 'admin' || userRole === 'sebészorvos' || userRole === 'fogpótlástanász') && (
            <PatientEpisodeForm
              patientId={patientId}
              patientReason={patientReason}
              onEpisodeCreated={() => refreshStagesAndEpisodes()}
            />
          )}

          {/* Stage Selector */}
          {(userRole === 'admin' || userRole === 'sebészorvos' || userRole === 'fogpótlástanász') && (
            <PatientStageSelector
              patientId={patientId}
              currentStage={currentStage}
              onStageChanged={handleStageChanged}
              activeEpisodeId={activeEpisode?.id ?? null}
              reason={patientReason}
              useNewModel={useNewModel}
            />
          )}

          {/* Timeline */}
          <PatientStageTimeline key={refreshKey} patientId={patientId} />
        </div>
      </main>
    </div>
  );
}
