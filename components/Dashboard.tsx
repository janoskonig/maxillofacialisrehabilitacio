'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { TodaysAppointmentsWidget } from './widgets/TodaysAppointmentsWidget';
import { PendingApprovalsWidget } from './widgets/PendingApprovalsWidget';
import { SendMessageWidget } from './widgets/SendMessageWidget';
import { WaitingTimeWidget } from './widgets/WaitingTimeWidget';
import { BusynessOMeter } from './widgets/BusynessOMeter';
import { ChevronDown, ChevronUp, LayoutDashboard, Layers, BarChart3, Activity, ClipboardList, Calendar } from 'lucide-react';
import { PatientPipelineBoard } from './PatientPipelineBoard';
import { Patient } from '@/lib/types';
import { StagesGanttChart, type GanttEpisode, type GanttInterval } from './StagesGanttChart';
import { WorklistWidget } from './widgets/WorklistWidget';
import { WipForecastWidget } from './widgets/WipForecastWidget';
import { IntakeRecommendationBadge } from './widgets/IntakeRecommendationBadge';
import { TreatmentPlanGantt } from './TreatmentPlanGantt';
import type { StageCatalogEntry } from '@/lib/types';

interface DashboardData {
  nextAppointments: any[];
  pendingAppointments: any[];
  newRegistrations: any[];
}

interface DashboardProps {
  userRole: string;
  onViewPatient?: (patient: Patient) => void;
  onEditPatient?: (patient: Patient) => void;
  onViewOP?: (patient: Patient) => void;
  onViewFoto?: (patient: Patient) => void;
}

const VALID_TABS = ['overview', 'patient-preparation', 'gantt', 'workload', 'worklist', 'treatment-plans'] as const;

export function Dashboard({ userRole }: DashboardProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'patient-preparation' | 'gantt' | 'workload' | 'worklist' | 'treatment-plans'>('overview');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && VALID_TABS.includes(tab as (typeof VALID_TABS)[number])) {
      setActiveTab(tab as (typeof VALID_TABS)[number]);
    }
  }, [searchParams]);
  const [ganttEpisodes, setGanttEpisodes] = useState<GanttEpisode[]>([]);
  const [ganttIntervals, setGanttIntervals] = useState<GanttInterval[]>([]);
  const [ganttCatalog, setGanttCatalog] = useState<StageCatalogEntry[]>([]);
  const [ganttLoading, setGanttLoading] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard', {
        credentials: 'include',
      });
      if (response.ok) {
        const dashboardData = await response.json();
        setData(dashboardData);
      }
    } catch (err) {
      console.error('Error refreshing dashboard data:', err);
    }
  }, []);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/dashboard', {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Hiba történt a dashboard adatok betöltésekor');
        }

        const dashboardData = await response.json();
        setData(dashboardData);
        setError(null);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError(err instanceof Error ? err.message : 'Ismeretlen hiba');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const canSeeStages = userRole === 'admin' || userRole === 'sebészorvos' || userRole === 'fogpótlástanász';

  // GANTT adatok (összes beteg) – csak az utolsó 3 hónap, ha a GANTT fül aktív
  useEffect(() => {
    if (!canSeeStages || activeTab !== 'gantt') return;
    setGanttLoading(true);
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - 3);
    const q = new URLSearchParams({ status: 'all', from: from.toISOString(), to: to.toISOString() });
    Promise.all([
      fetch(`/api/patients/stages/gantt?${q.toString()}`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : { episodes: [], intervals: [] }
      ),
      fetch('/api/stage-catalog', { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : { catalog: [] }
      ),
    ])
      .then(([ganttData, catalogData]) => {
        setGanttEpisodes(ganttData.episodes ?? []);
        setGanttIntervals(ganttData.intervals ?? []);
        setGanttCatalog(catalogData.catalog ?? []);
      })
      .catch(() => {
        setGanttEpisodes([]);
        setGanttIntervals([]);
        setGanttCatalog([]);
      })
      .finally(() => setGanttLoading(false));
  }, [canSeeStages, activeTab]);

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary"></div>
          <span className="ml-3 text-body-sm">Dashboard betöltése...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-medical-error/20 bg-medical-error/5">
        <div className="text-center py-4">
          <p className="text-medical-error font-medium">Hiba: {error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Dashboard Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-medical-primary/10 rounded-lg">
              <LayoutDashboard className="w-5 h-5 text-medical-primary" />
            </div>
            <h2 className="text-heading-2">Dashboard</h2>
            {canSeeStages && (
              <div className="hidden sm:block">
                <IntakeRecommendationBadge />
              </div>
            )}
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100 transition-all duration-200"
          >
            {isCollapsed ? (
              <>
                <ChevronDown className="w-4 h-4" />
                <span className="hidden sm:inline">Kibontás</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-4 h-4" />
                <span className="hidden sm:inline">Összecsukás</span>
              </>
            )}
          </button>
        </div>
        {canSeeStages && (
          <div className="sm:hidden">
            <IntakeRecommendationBadge />
          </div>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* Tabs */}
          <div className="border-b border-gray-200 overflow-x-auto scrollbar-hide scroll-smooth">
            <nav className="flex gap-1 w-max" aria-label="Dashboard tabs">
              <button
                onClick={() => setActiveTab('overview')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                  activeTab === 'overview'
                    ? 'text-medical-primary border-medical-primary'
                    : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 hidden sm:block" />
                Áttekintés
              </button>
              <button
                onClick={() => setActiveTab('patient-preparation')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors relative flex-shrink-0 ${
                  activeTab === 'patient-preparation'
                    ? 'text-medical-primary border-medical-primary'
                    : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                }`}
              >
                <Layers className="w-4 h-4 hidden sm:block" />
                Beteg előkészítés
              </button>
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('worklist')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                    activeTab === 'worklist'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <ClipboardList className="w-4 h-4 hidden sm:block" />
                  Munkalista
                </button>
              )}
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('treatment-plans')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                    activeTab === 'treatment-plans'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <Calendar className="w-4 h-4 hidden sm:block" />
                  Kezelési tervek
                </button>
              )}
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('gantt')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                    activeTab === 'gantt'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <BarChart3 className="w-4 h-4 hidden sm:block" />
                  GANTT
                </button>
              )}
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('workload')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                    activeTab === 'workload'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <Activity className="w-4 h-4 hidden sm:block" />
                  Orvos terhelés
                </button>
              )}
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
              {/* Send Message Widget */}
              <SendMessageWidget />

              {/* Next 3 Appointments Today */}
              <TodaysAppointmentsWidget 
                appointments={data.nextAppointments} 
                onUpdate={refreshData}
              />

              {/* Pending Appointments */}
              {data.pendingAppointments.length > 0 && (
                <PendingApprovalsWidget approvals={data.pendingAppointments} />
              )}

              {/* Waiting Times Widget */}
              <WaitingTimeWidget />
            </div>
          )}

          {activeTab === 'worklist' && canSeeStages && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Aktív kezelések következő lépései – foglalás egy kattintással.
              </p>
              <WorklistWidget />
            </div>
          )}

          {activeTab === 'workload' && canSeeStages && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Fogpótlástanász és admin kihasználtság a következő 30 napra.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BusynessOMeter />
                <WipForecastWidget />
              </div>
            </div>
          )}

          {activeTab === 'patient-preparation' && (
            <PatientPipelineBoard />
          )}

          {activeTab === 'treatment-plans' && canSeeStages && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Kezelési tervek idővonala – lépésszintű állapot, demand projection és ETA.
              </p>
              <TreatmentPlanGantt />
            </div>
          )}

          {activeTab === 'gantt' && canSeeStages && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Az összes beteg ellátási epizódjai és stádium intervallumai idővonalon.
              </p>
              {ganttLoading && ganttEpisodes.length === 0 ? (
                <div className="card flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary" />
                  <span className="ml-3 text-body-sm">GANTT betöltése…</span>
                </div>
              ) : (
                <StagesGanttChart
                  episodes={ganttEpisodes}
                  intervals={ganttIntervals}
                  catalog={Array.from(
                    ganttCatalog
                      .slice()
                      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
                      .reduce((acc, c) => {
                        if (!acc.has(c.code)) acc.set(c.code, { code: c.code, labelHu: c.labelHu, orderIndex: c.orderIndex ?? 0 });
                        return acc;
                      }, new Map<string, { code: string; labelHu: string; orderIndex: number }>())
                      .values()
                  )}
                  viewStart={(() => {
                    const end = new Date();
                    const start = new Date(end);
                    start.setMonth(start.getMonth() - 3);
                    return start.toISOString();
                  })()}
                  viewEnd={new Date().toISOString()}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

