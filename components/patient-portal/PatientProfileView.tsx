'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User, Mail, Phone, MapPin, Calendar, CreditCard, Edit2, Save, X, Building, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';

interface Patient {
  id: string;
  nev: string | null;
  taj: string | null;
  email: string | null;
  telefonszam: string | null;
  szuletesiDatum: string | null;
  nem: string | null;
  cim: string | null;
  varos: string | null;
  iranyitoszam: string | null;
  felvetelDatuma: string | null;
  beutaloOrvos: string | null;
  beutaloIndokolas: string | null;
}

export function PatientProfileView() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [editedPatient, setEditedPatient] = useState<Partial<Patient>>({});

  useEffect(() => {
    fetchPatientData();
  }, []);

  const fetchPatientData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/patient-portal/patient', {
        credentials: 'include',
      });

      if (!response.ok || response.status === 401) {
        router.push('/patient-portal');
        return;
      }

      const data = await response.json();
      setPatient(data.patient);
      setEditedPatient(data.patient);
    } catch (error) {
      console.error('Hiba a beteg adatok betöltésekor:', error);
      showToast('Hiba történt az adatok betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setEditing(true);
    setEditedPatient(patient ? { ...patient } : {});
  };

  const handleCancel = () => {
    setEditing(false);
    setEditedPatient(patient ? { ...patient } : {});
  };

  const handleSave = async () => {
    if (!patient) return;

    // Validate required fields
    if (!editedPatient.nev || !editedPatient.nev.trim()) {
      showToast('A név megadása kötelező', 'error');
      return;
    }

    if (!editedPatient.szuletesiDatum) {
      showToast('A születési dátum megadása kötelező', 'error');
      return;
    }

    if (!editedPatient.nem) {
      showToast('A nem megadása kötelező', 'error');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch('/api/patient-portal/patient', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          nev: editedPatient.nev?.trim(),
          telefonszam: editedPatient.telefonszam?.trim() || null,
          szuletesiDatum: editedPatient.szuletesiDatum || null,
          nem: editedPatient.nem || null,
          cim: editedPatient.cim?.trim() || null,
          varos: editedPatient.varos?.trim() || null,
          iranyitoszam: editedPatient.iranyitoszam?.trim() || null,
          beutaloOrvos: editedPatient.beutaloOrvos?.trim() || null,
          beutaloIndokolas: editedPatient.beutaloIndokolas?.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt');
      }

      showToast('Adatok sikeresen frissítve', 'success');
      setEditing(false);
      await fetchPatientData();
    } catch (error) {
      console.error('Hiba az adatok mentésekor:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt az adatok mentésekor',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
        <span className="ml-3 text-gray-600">Betöltés...</span>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Nem sikerült betölteni az adatokat</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <User className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 text-medical-primary flex-shrink-0" />
            Adataim
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1 sm:mt-2">
            {editing ? 'Módosítsa személyes adatait' : 'Itt találhatja személyes adatait.'}
          </p>
        </div>
        {!editing && (
          <button
            onClick={handleEdit}
            className="btn-primary flex items-center gap-2 text-sm sm:text-base px-3 sm:px-4 py-1.5 sm:py-2 w-full sm:w-auto justify-center"
          >
            <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Szerkesztés
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Name */}
          <div>
            <label className="form-label flex items-center gap-2">
              <User className="w-4 h-4" />
              Név <span className="text-red-500">*</span>
            </label>
            {editing ? (
              <input
                type="text"
                value={editedPatient.nev || ''}
                onChange={(e) => setEditedPatient({ ...editedPatient, nev: e.target.value })}
                className="form-input"
                placeholder="Kovács János"
                required
                disabled={saving}
              />
            ) : (
              <p className="text-gray-900 font-medium">{patient.nev || '-'}</p>
            )}
          </div>

          {/* TAJ - Read only */}
          <div>
            <label className="form-label flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              TAJ szám
            </label>
            <p className="text-gray-900 font-medium">{patient.taj || '-'}</p>
            <p className="text-xs text-gray-500 mt-1">Nem módosítható</p>
          </div>

          {/* Email - Read only */}
          <div>
            <label className="form-label flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Email cím
            </label>
            <p className="text-gray-900 font-medium">{patient.email || '-'}</p>
            <p className="text-xs text-gray-500 mt-1">Nem módosítható</p>
          </div>

          {/* Phone */}
          <div>
            <label className="form-label flex items-center gap-2">
              <Phone className="w-4 h-4" />
              Telefonszám
            </label>
            {editing ? (
              <input
                type="tel"
                value={editedPatient.telefonszam || ''}
                onChange={(e) => setEditedPatient({ ...editedPatient, telefonszam: e.target.value })}
                className="form-input"
                placeholder="+36-30-123-4567"
                disabled={saving}
              />
            ) : (
              <p className="text-gray-900 font-medium">{patient.telefonszam || '-'}</p>
            )}
          </div>

          {/* Birth Date */}
          <div>
            <label className="form-label flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Születési dátum <span className="text-red-500">*</span>
            </label>
            {editing ? (
              <input
                type="date"
                value={editedPatient.szuletesiDatum ? editedPatient.szuletesiDatum.split('T')[0] : ''}
                onChange={(e) => setEditedPatient({ ...editedPatient, szuletesiDatum: e.target.value })}
                className="form-input"
                required
                disabled={saving}
                max={new Date().toISOString().split('T')[0]}
              />
            ) : (
              <p className="text-gray-900 font-medium">
                {patient.szuletesiDatum
                  ? format(new Date(patient.szuletesiDatum), 'yyyy. MMMM d.', { locale: hu })
                  : '-'}
              </p>
            )}
          </div>

          {/* Gender */}
          <div>
            <label className="form-label flex items-center gap-2">
              <User className="w-4 h-4" />
              Nem <span className="text-red-500">*</span>
            </label>
            {editing ? (
              <select
                value={editedPatient.nem || ''}
                onChange={(e) => setEditedPatient({ ...editedPatient, nem: e.target.value })}
                className="form-input"
                required
                disabled={saving}
              >
                <option value="">Válasszon...</option>
                <option value="ferfi">Férfi</option>
                <option value="no">Nő</option>
                <option value="nem_ismert">Nem ismert</option>
              </select>
            ) : (
              <p className="text-gray-900 font-medium">
                {patient.nem === 'ferfi' ? 'Férfi' : patient.nem === 'no' ? 'Nő' : patient.nem || '-'}
              </p>
            )}
          </div>

          {/* Address Street */}
          <div>
            <label className="form-label flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Cím (utca, házszám)
            </label>
            {editing ? (
              <input
                type="text"
                value={editedPatient.cim || ''}
                onChange={(e) => setEditedPatient({ ...editedPatient, cim: e.target.value })}
                className="form-input"
                placeholder="Utca, házszám"
                disabled={saving}
              />
            ) : (
              <p className="text-gray-900 font-medium">{patient.cim || '-'}</p>
            )}
          </div>

          {/* City */}
          <div>
            <label className="form-label">Város</label>
            {editing ? (
              <input
                type="text"
                value={editedPatient.varos || ''}
                onChange={(e) => setEditedPatient({ ...editedPatient, varos: e.target.value })}
                className="form-input"
                placeholder="Budapest"
                disabled={saving}
              />
            ) : (
              <p className="text-gray-900 font-medium">{patient.varos || '-'}</p>
            )}
          </div>

          {/* Postal Code */}
          <div>
            <label className="form-label">Irányítószám</label>
            {editing ? (
              <input
                type="text"
                value={editedPatient.iranyitoszam || ''}
                onChange={(e) => setEditedPatient({ ...editedPatient, iranyitoszam: e.target.value })}
                className="form-input"
                placeholder="1011"
                disabled={saving}
                maxLength={10}
              />
            ) : (
              <p className="text-gray-900 font-medium">{patient.iranyitoszam || '-'}</p>
            )}
          </div>

          {/* Registration Date - Read only */}
          {patient.felvetelDatuma && (
            <div>
              <label className="form-label flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Felvétel dátuma
              </label>
              <p className="text-gray-900 font-medium">
                {format(new Date(patient.felvetelDatuma), 'yyyy. MMMM d.', { locale: hu })}
              </p>
            </div>
          )}
        </div>

        {/* Referral Section */}
        <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t">
          <h3 className="text-xs sm:text-sm font-semibold text-gray-700 mb-3 sm:mb-4">Beutaló adatok</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Referring Doctor */}
            <div>
              <label className="form-label flex items-center gap-2">
                <Building className="w-4 h-4" />
                Beutaló orvos neve
              </label>
              {editing ? (
                <input
                  type="text"
                  value={editedPatient.beutaloOrvos || ''}
                  onChange={(e) => setEditedPatient({ ...editedPatient, beutaloOrvos: e.target.value })}
                  className="form-input"
                  placeholder="Dr. Kovács János"
                  disabled={saving}
                />
              ) : (
                <p className="text-gray-900 font-medium">{patient.beutaloOrvos || '-'}</p>
              )}
            </div>

            {/* Referral Reason */}
            <div className="md:col-span-2">
              <label className="form-label flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Beutalás indoka
              </label>
              {editing ? (
                <textarea
                  value={editedPatient.beutaloIndokolas || ''}
                  onChange={(e) => setEditedPatient({ ...editedPatient, beutaloIndokolas: e.target.value })}
                  className="form-input"
                  placeholder="Beutalás indokának leírása..."
                  rows={4}
                  disabled={saving}
                />
              ) : (
                <p className="text-gray-900 font-medium whitespace-pre-wrap">
                  {patient.beutaloIndokolas || '-'}
                </p>
              )}
            </div>
          </div>
        </div>

        {editing && (
          <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={handleCancel}
              className="btn-secondary flex items-center justify-center gap-2 flex-1 text-sm sm:text-base py-2 sm:py-2.5"
              disabled={saving}
            >
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Mégse
            </button>
            <button
              onClick={handleSave}
              className="btn-primary flex items-center justify-center gap-2 flex-1 text-sm sm:text-base py-2 sm:py-2.5"
              disabled={saving}
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-b-2 border-white"></div>
                  Mentés...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Mentés
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
