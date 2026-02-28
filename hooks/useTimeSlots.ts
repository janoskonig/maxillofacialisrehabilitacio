'use client';

import { useState, useEffect, useMemo } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { toLocalISOString } from '@/lib/dateUtils';

// ── Types ────────────────────────────────────────────────────────────

export interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  cim?: string | null;
  teremszam?: string | null;
  createdAt: string;
  updatedAt: string;
  userEmail?: string;
  dentistName?: string | null;
}

export interface AppointmentInfo {
  id: string;
  patientName: string | null;
  patientTaj: string | null;
  bookedBy: string;
  appointmentType?: AppointmentType | null;
}

export interface User {
  id: string;
  email: string;
  role: string;
}

export type SortField = 'startTime' | 'cim' | 'teremszam' | 'dentistName' | 'status';
export type AppointmentType = 'elso_konzultacio' | 'munkafazis' | 'kontroll';
export type FilterStatus = 'all' | 'available' | 'booked';
export type FilterAppointmentType = 'all' | AppointmentType | null;

export interface CreateTimeSlotParams {
  startTime: Date;
  teremszam: string;
  userId?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 50;
const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
const PAST_SLOT_DELAY_MS = 4 * 60 * 60 * 1000;

// ── Comparator ───────────────────────────────────────────────────────

export function compareTimeSlots(a: TimeSlot, b: TimeSlot, field: SortField): number {
  switch (field) {
    case 'startTime':
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    case 'cim': {
      const cimA = (a.cim || DEFAULT_CIM).toLowerCase();
      const cimB = (b.cim || DEFAULT_CIM).toLowerCase();
      return cimA.localeCompare(cimB, 'hu');
    }
    case 'teremszam': {
      const teremA = (a.teremszam || '').toLowerCase();
      const teremB = (b.teremszam || '').toLowerCase();
      return teremA.localeCompare(teremB, 'hu');
    }
    case 'dentistName': {
      const dentistA = (a.dentistName || a.userEmail || '').toLowerCase();
      const dentistB = (b.dentistName || b.userEmail || '').toLowerCase();
      return dentistA.localeCompare(dentistB, 'hu');
    }
    case 'status': {
      const statusA = a.status === 'available' ? 0 : 1;
      const statusB = b.status === 'available' ? 0 : 1;
      return statusA - statusB;
    }
  }
}

// ── Paginated fetch helper ───────────────────────────────────────────

async function fetchAllPages<T>(
  baseUrl: string,
  dataKey: string,
  limit = 100,
  maxPages = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const res = await fetch(`${baseUrl}?page=${page}&limit=${limit}`, {
      credentials: 'include',
    });

    if (!res.ok) {
      console.error(`Failed to load ${dataKey} (page ${page})`);
      break;
    }

    const json = await res.json();
    const items: T[] = json[dataKey] || [];
    all.push(...items);

    const pagination = json.pagination;
    if (pagination) {
      hasMore = page < pagination.totalPages && items.length === limit;
    } else {
      hasMore = items.length === limit;
    }
    page++;
  }

  return all;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useTimeSlots() {
  // Core data
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Record<string, AppointmentInfo>>({});
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('');
  const [users, setUsers] = useState<User[]>([]);

  // Filters
  const [filterCim, setFilterCimRaw] = useState('');
  const [filterTeremszam, setFilterTeremszamRaw] = useState('');
  const [filterDentistName, setFilterDentistNameRaw] = useState('');
  const [filterStatus, setFilterStatusRaw] = useState<FilterStatus>('all');
  const [filterAppointmentType, setFilterAppointmentTypeRaw] = useState<FilterAppointmentType>('all');

  // Sort
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Past/future toggle
  const [showPastSlots, setShowPastSlots] = useState(false);

  // Selection
  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // ── Filter setters (auto-reset page) ───────────────────────────────

  const setFilterCim = (v: string) => { setFilterCimRaw(v); setCurrentPage(1); };
  const setFilterTeremszam = (v: string) => { setFilterTeremszamRaw(v); setCurrentPage(1); };
  const setFilterDentistName = (v: string) => { setFilterDentistNameRaw(v); setCurrentPage(1); };
  const setFilterStatus = (v: FilterStatus) => { setFilterStatusRaw(v); setCurrentPage(1); };
  const setFilterAppointmentType = (v: FilterAppointmentType) => { setFilterAppointmentTypeRaw(v); setCurrentPage(1); };

  const clearFilters = () => {
    setFilterCimRaw('');
    setFilterTeremszamRaw('');
    setFilterDentistNameRaw('');
    setFilterStatusRaw('all');
    setFilterAppointmentTypeRaw('all');
    setCurrentPage(1);
  };

  const hasActiveFilters =
    filterCim !== '' || filterTeremszam !== '' || filterDentistName !== '' ||
    filterStatus !== 'all' || filterAppointmentType !== 'all';

  // ── Data loading ───────────────────────────────────────────────────

  const loadUsers = async () => {
    try {
      const res = await fetch('/api/users', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadTimeSlots = async () => {
    try {
      setLoading(true);

      const [allTimeSlots, allAppointments] = await Promise.all([
        fetchAllPages<TimeSlot>('/api/time-slots', 'timeSlots'),
        fetchAllPages<any>('/api/appointments', 'appointments'),
      ]);

      setTimeSlots(allTimeSlots);

      const appointmentsMap: Record<string, AppointmentInfo> = {};
      allAppointments.forEach((apt: any) => {
        appointmentsMap[apt.timeSlotId] = {
          id: apt.id,
          patientName: apt.patientName,
          patientTaj: apt.patientTaj,
          bookedBy: apt.createdBy,
          appointmentType: apt.appointmentType || null,
        };
      });
      setAppointments(appointmentsMap);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTimeSlots();
    (async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          setUserRole(user.role);
          if (user.role === 'admin') loadUsers();
        }
      } catch (error) {
        console.error('Error loading user role:', error);
      }
    })();
  }, []);

  // ── Derived data ───────────────────────────────────────────────────

  const filteredAndSortedSlots = useMemo(() => {
    let filtered = [...timeSlots];

    if (filterCim) {
      filtered = filtered.filter(slot =>
        (slot.cim || DEFAULT_CIM).toLowerCase() === filterCim.toLowerCase()
      );
    }
    if (filterTeremszam) {
      filtered = filtered.filter(slot =>
        (slot.teremszam || '').toLowerCase() === filterTeremszam.toLowerCase()
      );
    }
    if (filterDentistName) {
      filtered = filtered.filter(slot =>
        (slot.dentistName || slot.userEmail || '').toLowerCase() === filterDentistName.toLowerCase()
      );
    }
    if (filterStatus !== 'all') {
      filtered = filtered.filter(slot => slot.status === filterStatus);
    }
    if (filterAppointmentType !== 'all') {
      filtered = filtered.filter(slot => {
        if (slot.status !== 'booked') return filterAppointmentType === null;
        const appt = appointments[slot.id];
        if (!appt) return filterAppointmentType === null;
        if (filterAppointmentType === null) return !appt.appointmentType;
        return appt.appointmentType === filterAppointmentType;
      });
    }

    if (sortField) {
      filtered.sort((a, b) => {
        const cmp = compareTimeSlots(a, b, sortField);
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }

    return filtered;
  }, [timeSlots, filterCim, filterTeremszam, filterDentistName, filterStatus, filterAppointmentType, appointments, sortField, sortDirection]);

  const uniqueCims = useMemo(() => {
    const set = new Set<string>();
    timeSlots.forEach(s => set.add(s.cim || DEFAULT_CIM));
    return Array.from(set).sort();
  }, [timeSlots]);

  const uniqueTeremszamok = useMemo(() => {
    const set = new Set<string>();
    timeSlots.forEach(s => { if (s.teremszam) set.add(s.teremszam); });
    return Array.from(set).sort();
  }, [timeSlots]);

  const uniqueDentists = useMemo(() => {
    const set = new Set<string>();
    timeSlots.forEach(s => {
      const d = s.dentistName || s.userEmail || '';
      if (d) set.add(d);
    });
    return Array.from(set).sort();
  }, [timeSlots]);

  // Past / future split (recomputed every render for fresh "now")
  const fourHoursBeforeNow = new Date(Date.now() - PAST_SLOT_DELAY_MS);
  const allFutureSlots = filteredAndSortedSlots.filter(s => new Date(s.startTime) >= fourHoursBeforeNow);
  const allPastSlots = filteredAndSortedSlots.filter(s => new Date(s.startTime) < fourHoursBeforeNow);

  useEffect(() => {
    if (allFutureSlots.length === 0 && allPastSlots.length > 0) {
      setShowPastSlots(true);
    }
  }, [allFutureSlots.length, allPastSlots.length]);

  // Paginated slices
  const futureTotalPages = Math.ceil(allFutureSlots.length / ITEMS_PER_PAGE);
  const futureStart = (currentPage - 1) * ITEMS_PER_PAGE;
  const futureSlots = allFutureSlots.slice(futureStart, futureStart + ITEMS_PER_PAGE);

  const pastTotalPages = Math.ceil(allPastSlots.length / ITEMS_PER_PAGE);
  const pastStart = (currentPage - 1) * ITEMS_PER_PAGE;
  const pastSlots = allPastSlots.slice(pastStart, pastStart + ITEMS_PER_PAGE);

  // Available future slots (for the modification dropdown, caller filters out the current slot)
  const availableFutureSlots = filteredAndSortedSlots.filter(
    s => s.status === 'available' && new Date(s.startTime) >= fourHoursBeforeNow
  );

  // ── Sort handler ───────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // ── Selection ──────────────────────────────────────────────────────

  const toggleAppointmentSelection = (appointmentId: string) => {
    setSelectedAppointmentIds(prev => {
      const next = new Set(prev);
      if (next.has(appointmentId)) next.delete(appointmentId);
      else next.add(appointmentId);
      return next;
    });
  };

  const selectAllAppointments = (slots: TimeSlot[]) => {
    const bookedIds = new Set<string>();
    slots.forEach(slot => {
      if (slot.status === 'booked' && appointments[slot.id]) {
        bookedIds.add(appointments[slot.id].id);
      }
    });

    const allSelected = bookedIds.size > 0 &&
      Array.from(bookedIds).every(id => selectedAppointmentIds.has(id));

    setSelectedAppointmentIds(prev => {
      const next = new Set(prev);
      bookedIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedAppointmentIds(new Set());

  // ── CRUD operations ────────────────────────────────────────────────

  const createTimeSlot = async ({ startTime, teremszam, userId }: CreateTimeSlotParams): Promise<boolean> => {
    const body: Record<string, unknown> = {
      startTime: toLocalISOString(startTime),
      cim: DEFAULT_CIM,
      teremszam: teremszam || null,
    };
    if (userId) body.userId = userId;

    try {
      const res = await fetch('/api/time-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (res.ok) {
        await loadTimeSlots();
        alert('Időpont sikeresen létrehozva!');
        return true;
      }
      const data = await res.json();
      alert(data.error || 'Hiba történt az időpont létrehozásakor');
      return false;
    } catch (error) {
      console.error('Error creating time slot:', error);
      alert('Hiba történt az időpont létrehozásakor');
      return false;
    }
  };

  const deleteTimeSlot = async (id: string): Promise<boolean> => {
    if (!confirm('Biztosan törölni szeretné ezt az időpontot?')) return false;

    try {
      const res = await fetch(`/api/time-slots/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        await loadTimeSlots();
        alert('Időpont sikeresen törölve!');
        return true;
      }
      const data = await res.json();
      alert(data.error || 'Hiba történt az időpont törlésekor');
      return false;
    } catch (error) {
      console.error('Error deleting time slot:', error);
      alert('Hiba történt az időpont törlésekor');
      return false;
    }
  };

  const cancelAppointment = async (appointmentId: string): Promise<boolean> => {
    if (!confirm('Biztosan le szeretné mondani ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) return false;

    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        await loadTimeSlots();
        alert('Időpont sikeresen lemondva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
        return true;
      }
      const data = await res.json();
      alert(data.error || 'Hiba történt az időpont lemondásakor');
      return false;
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      alert('Hiba történt az időpont lemondásakor');
      return false;
    }
  };

  const modifyAppointment = async (appointmentId: string, newTimeSlotId: string): Promise<boolean> => {
    if (!confirm('Biztosan módosítani szeretné ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) return false;

    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ timeSlotId: newTimeSlotId }),
      });

      if (res.ok) {
        await loadTimeSlots();
        alert('Időpont sikeresen módosítva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
        return true;
      }
      const data = await res.json();
      alert(data.error || 'Hiba történt az időpont módosításakor');
      return false;
    } catch (error) {
      console.error('Error modifying appointment:', error);
      alert('Hiba történt az időpont módosításakor');
      return false;
    }
  };

  const updateAppointmentType = async (
    appointmentId: string,
    type: AppointmentType | null,
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appointmentType: type }),
      });

      if (res.ok) {
        await loadTimeSlots();
        alert('Időpont típusa sikeresen módosítva!');
        return true;
      }
      const data = await res.json();
      alert(data.error || 'Hiba történt az időpont típusának módosításakor');
      return false;
    } catch (error) {
      console.error('Error updating appointment type:', error);
      alert('Hiba történt az időpont típusának módosításakor');
      return false;
    }
  };

  const bulkUpdateAppointmentType = async (
    appointmentIds: string[],
    type: AppointmentType | null,
  ): Promise<{ successCount: number; errorCount: number }> => {
    if (appointmentIds.length === 0) {
      alert('Kérjük, válasszon ki legalább egy időpontot!');
      return { successCount: 0, errorCount: 0 };
    }

    if (!confirm(`Biztosan módosítani szeretné ${appointmentIds.length} időpont típusát?`)) {
      return { successCount: 0, errorCount: 0 };
    }

    setIsBulkUpdating(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      await Promise.all(
        appointmentIds.map(async (id) => {
          try {
            const res = await fetch(`/api/appointments/${id}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ appointmentType: type }),
            });
            if (res.ok) {
              successCount++;
            } else {
              errorCount++;
              const data = await res.json();
              console.error(`Error updating appointment ${id}:`, data.error);
            }
          } catch (error) {
            errorCount++;
            console.error(`Error updating appointment ${id}:`, error);
          }
        }),
      );

      await loadTimeSlots();
      clearSelection();

      if (errorCount === 0) {
        alert(`${successCount} időpont típusa sikeresen módosítva!`);
      } else {
        alert(`${successCount} időpont sikeresen módosítva, ${errorCount} hiba történt.`);
      }
    } catch (error) {
      console.error('Error in bulk update:', error);
      alert('Hiba történt a tömeges módosítás során');
    } finally {
      setIsBulkUpdating(false);
    }

    return { successCount, errorCount };
  };

  // ── Public API ─────────────────────────────────────────────────────

  return {
    // Data
    timeSlots,
    appointments,
    loading,
    userRole,
    users,

    // Filtered / sorted / paginated results
    filteredAndSortedSlots,
    allFutureSlots,
    allPastSlots,
    futureSlots,
    pastSlots,
    futureTotalPages,
    pastTotalPages,
    availableFutureSlots,
    itemsPerPage: ITEMS_PER_PAGE,

    // Filter option values
    uniqueCims,
    uniqueTeremszamok,
    uniqueDentists,

    // Filters
    filterCim,
    filterTeremszam,
    filterDentistName,
    filterStatus,
    filterAppointmentType,
    setFilterCim,
    setFilterTeremszam,
    setFilterDentistName,
    setFilterStatus,
    setFilterAppointmentType,
    clearFilters,
    hasActiveFilters,

    // Sort
    sortField,
    sortDirection,
    handleSort,

    // Pagination
    currentPage,
    setCurrentPage,

    // Past slots toggle
    showPastSlots,
    setShowPastSlots,

    // Selection
    selectedAppointmentIds,
    toggleAppointmentSelection,
    selectAllAppointments,
    clearSelection,

    // CRUD
    createTimeSlot,
    deleteTimeSlot,
    cancelAppointment,
    modifyAppointment,
    updateAppointmentType,
    bulkUpdateAppointmentType,
    isBulkUpdating,

    // Reload
    refresh: loadTimeSlots,
  };
}
