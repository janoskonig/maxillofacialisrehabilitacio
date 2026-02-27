'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { TodaysAppointmentsWidget } from './widgets/TodaysAppointmentsWidget';
import { PendingApprovalsWidget } from './widgets/PendingApprovalsWidget';
import { SendMessageWidget } from './widgets/SendMessageWidget';
import { WaitingTimeWidget } from './widgets/WaitingTimeWidget';
import { BusynessOMeter } from './widgets/BusynessOMeter';
import { ChevronDown, ChevronUp, LayoutDashboard, UserPlus, Clock, BarChart3, Activity, ClipboardList, Calendar } from 'lucide-react';
import { DashboardWidget } from './DashboardWidget';
import { PatientList } from './PatientList';
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

interface LongInPreparatoryPatient {
  patientId: string;
  patientName: string;
  stageCode: string;
  stageSince: string;
}

const VALID_TABS = ['overview', 'new-registrations', 'gantt', 'workload', 'worklist', 'treatment-plans'] as const;

export function Dashboard({ userRole, onViewPatient, onEditPatient, onViewOP, onViewFoto }: DashboardProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'new-registrations' | 'gantt' | 'workload' | 'worklist' | 'treatment-plans'>('overview');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && VALID_TABS.includes(tab as (typeof VALID_TABS)[number])) {
      setActiveTab(tab as (typeof VALID_TABS)[number]);
    }
  }, [searchParams]);
  const [longInPreparatory, setLongInPreparatory] = useState<LongInPreparatoryPatient[]>([]);
  const [ganttEpisodes, setGanttEpisodes] = useState<GanttEpisode[]>([]);
  const [ganttIntervals, setGanttIntervals] = useState<GanttInterval[]>([]);
  const [ganttCatalog, setGanttCatalog] = useState<StageCatalogEntry[]>([]);
  const [ganttLoading, setGanttLoading] = useState(false);

  const canEdit = userRole === 'admin' || userRole === 'editor' || userRole === 'fogpótlástanász' || userRole === 'sebészorvos';

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

  // Refresh data when switching to new registrations tab
  useEffect(() => {
    if (activeTab === 'new-registrations' && !loading && data) {
      refreshData();
    }
  }, [activeTab, loading, data, refreshData]);

  const canSeeStages = userRole === 'admin' || userRole === 'sebészorvos' || userRole === 'fogpótlástanász';

  useEffect(() => {
    if (!canSeeStages) return;
    fetch('/api/patients/stages/long-in-preparatory', { credentials: 'include' })
      .then((res) => res.ok ? res.json() : { patients: [] })
      .then((d) => setLongInPreparatory(d.patients ?? []))
      .catch(() => setLongInPreparatory([]));
  }, [canSeeStages]);

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

  // Convert newRegistrations to Patient format
  const newRegistrationsAsPatients: Patient[] = (data?.newRegistrations || []).map((reg: any) => ({
    id: reg.id,
    nev: reg.nev || null,
    taj: reg.taj || null,
    email: reg.email || null,
    telefonszam: reg.telefonszam || null,
    szuletesiDatum: reg.szuletesi_datum || null,
    nem: reg.nem || null,
    cim: reg.cim || null,
    varos: reg.varos || null,
    iranyitoszam: reg.iranyitoszam || null,
    beutaloOrvos: reg.beutalo_orvos || null,
    beutaloIndokolas: reg.beutalo_indokolas || null,
    kezeleoorvos: null,
    kezeleoorvosIntezete: null,
    createdAt: reg.created_at || null,
    createdBy: reg.created_by || null,
    // Required boolean fields with defaults
    radioterapia: false,
    chemoterapia: false,
    maxilladefektusVan: false,
    mandibuladefektusVan: false,
    nyelvmozgásokAkadályozottak: false,
    gombocosBeszed: false,
    felsoFogpotlasVan: false,
    felsoFogpotlasElegedett: true,
    alsoFogpotlasVan: false,
    alsoFogpotlasElegedett: true,
    nemIsmertPoziciokbanImplantatum: false,
    // Required array fields with defaults
    kezelesiTervFelso: [],
    kezelesiTervAlso: [],
    kezelesiTervArcotErinto: [],
  }));

  return (
    <div className="space-y-4">
      {/* Dashboard Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-medical-primary/10 rounded-lg">
            <LayoutDashboard className="w-5 h-5 text-medical-primary" />
          </div>
          <h2 className="text-heading-2">Dashboard</h2>
          {canSeeStages && <IntakeRecommendationBadge />}
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

      {!isCollapsed && (
        <>
          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="flex gap-1" aria-label="Dashboard tabs">
              <button
                onClick={() => setActiveTab('overview')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === 'overview'
                    ? 'text-medical-primary border-medical-primary'
                    : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Áttekintés
              </button>
              <button
                onClick={() => setActiveTab('new-registrations')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors relative ${
                  activeTab === 'new-registrations'
                    ? 'text-medical-primary border-medical-primary'
                    : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                }`}
              >
                <UserPlus className="w-4 h-4" />
                Új jelentkezők
                {data?.newRegistrations && data.newRegistrations.length > 0 && (
                  <span className="ml-1.5 px-2 py-0.5 text-xs font-semibold rounded-full bg-medical-primary text-white">
                    {data.newRegistrations.length}
                  </span>
                )}
              </button>
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('worklist')}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'worklist'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  Munkalista
                </button>
              )}
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('treatment-plans')}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'treatment-plans'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                  Kezelési tervek
                </button>
              )}
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('gantt')}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'gantt'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  GANTT
                </button>
              )}
              {canSeeStages && (
                <button
                  onClick={() => setActiveTab('workload')}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === 'workload'
                      ? 'text-medical-primary border-medical-primary'
                      : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  Orvos terhelés
                </button>
              )}
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

              {/* 4. Előkészítő stádiumban */}
              {canSeeStages && (
                <DashboardWidget
                  title="Előkészítő stádiumban"
                  icon={<Clock className="w-5 h-5" />}
                >
                  {longInPreparatory.length === 0 ? (
                    <p className="text-sm text-gray-500">Nincs ilyen beteg.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {longInPreparatory.map((p) => (
                        <li key={p.patientId}>
                          <Link
                            href={`/patients/${p.patientId}/view`}
                            className="text-sm text-medical-primary hover:underline"
                          >
                            {p.patientName}
                          </Link>
                          <span className="text-xs text-gray-500 ml-2">
                            ({new Date(p.stageSince).toLocaleDateString('hu-HU')} óta)
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </DashboardWidget>
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

          {activeTab === 'new-registrations' && (
            <div className="space-y-4">
              {newRegistrationsAsPatients.length === 0 ? (
                <div className="card text-center py-8">
                  <UserPlus className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-gray-900 mb-1">Nincs új jelentkező</h3>
                  <p className="text-sm text-gray-500">
                    Jelenleg nincs olyan beteg, aki magától regisztrált és még nincs kezelőorvosa.
                  </p>
                </div>
              ) : (
                <PatientList
                  patients={newRegistrationsAsPatients}
                  onView={onViewPatient || (() => {})}
                  onEdit={canEdit && onEditPatient ? onEditPatient : undefined}
                  onViewOP={onViewOP}
                  onViewFoto={onViewFoto}
                  canEdit={canEdit}
                  canDelete={false}
                  userRole={userRole as any}
                  sortField="createdAt"
                  sortDirection="asc"
                />
              )}
            </div>
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

