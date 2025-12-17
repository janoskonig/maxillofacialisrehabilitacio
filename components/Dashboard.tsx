'use client';

import { useState, useEffect, useCallback } from 'react';
import { TodaysAppointmentsWidget } from './widgets/TodaysAppointmentsWidget';
import { PendingApprovalsWidget } from './widgets/PendingApprovalsWidget';
import { ChevronDown, ChevronUp, LayoutDashboard, UserPlus } from 'lucide-react';
import { PatientList } from './PatientList';
import { Patient } from '@/lib/types';

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

export function Dashboard({ userRole, onViewPatient, onEditPatient, onViewOP, onViewFoto }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'new-registrations'>('overview');

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
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Next 3 Appointments Today */}
              <TodaysAppointmentsWidget 
                appointments={data.nextAppointments} 
                onUpdate={refreshData}
              />

              {/* Pending Appointments */}
              {data.pendingAppointments.length > 0 && (
                <PendingApprovalsWidget approvals={data.pendingAppointments} />
              )}
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
        </>
      )}
    </div>
  );
}

