'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Patient, patientSchema } from '@/lib/types';
import { getAllPatients, savePatient, searchPatients } from '@/lib/storage';
import { PatientForm } from '@/components/PatientForm';
import { PatientList } from '@/components/PatientList';
import { Plus, Search, Users, LogOut } from 'lucide-react';
import { isAuthenticated, getUserEmail, logout } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    // Check authentication
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    
    setUserEmail(getUserEmail());
    loadPatients();
  }, [router]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setFilteredPatients(searchPatients(searchQuery));
    } else {
      setFilteredPatients(patients);
    }
  }, [searchQuery, patients]);

  const loadPatients = () => {
    setPatients(getAllPatients());
  };

  const handleSavePatient = (patientData: Patient) => {
    try {
      const validatedPatient = patientSchema.parse(patientData);
      savePatient(validatedPatient); // Ez automatikusan menti CSV-be és letölti
      loadPatients();
      setShowForm(false);
      setEditingPatient(null);
      alert('Betegadat sikeresen mentve és CSV fájl letöltve!');
    } catch (error) {
      console.error('Validation error:', error);
      alert('Kérjük, ellenőrizze az összes kötelező mezőt és próbálja újra.');
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
              Betegadat Gyűjtő Rendszer
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