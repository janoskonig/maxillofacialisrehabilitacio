'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Calendar,
  Clock,
  User,
  Mail,
  X,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { Patient } from '@/lib/types';
import { formatDateTime, toLocalISOString, digitsOnly } from '@/lib/dateUtils';
import { DateTimePicker } from './DateTimePicker';
import { MobileTable } from './mobile/MobileTable';
import { MobileKeyValueGrid } from './mobile/MobileKeyValueGrid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  cim?: string | null;
  teremszam?: string | null;
  userEmail?: string;
  dentistName?: string | null;
}

export interface ConditionalOffer {
  id: string;
  patientId: string;
  timeSlotId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  patientEmail: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface ConditionalAppointmentOffersProps {
  patientId?: string | null;
  patientEmail?: string | null;
  onBookingComplete?: () => void;
}

const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

// Állapot-chip: Várakozik / Elfogadva / Elutasítva
const OFFER_STATUS_CHIP: Record<
  ConditionalOffer['approvalStatus'],
  { label: string; className: string }
> = {
  pending: {
    label: 'Várakozik',
    className: 'bg-yellow-100 dark:bg-yellow-950/50 text-yellow-800 dark:text-yellow-300',
  },
  approved: {
    label: 'Elfogadva',
    className: 'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300',
  },
  rejected: {
    label: 'Elutasítva',
    className: 'bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300',
  },
};

function OfferStatusChip({ status }: { status: ConditionalOffer['approvalStatus'] }) {
  const chip = OFFER_STATUS_CHIP[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${chip.className}`}
    >
      {chip.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
//
// A feltételes időpont-ajánlatok kezelése (korábban az AppointmentBooking
// `mode === 'conditional'` ága). Két nézete van:
//
// - Beteg-scope (`patientId` prop megvan): EGY kártya — „Betegnek küldött
//   időpont-ajánlatok" — a fejlécben lecsukható „Új ajánlat küldése" űrlappal
//   és egyetlen, állapot-chipes listával (Várakozik / Elfogadva / Elutasítva).
//   Oszlopok: időpont, kiküldve, állapot (a beteg kartonján állunk, a
//   Beteg/Email/TAJ oszlopok itt zajok).
//
// - Globális (admin-lista) nézet (`patientId` nélkül): a korábbi viselkedés
//   változatlanul — űrlap-kártya + várakozó és elutasított lista Beteg/Email/
//   TAJ oszlopokkal.
// ---------------------------------------------------------------------------

export function ConditionalAppointmentOffers({
  patientId: propPatientId,
  patientEmail,
  onBookingComplete,
}: ConditionalAppointmentOffersProps = {}) {
  // ---- Shared state ----
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const isLoadingRef = useRef(false);

  const [offers, setOffers] = useState<ConditionalOffer[]>([]);
  const [alternativeSlots, setAlternativeSlots] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [showNewSlotForm, setShowNewSlotForm] = useState(false);
  const [newSlotDateTime, setNewSlotDateTime] = useState<Date | null>(null);
  const [newSlotTeremszam, setNewSlotTeremszam] = useState<string>('');
  const [selectedAppointmentType, setSelectedAppointmentType] = useState<
    'elso_konzultacio' | 'munkafazis' | 'kontroll' | null
  >(null);
  const [creatingNewSlot, setCreatingNewSlot] = useState(false);

  const patientScope = Boolean(propPatientId);
  const hasPatientEmail = Boolean(patientEmail && patientEmail.trim() !== '');

  // =========================================================================
  // Data loading
  // =========================================================================

  const loadAvailableSlots = useCallback(async () => {
    try {
      let allSlots: TimeSlot[] = [];
      let page = 1;
      let hasMore = true;
      const limit = 100;
      const maxPages = 100;

      while (hasMore && page <= maxPages) {
        const response = await fetch(
          `/api/time-slots?page=${page}&limit=${limit}&onlyAvailable=true`,
          { credentials: 'include' },
        );
        if (response.ok) {
          const data = await response.json();
          const slots = data.timeSlots || [];
          allSlots = [...allSlots, ...slots];

          const pagination = data.pagination;
          if (pagination && page >= pagination.totalPages) {
            hasMore = false;
          } else if (slots.length < limit) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      const now = new Date();
      const fourHoursFromNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const futureSlots = allSlots.filter(
        (slot: TimeSlot) => new Date(slot.startTime) >= fourHoursFromNow,
      );
      setAvailableSlots(futureSlots);
    } catch (error) {
      console.error('Error loading time slots:', error);
    }
  }, []);

  const loadPatients = useCallback(async () => {
    if (propPatientId) return;

    try {
      const response = await fetch('/api/patients', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const allPatients: Patient[] = data.patients || [];
        setPatients(allPatients.filter((p) => p.email && p.email.trim() !== ''));
      }
    } catch (error) {
      console.error('Error loading patients:', error);
    }
  }, [propPatientId]);

  const loadOffers = useCallback(async () => {
    try {
      const url = propPatientId
        ? `/api/appointments?patientId=${propPatientId}`
        : '/api/appointments';
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const all = data.appointments || [];
        // approval_status NULL = normál időpont; csak a feltételes ajánlatok kellenek.
        setOffers(
          all.filter((apt: ConditionalOffer) =>
            apt.approvalStatus === 'pending' ||
            apt.approvalStatus === 'approved' ||
            apt.approvalStatus === 'rejected',
          ),
        );
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
    }
  }, [propPatientId]);

  const loadData = useCallback(async () => {
    if (isLoadingRef.current) return;

    try {
      isLoadingRef.current = true;
      setLoading(true);
      await Promise.all([loadAvailableSlots(), loadOffers(), loadPatients()]);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [loadAvailableSlots, loadOffers, loadPatients]);

  // =========================================================================
  // Effects
  // =========================================================================

  useEffect(() => {
    if (propPatientId) setSelectedPatient(propPatientId);
  }, [propPatientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // =========================================================================
  // Handlers
  // =========================================================================

  const handleCreatePendingAppointment = useCallback(async () => {
    const effectivePatientId = propPatientId || selectedPatient;

    if (!effectivePatientId || !selectedSlot) {
      alert('Kérjük, válasszon beteget és időpontot!');
      return;
    }

    if (propPatientId) {
      if (!patientEmail || patientEmail.trim() === '') {
        alert('A betegnek nincs email címe. A feltételes időpontválasztáshoz email cím szükséges.');
        return;
      }
    } else {
      const selectedPatientData = patients.find((p) => p.id === selectedPatient);
      if (!selectedPatientData || !selectedPatientData.email) {
        alert('A kiválasztott betegnek nincs email címe. A feltételes időpontválasztáshoz email cím szükséges.');
        return;
      }
    }

    if (
      !confirm(
        'Biztosan létre szeretné hozni ezt a feltételes időpontot? A páciens emailben értesítést kap és jóváhagyhatja vagy elvetheti az időpontot.',
      )
    )
      return;

    try {
      setCreating(true);
      const response = await fetch('/api/appointments/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId: effectivePatientId,
          timeSlotId: selectedSlot,
          alternativeTimeSlotIds: alternativeSlots.filter((id) => id && id !== selectedSlot),
          appointmentType: selectedAppointmentType || null,
        }),
      });
      if (response.ok) {
        await loadData();
        if (!propPatientId) setSelectedPatient('');
        setSelectedSlot('');
        setAlternativeSlots([]);
        setSelectedAppointmentType(null);
        setShowOfferForm(false);
        onBookingComplete?.();
        alert('Feltételes időpont sikeresen létrehozva! A páciens emailben értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt a feltételes időpont létrehozásakor');
      }
    } catch (error) {
      console.error('Error creating pending appointment:', error);
      alert('Hiba történt a feltételes időpont létrehozásakor');
    } finally {
      setCreating(false);
    }
  }, [propPatientId, patientEmail, selectedPatient, selectedSlot, alternativeSlots, selectedAppointmentType, patients, loadData, onBookingComplete]);

  const addAlternativeSlot = useCallback(() => {
    setAlternativeSlots([...alternativeSlots, '']);
  }, [alternativeSlots]);

  const removeAlternativeSlot = useCallback(
    (index: number) => {
      setAlternativeSlots(alternativeSlots.filter((_, i) => i !== index));
    },
    [alternativeSlots],
  );

  const updateAlternativeSlot = useCallback(
    (index: number, slotId: string) => {
      const newAlternatives = [...alternativeSlots];
      newAlternatives[index] = slotId;
      setAlternativeSlots(newAlternatives);
    },
    [alternativeSlots],
  );

  const handleCreateNewTimeSlot = useCallback(async () => {
    if (!newSlotDateTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }
    if (newSlotDateTime <= new Date()) {
      alert('Az időpont csak jövőbeli dátum lehet!');
      return;
    }

    const isoDateTime = toLocalISOString(newSlotDateTime);

    try {
      setCreatingNewSlot(true);
      const response = await fetch('/api/time-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startTime: isoDateTime,
          cim: DEFAULT_CIM,
          teremszam: newSlotTeremszam.trim() || null,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const createdSlotId = data.timeSlot.id;
        await loadAvailableSlots();
        setSelectedSlot(createdSlotId);
        setNewSlotDateTime(null);
        setNewSlotTeremszam('');
        setShowNewSlotForm(false);
        alert('Új időpont sikeresen létrehozva és kiválasztva!');
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Hiba történt az időpont létrehozásakor');
      }
    } catch (error) {
      console.error('Error creating new time slot:', error);
      alert('Hiba történt az időpont létrehozásakor');
    } finally {
      setCreatingNewSlot(false);
    }
  }, [newSlotDateTime, newSlotTeremszam, loadAvailableSlots]);

  // =========================================================================
  // Derived / memoised values
  // =========================================================================

  const availableSlotsOnly = useMemo(
    () => availableSlots.filter((slot) => slot.status === 'available'),
    [availableSlots],
  );

  // Beteg-scope lista: a legutóbb kiküldött ajánlat legyen felül (az API a slot
  // start_time szerint rendez, amivel a régi elutasított ajánlatok kerülnének előre).
  const offersByCreatedDesc = useMemo(
    () =>
      [...offers].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [offers],
  );

  const pendingOffers = useMemo(
    () => offers.filter((o) => o.approvalStatus === 'pending'),
    [offers],
  );

  const rejectedOffers = useMemo(
    () => offers.filter((o) => o.approvalStatus === 'rejected'),
    [offers],
  );

  // =========================================================================
  // Shared form pieces
  // =========================================================================

  const renderSlotAndOptionsFields = () => (
    <>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Szabad időpont</label>
          <button
            type="button"
            onClick={() => setShowNewSlotForm(!showNewSlotForm)}
            className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/40 transition-colors"
            disabled={creating || creatingNewSlot}
          >
            <Plus className="w-4 h-4" />
            {showNewSlotForm ? 'Mégse' : 'Új időpont létrehozása'}
          </button>
        </div>
        {showNewSlotForm && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Dátum és idő</label>
              <DateTimePicker
                selected={newSlotDateTime}
                onChange={(date: Date | null) => setNewSlotDateTime(date)}
                minDate={new Date()}
                placeholder="Válasszon dátumot és időt"
                className="form-input w-full"
                disabled={creatingNewSlot}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Teremszám (opcionális)</label>
              <input
                type="text"
                value={newSlotTeremszam}
                onChange={(e) => setNewSlotTeremszam(digitsOnly(e.target.value))}
                placeholder="Pl. 101"
                className="form-input w-full"
                disabled={creatingNewSlot}
              />
            </div>
            <button
              type="button"
              onClick={handleCreateNewTimeSlot}
              disabled={!newSlotDateTime || creatingNewSlot}
              className="btn-primary w-full"
            >
              {creatingNewSlot ? 'Létrehozás...' : 'Időpont létrehozása'}
            </button>
          </div>
        )}
        <select
          value={selectedSlot}
          onChange={(e) => setSelectedSlot(e.target.value)}
          className="form-input w-full"
          disabled={creating || creatingNewSlot}
        >
          <option value="">Válasszon időpontot...</option>
          {availableSlotsOnly.map((slot) => {
            const displayCim = slot.cim || DEFAULT_CIM;
            return (
              <option key={slot.id} value={slot.id}>
                {formatDateTime(slot.startTime)}
                {slot.dentistName ? ` - ${slot.dentistName}` : ''}
                {` - ${displayCim}`}
                {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                {slot.userEmail ? ` - ${slot.userEmail}` : ''}
              </option>
            );
          })}
        </select>
        {availableSlotsOnly.length === 0 && !showNewSlotForm && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Jelenleg nincs elérhető szabad időpont.</p>
        )}
      </div>

      {/* Időpont típusa */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Időpont típusa</label>
        <select
          value={selectedAppointmentType || ''}
          onChange={(e) => setSelectedAppointmentType((e.target.value as any) || null)}
          className="form-input w-full"
          disabled={creating}
        >
          <option value="">Nincs megadva</option>
          <option value="elso_konzultacio">Első konzultáció</option>
          <option value="munkafazis">Munkafázis</option>
          <option value="kontroll">Kontroll</option>
        </select>
      </div>

      {/* Alternatív időpontok */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Alternatív időpontok (opcionális)</label>
          <button
            type="button"
            onClick={addAlternativeSlot}
            className="flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            disabled={creating}
          >
            <Plus className="w-4 h-4" />
            Hozzáadás
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Ha a beteg elutasítja az első időpontot, automatikusan az első alternatívát fogjuk felajánlani, majd a
          másodikat stb.
        </p>
        {alternativeSlots.length > 0 && (
          <div className="space-y-2">
            {alternativeSlots.map((altSlotId, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={altSlotId}
                  onChange={(e) => updateAlternativeSlot(index, e.target.value)}
                  className="form-input flex-1"
                  disabled={creating}
                >
                  <option value="">Válasszon alternatív időpontot...</option>
                  {availableSlotsOnly
                    .filter(
                      (slot) =>
                        (slot.id !== selectedSlot && !alternativeSlots.includes(slot.id)) ||
                        slot.id === altSlotId,
                    )
                    .map((slot) => {
                      const displayCim = slot.cim || DEFAULT_CIM;
                      return (
                        <option key={slot.id} value={slot.id}>
                          {formatDateTime(slot.startTime)}
                          {slot.dentistName ? ` - ${slot.dentistName}` : ''}
                          {` - ${displayCim}`}
                          {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                          {slot.userEmail ? ` - ${slot.userEmail}` : ''}
                        </option>
                      );
                    })}
                </select>
                <button
                  type="button"
                  onClick={() => removeAlternativeSlot(index)}
                  className="p-2 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/40 rounded transition-colors"
                  disabled={creating}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  // =========================================================================
  // Loading state
  // =========================================================================

  if (loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500 dark:text-gray-400">Betöltés...</p>
      </div>
    );
  }

  // =========================================================================
  // Beteg-scope: EGY kártya — ajánlatküldés + egységes lista
  // =========================================================================

  if (patientScope) {
    return (
      <div className="card border-l-4 border-blue-500">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Mail className="w-5 h-5 text-blue-500 dark:text-blue-400 flex-shrink-0" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Betegnek küldött időpont-ajánlatok
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowOfferForm((v) => !v)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/40 transition-colors flex-shrink-0"
            disabled={creating || creatingNewSlot}
          >
            {showOfferForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showOfferForm ? 'Mégse' : 'Új ajánlat küldése'}
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          A beteg e-mailben kapja meg az ajánlott időpontot, és jóváhagyhatja, elvetheti vagy új
          időpontot kérhet.
        </p>

        {!hasPatientEmail && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded">
            <p className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                A betegnek nincs rögzített e-mail címe, az ajánlat pedig e-mailben jut el hozzá.
                Ajánlat küldéséhez rögzítsen e-mail címet a beteg adatlapján.
              </span>
            </p>
          </div>
        )}

        {showOfferForm && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
            {renderSlotAndOptionsFields()}
            <button
              onClick={handleCreatePendingAppointment}
              disabled={!selectedSlot || creating || creatingNewSlot || !hasPatientEmail}
              className="btn-primary w-full"
            >
              {creating ? 'Küldés...' : 'Ajánlat küldése'}
            </button>
          </div>
        )}

        <MobileTable
          items={offersByCreatedDesc}
          renderRow={(offer) => (
            <>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                  <span className="text-sm text-gray-900 dark:text-gray-100">{formatDateTime(offer.startTime)}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {new Date(offer.createdAt).toLocaleString('hu-HU')}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <OfferStatusChip status={offer.approvalStatus} />
              </td>
            </>
          )}
          renderCard={(offer) => (
            <div className="mobile-card">
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {formatDateTime(offer.startTime)}
                  </h3>
                </div>
                <OfferStatusChip status={offer.approvalStatus} />
              </div>
              <MobileKeyValueGrid
                items={[{ key: 'Kiküldve', value: new Date(offer.createdAt).toLocaleString('hu-HU') }]}
              />
            </div>
          )}
          keyExtractor={(offer) => offer.id}
          emptyState={
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">
                Ennek a betegnek még nincs kiküldött időpont-ajánlata.
              </p>
            </div>
          }
          renderHeader={() => (
            <>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Időpont</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Kiküldve</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Állapot</th>
            </>
          )}
        />
      </div>
    );
  }

  // =========================================================================
  // Globális (admin-lista) nézet — a korábbi viselkedés változatlanul
  // =========================================================================

  return (
    <div className="space-y-6">
      {/* Űrlap-kártya */}
      <div className="card p-6 border-l-4 border-blue-500">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-blue-500 dark:text-blue-400" />
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Feltételes időpontválasztás</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Hozzon létre egy időpontot, amelyet a páciens emailben jóváhagyhat vagy elvethet. A páciens új időpontot is
          kérhet, ha az ajánlott időpont nem megfelelő.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Beteg (csak email címmel rendelkező betegek)
            </label>
            <select
              value={selectedPatient}
              onChange={(e) => setSelectedPatient(e.target.value)}
              className="form-input w-full"
              disabled={creating}
            >
              <option value="">Válasszon beteget...</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.nev || 'Név nélküli'} {patient.taj ? `(${patient.taj})` : ''} - {patient.email}
                </option>
              ))}
            </select>
            {patients.length === 0 && (
              <p className="text-sm text-amber-600 dark:text-amber-300 mt-2 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                Nincs olyan beteg, akinek email címe lenne. A feltételes időpontválasztáshoz email cím szükséges.
              </p>
            )}
          </div>
          {renderSlotAndOptionsFields()}
          <button
            onClick={handleCreatePendingAppointment}
            disabled={
              !selectedPatient ||
              !selectedSlot ||
              creating ||
              creatingNewSlot ||
              patients.length === 0
            }
            className="btn-primary w-full"
          >
            {creating ? 'Létrehozás...' : 'Feltételes időpont létrehozása'}
          </button>
        </div>
      </div>

      {/* Jóváhagyásra váró időpontok */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Jóváhagyásra váró időpontok</h3>
        </div>
        <MobileTable
          items={pendingOffers}
          renderRow={(appointment) => (
            <>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <User className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {appointment.patientName || 'Név nélküli'}
                    </div>
                    {appointment.patientTaj && (
                      <div className="text-sm text-gray-500 dark:text-gray-400">TAJ: {appointment.patientTaj}</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <Mail className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                  <span className="text-sm text-gray-900 dark:text-gray-100">{appointment.patientEmail || 'Nincs email'}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                  <span className="text-sm text-gray-900 dark:text-gray-100">{formatDateTime(appointment.startTime)}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {new Date(appointment.createdAt).toLocaleString('hu-HU')}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <OfferStatusChip status="pending" />
              </td>
            </>
          )}
          renderCard={(appointment) => (
            <div className="mobile-card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <User className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {appointment.patientName || 'Név nélküli'}
                  </h3>
                </div>
                <OfferStatusChip status="pending" />
              </div>
              <MobileKeyValueGrid
                items={[
                  { key: 'Email', value: appointment.patientEmail || 'Nincs email' },
                  { key: 'Időpont', value: formatDateTime(appointment.startTime) },
                  { key: 'Létrehozva', value: new Date(appointment.createdAt).toLocaleString('hu-HU') },
                  ...(appointment.patientTaj ? [{ key: 'TAJ', value: appointment.patientTaj }] : []),
                ]}
              />
            </div>
          )}
          keyExtractor={(appointment) => appointment.id}
          emptyState={
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Jelenleg nincs jóváhagyásra váró időpont.</p>
            </div>
          }
          renderHeader={() => (
            <>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Beteg</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Időpont</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Létrehozva</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Státusz</th>
            </>
          )}
        />
      </div>

      {/* Elutasított időpontok */}
      {rejectedOffers.length > 0 && (
        <div className="card mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Elutasított időpontok</h3>
          </div>
          <MobileTable
            items={rejectedOffers}
            renderRow={(appointment) => (
              <>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <User className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {appointment.patientName || 'Név nélküli'}
                      </div>
                      {appointment.patientTaj && (
                        <div className="text-sm text-gray-500 dark:text-gray-400">TAJ: {appointment.patientTaj}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Mail className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                    <span className="text-sm text-gray-900 dark:text-gray-100">{appointment.patientEmail || 'Nincs email'}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                    <span className="text-sm text-gray-900 dark:text-gray-100">{formatDateTime(appointment.startTime)}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(appointment.createdAt).toLocaleString('hu-HU')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <OfferStatusChip status="rejected" />
                </td>
              </>
            )}
            renderCard={(appointment) => (
              <div className="mobile-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <User className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {appointment.patientName || 'Név nélküli'}
                    </h3>
                  </div>
                  <OfferStatusChip status="rejected" />
                </div>
                <MobileKeyValueGrid
                  items={[
                    { key: 'Email', value: appointment.patientEmail || 'Nincs email' },
                    { key: 'Időpont', value: formatDateTime(appointment.startTime) },
                    { key: 'Létrehozva', value: new Date(appointment.createdAt).toLocaleString('hu-HU') },
                    ...(appointment.patientTaj ? [{ key: 'TAJ', value: appointment.patientTaj }] : []),
                  ]}
                />
              </div>
            )}
            keyExtractor={(appointment) => appointment.id}
            renderHeader={() => (
              <>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Beteg</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Időpont</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Létrehozva</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Státusz</th>
              </>
            )}
          />
        </div>
      )}
    </div>
  );
}
