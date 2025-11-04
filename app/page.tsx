'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Patient, patientSchema } from '@/lib/types';
import { getAllPatients, savePatient, searchPatients } from '@/lib/storage';
import { PatientForm } from '@/components/PatientForm';
import { PatientList } from '@/components/PatientList';
import { Plus, Search, Users, LogOut, Shield, Settings } from 'lucide-react';
import { getCurrentUser, getUserEmail, getUserRole, logout } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');

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
    setUserEmail(email);
      setUserRole(role);
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
    // Keresés async módon
    const performSearch = async () => {
      if (searchQuery.trim()) {
        const results = await searchPatients(searchQuery);
        setFilteredPatients(results);
      } else {
        setFilteredPatients(patients);
      }
    };
    
    performSearch();
  }, [searchQuery, patients]);

  const loadPatients = async () => {
    try {
      const data = await getAllPatients();
      setPatients(data);
    } catch (error) {
      console.error('Hiba a betegek betöltésekor:', error);
      alert('Hiba történt a betegek betöltésekor. Kérjük, próbálja újra.');
    }
  };

  const handleSavePatient = async (patientData: Patient) => {
    try {
      const validatedPatient = patientSchema.parse(patientData);
      await savePatient(validatedPatient);
      await loadPatients();
      setShowForm(false);
      setEditingPatient(null);
      alert('Betegadat sikeresen mentve az adatbázisba!');
    } catch (error: any) {
      console.error('Hiba a beteg mentésekor:', error);
      const errorMessage = error.message || 'Kérjük, ellenőrizze az összes kötelező mezőt és próbálja újra.';
      alert(`Hiba a mentés során: ${errorMessage}`);
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

  const handleEditPatient = (patient: Patient) => {
    setEditingPatient(patient);
    setIsViewMode(false);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingPatient(null);
    setIsViewMode(false);
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-medical-primary">
                Maxillofaciális Rehabilitáció
              </h1>
            </div>
            <div className="text-sm text-gray-600">
              BETEGREGISZTER
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Betegnyilvántartás</h2>
          <p className="text-gray-600 mt-1">
            Maxillofaciális rehabilitációs betegadatok kezelése
          </p>
          {userEmail && (
            <p className="text-sm text-gray-500 mt-1">
              Bejelentkezve: {userEmail}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {userRole === 'admin' && (
            <button
              onClick={() => router.push('/admin')}
              className="btn-secondary flex items-center gap-2"
            >
              <Shield className="w-4 h-4" />
              Admin
            </button>
          )}
          <button
            onClick={() => router.push('/settings')}
            className="btn-secondary flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Beállítások
          </button>
          <button
            onClick={handleLogout}
            className="btn-secondary flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Kijelentkezés
          </button>
          <button
            onClick={handleNewPatient}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Új beteg
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder="Keresés név, TAJ szám vagy telefon alapján..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="form-input pl-10"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center">
            <Users className="w-8 h-8 text-medical-primary" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Összes beteg</p>
              <p className="text-2xl font-bold text-gray-900">{patients.length}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center">
            <Search className="w-8 h-8 text-medical-accent" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Keresési eredmények</p>
              <p className="text-2xl font-bold text-gray-900">{filteredPatients.length}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center">
            <Plus className="w-8 h-8 text-medical-success" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Új ebben a hónapban</p>
              <p className="text-2xl font-bold text-gray-900">
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
        canEdit={userRole === 'admin' || userRole === 'editor'}
      />

      {/* Patient Form Modal */}
      {showForm && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={handleCloseForm}
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
        </div>
      </main>
    </div>
  );
}