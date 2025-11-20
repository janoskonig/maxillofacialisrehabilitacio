'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Patient, patientSchema } from '@/lib/types';
import { getAllPatients, savePatient, searchPatients, PaginationInfo } from '@/lib/storage';
import { PatientForm } from '@/components/PatientForm';
import { PatientList } from '@/components/PatientList';
import { OPImageViewer } from '@/components/OPImageViewer';
import { FotoImageViewer } from '@/components/FotoImageViewer';
import { useToast } from '@/contexts/ToastContext';
import { Plus, Search, Users, LogOut, Shield, Settings, Calendar, Eye } from 'lucide-react';
import { getCurrentUser, getUserEmail, getUserRole, logout } from '@/lib/auth';
import { Logo } from '@/components/Logo';

type UserRoleType = 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';

export default function Home() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRoleType>('viewer');
  const [originalUserRole, setOriginalUserRole] = useState<UserRoleType>('viewer');
  const [userInstitution, setUserInstitution] = useState<string | null>(null);
  const [viewAsRole, setViewAsRole] = useState<UserRoleType | null>(null);
  const [sortField, setSortField] = useState<'nev' | 'idopont' | 'createdAt' | null>('idopont');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [opViewerPatient, setOpViewerPatient] = useState<Patient | null>(null);
  const [fotoViewerPatient, setFotoViewerPatient] = useState<Patient | null>(null);
  const { showToast, confirm: confirmDialog } = useToast();
  
  // Computed role for display - use viewAsRole if set, otherwise use original role
  const displayRole = viewAsRole || userRole;

  useEffect(() => {
    // Check authentication
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) {
      router.push('/login');
      return;
    }
    
      const email = user.email;
      const role = user.role;
      const intezmeny = user.intezmeny || null;
    setUserEmail(email);
      setUserRole(role);
      setOriginalUserRole(role); // Store original role
      setUserInstitution(intezmeny);
    loadPatients();

    // Send heartbeat only once per session
    try {
      const heartbeatKey = 'activityHeartbeatSent';
      if (!sessionStorage.getItem(heartbeatKey) && email) {
        fetch('/api/activity', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
            credentials: 'include',
          body: JSON.stringify({ action: 'heartbeat', detail: 'home' })
        }).catch(() => {});
        sessionStorage.setItem(heartbeatKey, 'true');
      }
    } catch {}
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    // Reset to first page when search query changes
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    // Load patients with pagination
    const loadPatientsData = async () => {
      try {
        let data;
        if (searchQuery.trim()) {
          data = await searchPatients(searchQuery, currentPage, 50);
        } else {
          data = await getAllPatients(currentPage, 50);
        }
        
        setPatients(data.patients);
        setPagination(data.pagination);
        
        // Apply sorting (only for fields that don't need appointment data)
        let sortedResults = [...data.patients];
        if (sortField === 'nev' || sortField === 'createdAt') {
          sortedResults = sortedResults.sort((a, b) => {
            let comparison = 0;
            
            if (sortField === 'nev') {
              const nameA = (a.nev || '').toLowerCase();
              const nameB = (b.nev || '').toLowerCase();
              comparison = nameA.localeCompare(nameB, 'hu');
            } else if (sortField === 'createdAt') {
              const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              comparison = dateA - dateB;
            }
            
            return sortDirection === 'asc' ? comparison : -comparison;
          });
        }
        // Note: appointment sorting (idopont) is handled in PatientList component
        // as it needs appointment data
        
        setFilteredPatients(sortedResults);
      } catch (error) {
        console.error('Hiba a betegek betöltésekor:', error);
        showToast('Hiba történt a betegek betöltésekor. Kérjük, próbálja újra.', 'error');
      }
    };
    
    loadPatientsData();
  }, [searchQuery, currentPage, sortField, sortDirection, refreshKey]);

  const loadPatients = async () => {
    // Force reload by incrementing refreshKey
    // This will trigger the useEffect to reload data
    setRefreshKey(prev => prev + 1);
    setCurrentPage(1);
  };

  const handleSavePatient = async (patientData: Patient) => {
    try {
      // Check if this is a silent save (for document upload, etc.)
      const isSilent = (handleSavePatient as any)._silent;
      
      // If patient already has an ID, it means it was already saved in PatientForm
      // In that case, we just need to reload the list and show success message
      if (patientData.id) {
        // Reload patients to get latest data from database
        await loadPatients();
        // Reload the specific patient to get latest data from database
        // This ensures we have the most up-to-date data when reopening the form
        try {
          const response = await fetch(`/api/patients/${patientData.id}`, {
            credentials: 'include',
          });
          if (response.ok) {
            const data = await response.json();
            // Update editingPatient with the latest saved patient data from database
            setEditingPatient(data.patient);
          } else {
            // Fallback: use the provided patient data
            setEditingPatient(patientData);
          }
        } catch (error) {
          // Fallback: use the provided patient data
          console.error('Error reloading patient:', error);
          setEditingPatient(patientData);
        }
        if (!isSilent) {
          showToast('Betegadat sikeresen mentve', 'success');
        }
        return;
      }
      
      // For new patients or if save failed in PatientForm, save here
      const validatedPatient = patientSchema.parse(patientData);
      await savePatient(validatedPatient);
      await loadPatients();
      // Ne zárjuk be az űrlapot automatikusan - a felhasználó manuálisan zárhatja be
      // setShowForm(false);
      // setEditingPatient(null);
      
      if (!isSilent) {
        showToast('Betegadat sikeresen mentve', 'success');
      }
    } catch (error: any) {
      console.error('Hiba a beteg mentésekor:', error);
      let errorMessage = 'Kérjük, ellenőrizze az összes kötelező mezőt és próbálja újra.';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      // További információ a hálózati hibákról
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('Load failed') || errorMessage.includes('csatlakozni')) {
        errorMessage = 'Nem sikerült csatlakozni a szerverhez. Ellenőrizze az internetkapcsolatot és próbálja újra.';
      } else if (errorMessage.includes('túl hosszú')) {
        errorMessage = 'A kérés túl hosszú ideig tartott. Lehet, hogy az adatok túl nagyok. Próbálja újra.';
      }
      
      showToast(`Hiba a mentés során: ${errorMessage}`, 'error');
    }
  };

  const handleNewPatient = () => {
    setEditingPatient(null);
    setIsViewMode(false);
    setShowForm(true);
  };

  const handleViewPatient = (patient: Patient) => {
    setEditingPatient(patient);
    setIsViewMode(true);
    setShowForm(true);
  };

  const handleViewOP = (patient: Patient) => {
    setOpViewerPatient(patient);
  };

  const handleViewFoto = (patient: Patient) => {
    setFotoViewerPatient(patient);
  };

  const handleEditPatient = (patient: Patient) => {
    setEditingPatient(patient);
    setIsViewMode(false);
    setShowForm(true);
  };

  const handleCloseForm = async () => {
    // This will be called by PatientForm's handleCancel after checking for unsaved changes
    setShowForm(false);
    setEditingPatient(null);
    setIsViewMode(false);
    
    // Reload patients list to get latest data from database
    await loadPatients();
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleViewAsRoleChange = (role: UserRoleType | null) => {
    setViewAsRole(role);
  };

  const handleDeletePatient = async (patient: Patient) => {
    if (!patient.id) {
      showToast('Hiba: A beteg ID nem található', 'error');
      return;
    }

    // Check if patient has appointment by loading appointments
    let hasAppointment = false;
    try {
      // Load all appointments paginated to check if patient has any appointments
      let page = 1;
      let hasMore = true;
      
      while (hasMore && !hasAppointment) {
        const appointmentsResponse = await fetch(`/api/appointments?page=${page}&limit=50`, {
          credentials: 'include',
        });
        if (appointmentsResponse.ok) {
          const appointmentsData = await appointmentsResponse.json();
          const pageAppointments = appointmentsData.appointments || [];
          hasAppointment = pageAppointments.some(
            (apt: any) => apt.patientId === patient.id
          );
          
          // Check if there are more pages
          const pagination = appointmentsData.pagination;
          if (pagination && page < pagination.totalPages && !hasAppointment) {
            page++;
          } else {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('Error checking appointments:', error);
    }

    const confirmMessage = hasAppointment
      ? `Biztosan törölni szeretné ezt a beteget?\n\nA beteg törlésekor a lefoglalt időpont is törlődik és felszabadul. A fogpótlástanász és az adminok értesítést kapnak.`
      : `Biztosan törölni szeretné ezt a beteget?\n\nA művelet nem vonható vissza!`;

    const confirmed = await confirmDialog(confirmMessage, {
      title: 'Beteg törlése',
      confirmText: 'Törlés',
      cancelText: 'Mégse',
      type: 'danger'
    });

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/patients/${patient.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        await loadPatients();
        if (data.appointmentsFreed && data.appointmentsFreed > 0) {
          showToast(`Beteg sikeresen törölve! ${data.appointmentsFreed} időpont felszabadult. A fogpótlástanász és az adminok értesítést kaptak.`, 'success');
        } else {
          showToast('Beteg sikeresen törölve!', 'success');
        }
      } else {
        const errorData = await response.json();
        showToast(errorData.error || 'Hiba történt a beteg törlésekor', 'error');
      }
    } catch (error) {
      console.error('Error deleting patient:', error);
      showToast('Hiba történt a beteg törlésekor', 'error');
    }
  };

  const availableRoles: UserRoleType[] = ['sebészorvos', 'technikus', 'fogpótlástanász', 'editor', 'viewer'];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-2">
            <div className="flex items-center gap-3">
              <Logo width={50} height={58} />
              <div>
                <h1 className="text-lg font-bold text-medical-primary">
                  Maxillofaciális Rehabilitáció
                </h1>
                <p className="text-xs text-gray-600">
                  BETEGREGISZTER ÉS IDŐPONTKEZELŐ
                </p>
                {originalUserRole === 'sebészorvos' && userInstitution && (
                  <p className="text-xs font-semibold text-red-600 mt-0.5">
                    SEBÉSZ MÓD (csak a {userInstitution} páciensei)
                  </p>
                )}
              </div>
            </div>
            {/* View As Role Selector - Only for admins */}
            {originalUserRole === 'admin' && (
              <div className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-gray-500" />
                <label className="text-xs text-gray-700 font-medium">
                  Nézet mint:
                </label>
                <select
                  value={viewAsRole || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    handleViewAsRoleChange(value === '' ? null : (value as UserRoleType));
                  }}
                  className="form-input text-xs py-1 px-2 border-gray-300 rounded"
                >
                  <option value="">Admin (eredeti)</option>
                  {availableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role === 'sebészorvos' ? 'Sebészorvos' :
                       role === 'technikus' ? 'Technikus' :
                       role === 'fogpótlástanász' ? 'Fogpótlástanász' :
                       role === 'editor' ? 'Szerkesztő' :
                       role === 'viewer' ? 'Megtekintő' : role}
                    </option>
                  ))}
                </select>
                {viewAsRole && (
                  <span className="text-xs text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded">
                    Előnézet mód
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="space-y-3">
          {/* Link to time slots management page for fogpótlástanász and admin */}
          {(displayRole === 'fogpótlástanász' || displayRole === 'admin') && (
            <div className="card p-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Időpontkezelés</h3>
                  <p className="text-xs text-gray-600">
                    Hozzon létre és kezeljen szabad időpontokat
                  </p>
                </div>
                <button
                  onClick={() => router.push('/time-slots')}
                  className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Időpontok kezelése
                </button>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">eCRF-katalógus (electronic Case Report Form)</h2>
          {userEmail && (
            <p className="text-xs text-gray-500">
              Bejelentkezve: {userEmail}
            </p>
          )}
        </div>
        <div className="flex gap-1.5">
          {/* Admin button - always show for real admins, even in view-as mode */}
          {originalUserRole === 'admin' && (
            <button
              onClick={() => router.push('/admin')}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Shield className="w-3.5 h-3.5" />
              Admin
            </button>
          )}
          <button
            onClick={() => router.push('/settings')}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Settings className="w-3.5 h-3.5" />
            Beállítások
          </button>
          <button
            onClick={handleLogout}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            Kijelentkezés
          </button>
          {(displayRole === 'admin' || displayRole === 'editor' || displayRole === 'fogpótlástanász' || displayRole === 'sebészorvos') && (
            <button
              onClick={handleNewPatient}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Új beteg
            </button>
          )}
        </div>
      </div>

          {/* Patient Management Section - shown for all roles */}
          <>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="text"
                  placeholder="Keresés név, TAJ szám vagy telefon alapján..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="form-input pl-9 py-2 text-sm"
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="card p-3">
                  <div className="flex items-center">
                    <Users className="w-5 h-5 text-medical-primary" />
                    <div className="ml-2">
                      <p className="text-xs font-medium text-gray-500">Összes beteg</p>
                      <p className="text-xl font-bold text-gray-900">{patients.length}</p>
                    </div>
                  </div>
                </div>
                <div className="card p-3">
                  <div className="flex items-center">
                    <Search className="w-5 h-5 text-medical-accent" />
                    <div className="ml-2">
                      <p className="text-xs font-medium text-gray-500">Keresési eredmények</p>
                      <p className="text-xl font-bold text-gray-900">{filteredPatients.length}</p>
                    </div>
                  </div>
                </div>
                <div className="card p-3">
                  <div className="flex items-center">
                    <Plus className="w-5 h-5 text-medical-success" />
                    <div className="ml-2">
                      <p className="text-xs font-medium text-gray-500">Új ebben a hónapban</p>
                      <p className="text-xl font-bold text-gray-900">
                        {patients.filter(p => {
                          const created = new Date(p.createdAt || '');
                          const now = new Date();
                          return created.getMonth() === now.getMonth() && 
                                 created.getFullYear() === now.getFullYear();
                        }).length}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Patient List */}
              <PatientList
                patients={filteredPatients}
                onView={handleViewPatient}
                onEdit={handleEditPatient}
                onDelete={originalUserRole === 'admin' ? handleDeletePatient : undefined}
                onViewOP={handleViewOP}
                onViewFoto={handleViewFoto}
                canEdit={displayRole === 'admin' || displayRole === 'editor' || displayRole === 'fogpótlástanász' || displayRole === 'sebészorvos'}
                canDelete={originalUserRole === 'admin'}
                userRole={displayRole}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={(field: 'nev' | 'idopont' | 'createdAt') => {
                  if (sortField === field) {
                    // Toggle direction if same field
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    // New field, default to ascending
                    setSortField(field);
                    setSortDirection('asc');
                  }
                }}
                pagination={pagination}
                onPageChange={(page: number) => setCurrentPage(page)}
              />
            </>

      {/* Patient Form Modal */}
      {showForm && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={(e) => {
            // Only close if clicking directly on the background (not on the form)
            if (e.target === e.currentTarget) {
              // Trigger the cancel button click, which will call handleCancel
              // and check for unsaved changes
              const cancelButton = document.querySelector('[data-patient-form-cancel]') as HTMLButtonElement;
              if (cancelButton) {
                cancelButton.click();
              } else {
                // Fallback: direct close
                handleCloseForm();
              }
            }
          }}
        >
          <div 
            className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <PatientForm
              patient={editingPatient}
              onSave={handleSavePatient}
              onCancel={handleCloseForm}
              isViewOnly={isViewMode}
            />
          </div>
        </div>
      )}

      {/* OP Image Viewer Modal */}
      {opViewerPatient && opViewerPatient.id && (
        <OPImageViewer
          patientId={opViewerPatient.id}
          patientName={opViewerPatient.nev || undefined}
          isOpen={!!opViewerPatient}
          onClose={() => setOpViewerPatient(null)}
        />
      )}

      {/* Foto Image Viewer Modal */}
      {fotoViewerPatient && fotoViewerPatient.id && (
        <FotoImageViewer
          patientId={fotoViewerPatient.id}
          patientName={fotoViewerPatient.nev || undefined}
          isOpen={!!fotoViewerPatient}
          onClose={() => setFotoViewerPatient(null)}
        />
      )}

        </div>
      </main>
    </div>
  );
}