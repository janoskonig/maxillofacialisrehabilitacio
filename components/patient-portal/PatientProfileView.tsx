'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User, Mail, Phone, MapPin, Calendar, CreditCard } from 'lucide-react';
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
}

export function PatientProfileView() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<Patient | null>(null);

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
    } catch (error) {
      console.error('Hiba a beteg adatok betöltésekor:', error);
      showToast('Hiba történt az adatok betöltésekor', 'error');
    } finally {
      setLoading(false);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <User className="w-6 h-6 sm:w-8 sm:h-8 text-medical-primary" />
          Adataim
        </h1>
        <p className="text-gray-600 mt-2">
          Itt találhatja személyes adatait.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Name */}
          {patient.nev && (
            <div>
              <label className="form-label flex items-center gap-2">
                <User className="w-4 h-4" />
                Név
              </label>
              <p className="text-gray-900 font-medium">{patient.nev}</p>
            </div>
          )}

          {/* TAJ */}
          {patient.taj && (
            <div>
              <label className="form-label flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                TAJ szám
              </label>
              <p className="text-gray-900 font-medium">{patient.taj}</p>
            </div>
          )}

          {/* Email */}
          {patient.email && (
            <div>
              <label className="form-label flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email cím
              </label>
              <p className="text-gray-900 font-medium">{patient.email}</p>
            </div>
          )}

          {/* Phone */}
          {patient.telefonszam && (
            <div>
              <label className="form-label flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Telefonszám
              </label>
              <p className="text-gray-900 font-medium">{patient.telefonszam}</p>
            </div>
          )}

          {/* Birth Date */}
          {patient.szuletesiDatum && (
            <div>
              <label className="form-label flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Születési dátum
              </label>
              <p className="text-gray-900 font-medium">
                {format(new Date(patient.szuletesiDatum), 'yyyy. MMMM d.', { locale: hu })}
              </p>
            </div>
          )}

          {/* Gender */}
          {patient.nem && (
            <div>
              <label className="form-label flex items-center gap-2">
                <User className="w-4 h-4" />
                Nem
              </label>
              <p className="text-gray-900 font-medium">
                {patient.nem === 'ferfi' ? 'Férfi' : patient.nem === 'no' ? 'Nő' : patient.nem}
              </p>
            </div>
          )}

          {/* Address */}
          {(patient.cim || patient.varos || patient.iranyitoszam) && (
            <div className="md:col-span-2">
              <label className="form-label flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Cím
              </label>
              <p className="text-gray-900 font-medium">
                {[
                  patient.iranyitoszam,
                  patient.varos,
                  patient.cim,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
          )}

          {/* Registration Date */}
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

        <div className="mt-6 pt-6 border-t">
          <p className="text-sm text-gray-600">
            Az adatok módosításához kérjük, lépjen kapcsolatba az adminisztrációval:{' '}
            <a
              href="mailto:konig.janos@semmelweis.hu"
              className="text-medical-primary hover:underline"
            >
              konig.janos@semmelweis.hu
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}






