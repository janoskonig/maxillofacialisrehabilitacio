'use client';

import { useState } from 'react';
import { Calendar, Plus, Trash2, Edit2, Clock, X, ChevronDown, ChevronUp, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDateTime, digitsOnly } from '@/lib/dateUtils';
import { DateTimePicker } from './DateTimePicker';
import { MobileTable } from './mobile/MobileTable';
import { MobileKeyValueGrid } from './mobile/MobileKeyValueGrid';
import { useTimeSlots } from '@/hooks/useTimeSlots';
import type { TimeSlot, SortField, AppointmentType } from '@/hooks/useTimeSlots';

export function TimeSlotsManager() {
  // ── Hook: all data, filtering, sorting, pagination, CRUD ─────────
  const ts = useTimeSlots();

  // ── UI-only state ─────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  const [newStartTime, setNewStartTime] = useState<Date | null>(null);
  const [newTeremszam, setNewTeremszam] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  const [modifyingAppointment, setModifyingAppointment] = useState<{
    appointmentId: string;
    timeSlotId: string;
    startTime: string;
  } | null>(null);
  const [newTimeSlotId, setNewTimeSlotId] = useState('');

  const [editingAppointmentType, setEditingAppointmentType] = useState<{
    appointmentId: string;
    currentType: AppointmentType | null;
  } | null>(null);
  const [newAppointmentType, setNewAppointmentType] = useState<AppointmentType | null>(null);

  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkAppointmentType, setBulkAppointmentType] = useState<AppointmentType | null>(null);

  // ── Thin wrappers around hook CRUD (manage modal state) ───────────

  const handleCreateTimeSlot = async () => {
    if (!newStartTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }
    if (ts.userRole === 'admin' && !selectedUserId) {
      alert('Kérjük, válasszon felhasználót!');
      return;
    }

    const success = await ts.createTimeSlot({
      startTime: newStartTime,
      teremszam: newTeremszam,
      userId: ts.userRole === 'admin' ? selectedUserId : undefined,
    });

    if (success) {
      setNewStartTime(null);
      setNewTeremszam('');
      setSelectedUserId('');
      setShowForm(false);
    }
  };

  const handleSaveModification = async () => {
    if (!modifyingAppointment || !newTimeSlotId) {
      alert('Kérjük, válasszon új időpontot!');
      return;
    }

    const success = await ts.modifyAppointment(modifyingAppointment.appointmentId, newTimeSlotId);
    if (success) {
      setModifyingAppointment(null);
      setNewTimeSlotId('');
    }
  };

  const handleSaveAppointmentType = async () => {
    if (!editingAppointmentType) return;

    const success = await ts.updateAppointmentType(editingAppointmentType.appointmentId, newAppointmentType);
    if (success) {
      setEditingAppointmentType(null);
      setNewAppointmentType(null);
    }
  };

  const handleBulkUpdateAppointmentType = async () => {
    const { successCount, errorCount } = await ts.bulkUpdateAppointmentType(
      Array.from(ts.selectedAppointmentIds),
      bulkAppointmentType,
    );

    if (successCount > 0 || errorCount > 0) {
      setShowBulkEditModal(false);
      setBulkAppointmentType(null);
    }
  };

  // ── Derived: available slots for the modification dropdown ────────

  const availableSlotsForModification = ts.availableFutureSlots.filter(
    s => !modifyingAppointment || s.id !== modifyingAppointment.timeSlotId
  );

  // ── Sort header renderer ──────────────────────────────────────────

  const renderSortableHeader = (label: string, field: SortField, className?: string) => {
    const isActive = ts.sortField === field;
    const SortIcon = isActive
      ? (ts.sortDirection === 'asc' ? ArrowUp : ArrowDown)
      : null;

    return (
      <th
        className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none ${
          isActive ? 'bg-gray-100' : ''
        } ${className || ''}`}
        onClick={() => ts.handleSort(field)}
      >
        <div className="flex items-center gap-1">
          <span>{label}</span>
          {SortIcon && (
            <SortIcon className="w-3 h-3 text-blue-600" />
          )}
        </div>
      </th>
    );
  };

  // ── Loading state ─────────────────────────────────────────────────

  if (ts.loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  // ── Table renderer ────────────────────────────────────────────────

  const renderTimeSlotTable = (slots: TimeSlot[], isPast: boolean = false) => {
    if (slots.length === 0) {
      return null;
    }

    const bookedSlotsInTable = slots.filter(s => s.status === 'booked' && ts.appointments[s.id]);
    const allSelected = bookedSlotsInTable.length > 0 &&
                        bookedSlotsInTable.every(s => ts.selectedAppointmentIds.has(ts.appointments[s.id].id));

    const renderTableHeader = () => (
      <>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">
          {bookedSlotsInTable.length > 0 && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => ts.selectAllAppointments(slots)}
              className="form-checkbox"
              title="Összes kijelölése"
            />
          )}
        </th>
        {renderSortableHeader('Időpont', 'startTime')}
        {renderSortableHeader('Cím', 'cim')}
        {renderSortableHeader('Teremszám', 'teremszam')}
        {renderSortableHeader('Fogpótlástanász', 'dentistName')}
        {renderSortableHeader('Státusz', 'status')}
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
          Lefoglalva
        </th>
        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
          Műveletek
        </th>
      </>
    );

    const renderTableRow = (slot: TimeSlot) => {
      const appointment = ts.appointments[slot.id];
      return (
        <>
          <td className="px-4 py-4 whitespace-nowrap">
            {slot.status === 'booked' && appointment ? (
              <input
                type="checkbox"
                checked={ts.selectedAppointmentIds.has(appointment.id)}
                onChange={() => ts.toggleAppointmentSelection(appointment.id)}
                className="form-checkbox"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="w-4"></span>
            )}
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="flex items-center">
              <Clock className={`w-4 h-4 mr-2 ${isPast ? 'text-gray-400' : 'text-gray-400'}`} />
              <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-900'}`}>
                {formatDateTime(slot.startTime)}
              </span>
            </div>
          </td>
          <td className="px-6 py-4">
            <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-600'}`}>
              {slot.cim || '1088 Budapest, Szentkirályi utca 47'}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-600'}`}>
              {slot.teremszam || '-'}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-600'}`}>
              {slot.dentistName || slot.userEmail || '-'}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                slot.status === 'available'
                  ? isPast
                    ? 'bg-gray-200 text-gray-600'
                    : 'bg-green-100 text-green-800'
                  : isPast
                    ? 'bg-gray-200 text-gray-600'
                    : 'bg-red-100 text-red-800'
              }`}
            >
              {slot.status === 'available' ? 'Szabad' : 'Lefoglalva'}
            </span>
          </td>
          <td className="px-6 py-4">
            {appointment ? (
              <div className={`text-sm space-y-1 ${isPast ? 'text-gray-500' : ''}`}>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase">Beteg:</span>
                  <div className={`font-medium mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-900'}`}>
                    {appointment.patientName || 'Név nélküli beteg'}
                  </div>
                  {appointment.patientTaj && (
                    <div className="text-xs text-gray-500">
                      TAJ: {appointment.patientTaj}
                    </div>
                  )}
                </div>
                <div className="pt-1 border-t border-gray-200">
                  <span className="text-xs font-medium text-gray-500 uppercase">Foglalta:</span>
                  <div className={`text-xs mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-700'}`}>
                    {appointment.bookedBy}
                  </div>
                </div>
                {appointment.appointmentType && (
                  <div className="pt-1 border-t border-gray-200">
                    <span className="text-xs font-medium text-gray-500 uppercase">Típus:</span>
                    <div className={`text-xs mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-700'}`}>
                      {appointment.appointmentType === 'elso_konzultacio' && 'Első konzultáció'}
                      {appointment.appointmentType === 'munkafazis' && 'Munkafázis'}
                      {appointment.appointmentType === 'kontroll' && 'Kontroll'}
                    </div>
                  </div>
                )}
              </div>
            ) : slot.status === 'booked' ? (
              <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-500'}`}>Lefoglalva (adatok betöltése...)</span>
            ) : (
              <span className={`text-sm ${isPast ? 'text-gray-400' : 'text-gray-400'}`}>-</span>
            )}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <div className="flex items-center justify-end gap-2">
              {slot.status === 'available' && (
                <button
                  onClick={() => ts.deleteTimeSlot(slot.id)}
                  className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-red-600 hover:text-red-900'} mobile-touch-target`}
                  title="Törlés"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {slot.status === 'booked' && appointment && (
                <>
                  <button
                    onClick={() => {
                      setEditingAppointmentType({ appointmentId: appointment.id, currentType: appointment.appointmentType || null });
                      setNewAppointmentType(appointment.appointmentType || null);
                    }}
                    className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-blue-600 hover:text-blue-900'} flex items-center gap-1 text-xs mobile-touch-target`}
                    title="Időpont típusa módosítása"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span className="hidden sm:inline">Típus</span>
                  </button>
                  <button
                    onClick={() => {
                      setModifyingAppointment({ appointmentId: appointment.id, timeSlotId: slot.id, startTime: slot.startTime });
                      setNewTimeSlotId('');
                    }}
                    className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-amber-600 hover:text-amber-900'} flex items-center gap-1 mobile-touch-target`}
                    title="Időpont módosítása"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Módosítás</span>
                  </button>
                  <button
                    onClick={() => ts.cancelAppointment(appointment.id)}
                    className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-red-600 hover:text-red-900'} flex items-center gap-1 mobile-touch-target`}
                    title="Időpont lemondása"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Lemondás</span>
                  </button>
                </>
              )}
            </div>
          </td>
        </>
      );
    };

    const renderMobileCard = (slot: TimeSlot) => {
      const appointment = ts.appointments[slot.id];
      const statusBadge = (
        <span
          className={`px-2 py-1 text-xs font-medium rounded-full ${
            slot.status === 'available'
              ? isPast
                ? 'bg-gray-200 text-gray-600'
                : 'bg-green-100 text-green-800'
              : isPast
                ? 'bg-gray-200 text-gray-600'
                : 'bg-red-100 text-red-800'
          }`}
        >
          {slot.status === 'available' ? 'Szabad' : 'Lefoglalva'}
        </span>
      );

      return (
        <div className={`mobile-card ${isPast ? 'opacity-60' : ''} ${slot.status === 'booked' ? 'bg-red-50' : ''}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Clock className={`w-4 h-4 flex-shrink-0 ${isPast ? 'text-gray-400' : 'text-gray-400'}`} />
              <h3 className={`text-base font-semibold ${isPast ? 'text-gray-500' : 'text-gray-900'} truncate`}>
                {formatDateTime(slot.startTime)}
              </h3>
            </div>
            <div className="flex-shrink-0 ml-2">
              {statusBadge}
            </div>
          </div>

          <MobileKeyValueGrid
            items={[
              { key: 'Cím', value: slot.cim || '1088 Budapest, Szentkirályi utca 47' },
              { key: 'Teremszám', value: slot.teremszam || '-' },
              { key: 'Fogpótlástanász', value: slot.dentistName || slot.userEmail || '-' },
            ]}
            className="mb-3"
          />

          {appointment && (
            <div className={`mb-3 p-3 bg-gray-50 rounded-lg ${isPast ? 'text-gray-500' : ''}`}>
              <div className="text-sm space-y-2">
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase">Beteg:</span>
                  <div className={`font-medium mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-900'}`}>
                    {appointment.patientName || 'Név nélküli beteg'}
                  </div>
                  {appointment.patientTaj && (
                    <div className="text-xs text-gray-500">
                      TAJ: {appointment.patientTaj}
                    </div>
                  )}
                </div>
                <div className="pt-1 border-t border-gray-200">
                  <span className="text-xs font-medium text-gray-500 uppercase">Foglalta:</span>
                  <div className={`text-xs mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-700'}`}>
                    {appointment.bookedBy}
                  </div>
                </div>
                {appointment.appointmentType && (
                  <div className="pt-1 border-t border-gray-200">
                    <span className="text-xs font-medium text-gray-500 uppercase">Típus:</span>
                    <div className={`text-xs mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-700'}`}>
                      {appointment.appointmentType === 'elso_konzultacio' && 'Első konzultáció'}
                      {appointment.appointmentType === 'munkafazis' && 'Munkafázis'}
                      {appointment.appointmentType === 'kontroll' && 'Kontroll'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-gray-200 flex flex-col gap-2">
            {slot.status === 'available' && (
              <button
                onClick={() => ts.deleteTimeSlot(slot.id)}
                className={`w-full btn-secondary flex items-center justify-center gap-2 mobile-touch-target ${
                  isPast ? 'text-gray-500' : 'text-red-600'
                }`}
              >
                <Trash2 className="w-4 h-4" />
                Törlés
              </button>
            )}
            {slot.status === 'booked' && appointment && (
              <>
                <button
                  onClick={() => {
                    setEditingAppointmentType({ appointmentId: appointment.id, currentType: appointment.appointmentType || null });
                    setNewAppointmentType(appointment.appointmentType || null);
                  }}
                  className={`w-full btn-secondary flex items-center justify-center gap-2 mobile-touch-target ${
                    isPast ? 'text-gray-500' : 'text-blue-600'
                  }`}
                >
                  <Edit2 className="w-4 h-4" />
                  Típus módosítása
                </button>
                <button
                  onClick={() => {
                    setModifyingAppointment({ appointmentId: appointment.id, timeSlotId: slot.id, startTime: slot.startTime });
                    setNewTimeSlotId('');
                  }}
                  className={`w-full btn-secondary flex items-center justify-center gap-2 mobile-touch-target ${
                    isPast ? 'text-gray-500' : 'text-amber-600'
                  }`}
                >
                  <Edit2 className="w-4 h-4" />
                  Időpont módosítása
                </button>
                <button
                  onClick={() => ts.cancelAppointment(appointment.id)}
                  className={`w-full btn-secondary flex items-center justify-center gap-2 mobile-touch-target ${
                    isPast ? 'text-gray-500' : 'text-red-600'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  Lemondás
                </button>
              </>
            )}
          </div>
        </div>
      );
    };

    const getRowClassName = (slot: TimeSlot) => {
      return `${isPast ? 'opacity-60' : ''} ${slot.status === 'booked' ? 'bg-red-50' : ''}`;
    };

    return (
      <MobileTable
        items={slots}
        renderRow={renderTableRow}
        renderCard={renderMobileCard}
        keyExtractor={(slot) => slot.id}
        renderHeader={renderTableHeader}
        rowClassName={getRowClassName}
      />
    );
  };

  // ── Main render ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Tömeges módosítás</h3>
              <button
                onClick={() => {
                  setShowBulkEditModal(false);
                  setBulkAppointmentType(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  <strong>{ts.selectedAppointmentIds.size} időpont</strong> kijelölve
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Időpont típusa
                </label>
                <select
                  value={bulkAppointmentType || ''}
                  onChange={(e) => setBulkAppointmentType(e.target.value as AppointmentType || null)}
                  className="form-input w-full"
                >
                  <option value="">Nincs megadva</option>
                  <option value="elso_konzultacio">Első konzultáció</option>
                  <option value="munkafazis">Munkafázis</option>
                  <option value="kontroll">Kontroll</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowBulkEditModal(false);
                    setBulkAppointmentType(null);
                  }}
                  className="btn-secondary"
                  disabled={ts.isBulkUpdating}
                >
                  Mégse
                </button>
                <button
                  onClick={handleBulkUpdateAppointmentType}
                  disabled={ts.isBulkUpdating}
                  className="btn-primary"
                >
                  {ts.isBulkUpdating ? 'Módosítás...' : `Módosítás (${ts.selectedAppointmentIds.size})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Appointment Type Edit Modal */}
      {editingAppointmentType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont típusa módosítása</h3>
              <button
                onClick={() => {
                  setEditingAppointmentType(null);
                  setNewAppointmentType(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Időpont típusa
                </label>
                <select
                  value={newAppointmentType || ''}
                  onChange={(e) => setNewAppointmentType(e.target.value as AppointmentType || null)}
                  className="form-input w-full"
                >
                  <option value="">Nincs megadva</option>
                  <option value="elso_konzultacio">Első konzultáció</option>
                  <option value="munkafazis">Munkafázis</option>
                  <option value="kontroll">Kontroll</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingAppointmentType(null);
                    setNewAppointmentType(null);
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button
                  onClick={handleSaveAppointmentType}
                  className="btn-primary"
                >
                  Mentés
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modification Modal */}
      {modifyingAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont módosítása</h3>
              <button
                onClick={() => {
                  setModifyingAppointment(null);
                  setNewTimeSlotId('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  <strong>Jelenlegi időpont:</strong> {formatDateTime(modifyingAppointment.startTime)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Új időpont
                </label>
                <select
                  value={newTimeSlotId}
                  onChange={(e) => setNewTimeSlotId(e.target.value)}
                  className="form-input w-full"
                >
                  <option value="">Válasszon új időpontot...</option>
                  {availableSlotsForModification.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {formatDateTime(slot.startTime)}
                    </option>
                  ))}
                </select>
                {availableSlotsForModification.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">
                    Jelenleg nincs elérhető szabad időpont.
                  </p>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setModifyingAppointment(null);
                    setNewTimeSlotId('');
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button
                  onClick={handleSaveModification}
                  disabled={!newTimeSlotId}
                  className="btn-primary"
                >
                  Módosítás mentése
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold text-gray-900">Szabad időpontok kezelése</h3>
        <button
          onClick={() => {
            setEditingSlot(null);
            setNewStartTime(null);
            setNewTeremszam('');
            setShowForm(!showForm);
          }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Új időpont
        </button>
      </div>

      {/* Szűrők */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Cím
          </label>
          <select
            value={ts.filterCim}
            onChange={(e) => ts.setFilterCim(e.target.value)}
            className="form-input w-full"
          >
            <option value="">Összes cím</option>
            {ts.uniqueCims.map(cim => (
              <option key={cim} value={cim}>{cim}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Teremszám
          </label>
          <select
            value={ts.filterTeremszam}
            onChange={(e) => ts.setFilterTeremszam(e.target.value)}
            className="form-input w-full"
          >
            <option value="">Összes terem</option>
            {ts.uniqueTeremszamok.map(terem => (
              <option key={terem} value={terem}>{terem}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Fogpótlástanász
          </label>
          <select
            value={ts.filterDentistName}
            onChange={(e) => ts.setFilterDentistName(e.target.value)}
            className="form-input w-full"
          >
            <option value="">Összes fogpótlástanász</option>
            {ts.uniqueDentists.map(dentist => (
              <option key={dentist} value={dentist}>{dentist}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Státusz
          </label>
          <select
            value={ts.filterStatus}
            onChange={(e) => ts.setFilterStatus(e.target.value as 'all' | 'available' | 'booked')}
            className="form-input w-full"
          >
            <option value="all">Összes</option>
            <option value="available">Szabad</option>
            <option value="booked">Lefoglalva</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Időpont típusa
          </label>
          <select
            value={ts.filterAppointmentType === null ? 'null' : ts.filterAppointmentType}
            onChange={(e) => {
              const value = e.target.value;
              ts.setFilterAppointmentType(
                value === 'all' ? 'all' :
                value === 'null' ? null :
                value as AppointmentType
              );
            }}
            className="form-input w-full"
          >
            <option value="all">Összes típus</option>
            <option value="elso_konzultacio">Első konzultáció</option>
            <option value="munkafazis">Munkafázis</option>
            <option value="kontroll">Kontroll</option>
            <option value="null">Nincs típus</option>
          </select>
        </div>
      </div>

      {/* Eredmények száma és törlés gomb */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-600">
          Összesen: {ts.filteredAndSortedSlots.length} időpont
          {ts.filteredAndSortedSlots.length !== ts.timeSlots.length && (
            <span> (szűrve: {ts.timeSlots.length} összesből)</span>
          )}
        </div>
        {ts.hasActiveFilters && (
          <button
            onClick={ts.clearFilters}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Szűrők törlése
          </button>
        )}
      </div>

      {showForm && (
        <div className="card p-4">
          <h4 className="font-medium mb-4">
            {editingSlot ? 'Időpont szerkesztése' : 'Új időpont létrehozása'}
          </h4>
          <div className="space-y-4">
            {ts.userRole === 'admin' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Felhasználó
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="form-input w-full"
                >
                  <option value="">Válasszon felhasználót...</option>
                  {ts.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email} ({user.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <DateTimePicker
                    selected={newStartTime}
                    onChange={(date: Date | null) => setNewStartTime(date)}
                    minDate={new Date()}
                    placeholder="Válasszon dátumot és időt"
                    className="form-input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teremszám
                </label>
                <input
                  type="text"
                  value={newTeremszam}
                  onChange={(e) => setNewTeremszam(digitsOnly(e.target.value))}
                  placeholder="Pl. 101"
                  className="form-input w-full"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateTimeSlot}
                  className="btn-primary"
                >
                  Mentés
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setNewStartTime(null);
                    setNewTeremszam('');
                    setSelectedUserId('');
                    setEditingSlot(null);
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jövőbeli időpontok */}
      {(ts.allFutureSlots.length > 0 || ts.allPastSlots.length === 0) && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-semibold">Jövőbeli időpontok</h4>
            {ts.selectedAppointmentIds.size > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">
                  {ts.selectedAppointmentIds.size} időpont kijelölve
                </span>
                <button
                  onClick={() => {
                    setShowBulkEditModal(true);
                    setBulkAppointmentType(null);
                  }}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  <Edit2 className="w-4 h-4" />
                  Kijelöltek módosítása
                </button>
                <button
                  onClick={ts.clearSelection}
                  className="btn-secondary text-sm"
                >
                  Kijelölés törlése
                </button>
              </div>
            )}
          </div>
          {ts.futureSlots.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Nincs jövőbeli időpont.</p>
            </div>
          ) : (
            renderTimeSlotTable(ts.futureSlots, false)
          )}
        </div>
      )}

      {/* Elmúlt időpontok */}
      {ts.allPastSlots.length > 0 && (
        <div className="card">
          <button
            onClick={() => ts.setShowPastSlots(!ts.showPastSlots)}
            className="flex items-center justify-between w-full mb-4 text-left"
          >
            <h4 className="text-lg font-semibold text-gray-600">
              Elmúlt időpontok ({ts.allPastSlots.length})
            </h4>
            {ts.showPastSlots ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          {ts.showPastSlots && (
            <>
              {ts.pastSlots.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">Nincs elmúlt időpont ezen az oldalon.</p>
                </div>
              ) : (
                renderTimeSlotTable(ts.pastSlots, true)
              )}
              {/* Pagináció elmúlt időpontokhoz */}
              {ts.pastTotalPages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    Oldal {ts.currentPage} / {ts.pastTotalPages} (összesen {ts.allPastSlots.length} elmúlt időpont)
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => ts.setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={ts.currentPage === 1}
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        ts.currentPage === 1
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                      }`}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, ts.pastTotalPages) }, (_, i) => {
                        let pageNum: number;
                        if (ts.pastTotalPages <= 5) {
                          pageNum = i + 1;
                        } else if (ts.currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (ts.currentPage >= ts.pastTotalPages - 2) {
                          pageNum = ts.pastTotalPages - 4 + i;
                        } else {
                          pageNum = ts.currentPage - 2 + i;
                        }
                        return (
                          <button
                            key={pageNum}
                            onClick={() => ts.setCurrentPage(pageNum)}
                            className={`px-3 py-2 rounded-md text-sm font-medium ${
                              ts.currentPage === pageNum
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => ts.setCurrentPage(prev => Math.min(ts.pastTotalPages, prev + 1))}
                      disabled={ts.currentPage === ts.pastTotalPages}
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        ts.currentPage === ts.pastTotalPages
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                      }`}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Pagináció - csak jövőbeli időpontokra */}
      {ts.futureTotalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Oldal {ts.currentPage} / {ts.futureTotalPages} (összesen {ts.allFutureSlots.length} jövőbeli időpont)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => ts.setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={ts.currentPage === 1}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                ts.currentPage === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, ts.futureTotalPages) }, (_, i) => {
                let pageNum: number;
                if (ts.futureTotalPages <= 5) {
                  pageNum = i + 1;
                } else if (ts.currentPage <= 3) {
                  pageNum = i + 1;
                } else if (ts.currentPage >= ts.futureTotalPages - 2) {
                  pageNum = ts.futureTotalPages - 4 + i;
                } else {
                  pageNum = ts.currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => ts.setCurrentPage(pageNum)}
                    className={`px-3 py-2 rounded-md text-sm font-medium ${
                      ts.currentPage === pageNum
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => ts.setCurrentPage(prev => Math.min(ts.futureTotalPages, prev + 1))}
              disabled={ts.currentPage === ts.futureTotalPages}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                ts.currentPage === ts.futureTotalPages
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {ts.timeSlots.length === 0 && (
        <div className="card">
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Még nincs létrehozva időpont.</p>
          </div>
        </div>
      )}
    </div>
  );
}
