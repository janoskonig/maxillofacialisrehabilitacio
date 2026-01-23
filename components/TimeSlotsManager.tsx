'use client';

import { useState, useEffect, useMemo } from 'react';
import { Calendar, Plus, Trash2, Edit2, Clock, X, ChevronDown, ChevronUp, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { DateTimePicker } from './DateTimePicker';
import { MobileTable } from './mobile/MobileTable';
import { MobileKeyValueGrid } from './mobile/MobileKeyValueGrid';
import { MobileBottomSheet } from './mobile/MobileBottomSheet';

interface TimeSlot {
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

interface AppointmentInfo {
  id: string; // Appointment ID
  patientName: string | null;
  patientTaj: string | null;
  bookedBy: string; // Email of surgeon/admin who booked
  appointmentType?: 'elso_konzultacio' | 'munkafazis' | 'kontroll' | null;
}

interface User {
  id: string;
  email: string;
  role: string;
}

export function TimeSlotsManager() {
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Record<string, AppointmentInfo>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  const [newStartTime, setNewStartTime] = useState<Date | null>(null);
  const [newTeremszam, setNewTeremszam] = useState<string>('');
  const [modifyingAppointment, setModifyingAppointment] = useState<{ appointmentId: string; timeSlotId: string; startTime: string } | null>(null);
  const [newTimeSlotId, setNewTimeSlotId] = useState<string>('');
  const [editingAppointmentType, setEditingAppointmentType] = useState<{ appointmentId: string; currentType: 'elso_konzultacio' | 'munkafazis' | 'kontroll' | null } | null>(null);
  const [newAppointmentType, setNewAppointmentType] = useState<'elso_konzultacio' | 'munkafazis' | 'kontroll' | null>(null);
  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<Set<string>>(new Set());
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkAppointmentType, setBulkAppointmentType] = useState<'elso_konzultacio' | 'munkafazis' | 'kontroll' | null>(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [showPastSlots, setShowPastSlots] = useState(false);
  const [sortField, setSortField] = useState<'startTime' | 'cim' | 'teremszam' | 'dentistName' | 'status' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterCim, setFilterCim] = useState<string>('');
  const [filterTeremszam, setFilterTeremszam] = useState<string>('');
  const [filterDentistName, setFilterDentistName] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'available' | 'booked'>('all');
  const [filterAppointmentType, setFilterAppointmentType] = useState<'all' | 'elso_konzultacio' | 'munkafazis' | 'kontroll' | null>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 50;

  useEffect(() => {
    loadTimeSlots();
    loadUserRole();
  }, []);

  const loadUserRole = async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        setUserRole(user.role);
        // If admin, load users list
        if (user.role === 'admin') {
          loadUsers();
        }
      }
    } catch (error) {
      console.error('Error loading user role:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/users', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadTimeSlots = async () => {
    try {
      setLoading(true);
      
      // Load all time slots paginated - no maximum limit, but with safety check
      let page = 1;
      let hasMore = true;
      const allTimeSlots: TimeSlot[] = [];
      const maxPages = 1000; // Biztonsági limit, hogy ne legyen végtelen ciklus
      const limit = 100; // Nagyobb limit, hogy kevesebb kérés legyen
      
      while (hasMore && page <= maxPages) {
        const timeSlotsResponse = await fetch(`/api/time-slots?page=${page}&limit=${limit}`, {
          credentials: 'include',
        });

        if (timeSlotsResponse.ok) {
          const timeSlotsData = await timeSlotsResponse.json();
          const pageTimeSlots = timeSlotsData.timeSlots || [];
          allTimeSlots.push(...pageTimeSlots);
          
          // Check if there are more pages
          const pagination = timeSlotsData.pagination;
          if (pagination) {
            if (page < pagination.totalPages && pageTimeSlots.length === limit) {
              page++;
            } else {
              hasMore = false;
            }
          } else if (pageTimeSlots.length < limit) {
            // Ha nincs pagináció info, de kevesebb elemet kaptunk, akkor vége
            hasMore = false;
          } else {
            // Ha nincs pagináció info, de limit elemet kaptunk, folytatjuk
            page++;
          }
        } else {
          console.error('Failed to load time slots');
          hasMore = false;
        }
      }
      
      // Get ALL time slots (both available and booked) for the current user
      setTimeSlots(allTimeSlots);

      // Load all appointments paginated - no maximum limit, but with safety check
      let appointmentsPage = 1;
      let hasMoreAppointments = true;
      const allAppointments: any[] = [];
      const maxAppointmentPages = 1000; // Biztonsági limit
      const appointmentLimit = 100; // Nagyobb limit
      
      while (hasMoreAppointments && appointmentsPage <= maxAppointmentPages) {
        const appointmentsResponse = await fetch(`/api/appointments?page=${appointmentsPage}&limit=${appointmentLimit}`, {
          credentials: 'include',
        });
        
        if (appointmentsResponse.ok) {
          const appointmentsData = await appointmentsResponse.json();
          const pageAppointments = appointmentsData.appointments || [];
          allAppointments.push(...pageAppointments);
          
          // Check if there are more pages
          const appointmentsPagination = appointmentsData.pagination;
          if (appointmentsPagination) {
            if (appointmentsPage < appointmentsPagination.totalPages && pageAppointments.length === appointmentLimit) {
              appointmentsPage++;
            } else {
              hasMoreAppointments = false;
            }
          } else if (pageAppointments.length < appointmentLimit) {
            // Ha nincs pagináció info, de kevesebb elemet kaptunk, akkor vége
            hasMoreAppointments = false;
          } else {
            // Ha nincs pagináció info, de limit elemet kaptunk, folytatjuk
            appointmentsPage++;
          }
        } else {
          hasMoreAppointments = false;
        }
      }
      
      // Create a map of timeSlotId -> appointment info
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

  const handleCreateTimeSlot = async () => {
    if (!newStartTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }

    // For admin, require user selection
    if (userRole === 'admin' && !selectedUserId) {
      alert('Kérjük, válasszon felhasználót!');
      return;
    }

    // Convert Date to ISO format with timezone offset
    // This ensures the server interprets the time correctly regardless of server timezone
    const offset = -newStartTime.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
    
    const year = newStartTime.getFullYear();
    const month = String(newStartTime.getMonth() + 1).padStart(2, '0');
    const day = String(newStartTime.getDate()).padStart(2, '0');
    const hours = String(newStartTime.getHours()).padStart(2, '0');
    const minutes = String(newStartTime.getMinutes()).padStart(2, '0');
    const seconds = String(newStartTime.getSeconds()).padStart(2, '0');
    const isoDateTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString}`;

    try {
      // Alapértelmezett cím: "1088 Budapest, Szentkirályi utca 47"
      const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
      const requestBody: any = { 
        startTime: isoDateTime,
        cim: DEFAULT_CIM,
        teremszam: newTeremszam || null
      };
      
      // If admin and user selected, include userId
      if (userRole === 'admin' && selectedUserId) {
        requestBody.userId = selectedUserId;
      }

      const response = await fetch('/api/time-slots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        await loadTimeSlots();
        setNewStartTime(null);
        setNewTeremszam('');
        setSelectedUserId('');
        setShowForm(false);
        alert('Időpont sikeresen létrehozva!');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont létrehozásakor');
      }
    } catch (error) {
      console.error('Error creating time slot:', error);
      alert('Hiba történt az időpont létrehozásakor');
    }
  };

  const handleDeleteTimeSlot = async (id: string) => {
    if (!confirm('Biztosan törölni szeretné ezt az időpontot?')) {
      return;
    }

    try {
      const response = await fetch(`/api/time-slots/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        await loadTimeSlots();
        alert('Időpont sikeresen törölve!');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont törlésekor');
      }
    } catch (error) {
      console.error('Error deleting time slot:', error);
      alert('Hiba történt az időpont törlésekor');
    }
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan le szeretné mondani ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        await loadTimeSlots();
        alert('Időpont sikeresen lemondva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont lemondásakor');
      }
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      alert('Hiba történt az időpont lemondásakor');
    }
  };

  const handleModifyAppointment = (appointmentId: string, timeSlotId: string, startTime: string) => {
    setModifyingAppointment({ appointmentId, timeSlotId, startTime });
    setNewTimeSlotId('');
  };

  const handleSaveModification = async () => {
    if (!modifyingAppointment || !newTimeSlotId) {
      alert('Kérjük, válasszon új időpontot!');
      return;
    }

    if (!confirm('Biztosan módosítani szeretné ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${modifyingAppointment.appointmentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          timeSlotId: newTimeSlotId,
        }),
      });

      if (response.ok) {
        await loadTimeSlots();
        setModifyingAppointment(null);
        setNewTimeSlotId('');
        alert('Időpont sikeresen módosítva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont módosításakor');
      }
    } catch (error) {
      console.error('Error modifying appointment:', error);
      alert('Hiba történt az időpont módosításakor');
    }
  };

  const handleEditAppointmentType = (appointmentId: string, currentType: 'elso_konzultacio' | 'munkafazis' | 'kontroll' | null) => {
    setEditingAppointmentType({ appointmentId, currentType });
    setNewAppointmentType(currentType);
  };

  const handleSaveAppointmentType = async () => {
    if (!editingAppointmentType) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${editingAppointmentType.appointmentId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          appointmentType: newAppointmentType,
        }),
      });

      if (response.ok) {
        await loadTimeSlots();
        setEditingAppointmentType(null);
        setNewAppointmentType(null);
        alert('Időpont típusa sikeresen módosítva!');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont típusának módosításakor');
      }
    } catch (error) {
      console.error('Error updating appointment type:', error);
      alert('Hiba történt az időpont típusának módosításakor');
    }
  };

  const handleToggleAppointmentSelection = (appointmentId: string) => {
    const newSelection = new Set(selectedAppointmentIds);
    if (newSelection.has(appointmentId)) {
      newSelection.delete(appointmentId);
    } else {
      newSelection.add(appointmentId);
    }
    setSelectedAppointmentIds(newSelection);
  };

  const handleSelectAllAppointments = (slots: TimeSlot[]) => {
    const allBookedAppointmentIds = new Set<string>();
    slots.forEach(slot => {
      if (slot.status === 'booked' && appointments[slot.id]) {
        allBookedAppointmentIds.add(appointments[slot.id].id);
      }
    });
    
    // Check if all visible appointments are selected
    const allSelected = allBookedAppointmentIds.size > 0 && 
                        Array.from(allBookedAppointmentIds).every(id => selectedAppointmentIds.has(id));
    
    if (allSelected) {
      // Deselect all visible
      const newSelection = new Set(selectedAppointmentIds);
      allBookedAppointmentIds.forEach(id => newSelection.delete(id));
      setSelectedAppointmentIds(newSelection);
    } else {
      // Select all visible
      const newSelection = new Set(selectedAppointmentIds);
      allBookedAppointmentIds.forEach(id => newSelection.add(id));
      setSelectedAppointmentIds(newSelection);
    }
  };

  const handleBulkUpdateAppointmentType = async () => {
    if (selectedAppointmentIds.size === 0) {
      alert('Kérjük, válasszon ki legalább egy időpontot!');
      return;
    }

    if (!confirm(`Biztosan módosítani szeretné ${selectedAppointmentIds.size} időpont típusát?`)) {
      return;
    }

    setIsBulkUpdating(true);
    const appointmentIdsArray = Array.from(selectedAppointmentIds);
    let successCount = 0;
    let errorCount = 0;

    try {
      // Update all selected appointments in parallel
      const updatePromises = appointmentIdsArray.map(async (appointmentId) => {
        try {
          const response = await fetch(`/api/appointments/${appointmentId}/status`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              appointmentType: bulkAppointmentType,
            }),
          });

          if (response.ok) {
            successCount++;
            return { success: true };
          } else {
            errorCount++;
            const data = await response.json();
            console.error(`Error updating appointment ${appointmentId}:`, data.error);
            return { success: false, error: data.error };
          }
        } catch (error) {
          errorCount++;
          console.error(`Error updating appointment ${appointmentId}:`, error);
          return { success: false, error: error };
        }
      });

      await Promise.all(updatePromises);

      // Reload data
      await loadTimeSlots();

      // Clear selection and close modal
      setSelectedAppointmentIds(new Set());
      setShowBulkEditModal(false);
      setBulkAppointmentType(null);

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
  };

  // Validálja a teremszám mezőt: csak számokat fogad el
  const validateTeremszam = (value: string): string => {
    // Csak számokat enged be, eltávolítja az összes nem szám karaktert
    const numbersOnly = value.replace(/[^0-9]/g, '');
    return numbersOnly;
  };

  const formatDateTime = (dateTime: string) => {
    const date = new Date(dateTime);
    return date.toLocaleString('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1); // At least 1 minute in the future
    return now.toISOString().slice(0, 16);
  };

  // Szűrés és rendezés - HOOKS SZABÁLY: minden hook a komponens tetején, early return előtt
  const filteredAndSortedSlots = useMemo(() => {
    let filtered = [...timeSlots];
    
    // Szűrés legördülő menükkel
    if (filterCim) {
      filtered = filtered.filter(slot => {
        const slotCim = (slot.cim || '1088 Budapest, Szentkirályi utca 47').toLowerCase();
        return slotCim === filterCim.toLowerCase();
      });
    }
    
    if (filterTeremszam) {
      filtered = filtered.filter(slot => {
        const slotTerem = (slot.teremszam || '').toLowerCase();
        return slotTerem === filterTeremszam.toLowerCase();
      });
    }
    
    if (filterDentistName) {
      filtered = filtered.filter(slot => {
        const slotDentist = (slot.dentistName || slot.userEmail || '').toLowerCase();
        return slotDentist === filterDentistName.toLowerCase();
      });
    }
    
    if (filterStatus !== 'all') {
      filtered = filtered.filter(slot => slot.status === filterStatus);
    }
    
    // Szűrés időpont típusra (csak booked slotoknál)
    if (filterAppointmentType !== 'all') {
      filtered = filtered.filter(slot => {
        // Ha szabad slot, akkor csak akkor mutatjuk, ha "Nincs típus" van kiválasztva
        if (slot.status !== 'booked') {
          return filterAppointmentType === null;
        }
        
        // Ha booked slot, akkor az appointment type alapján szűrünk
        const appointment = appointments[slot.id];
        if (!appointment) {
          // Ha nincs appointment adat, akkor "Nincs típus"-nak számít
          return filterAppointmentType === null;
        }
        
        // Ha "Nincs típus" van kiválasztva, akkor csak azokat mutatjuk, ahol nincs appointment type
        if (filterAppointmentType === null) {
          return !appointment.appointmentType;
        }
        
        // Egyébként csak azokat, ahol az appointment type megegyezik
        return appointment.appointmentType === filterAppointmentType;
      });
    }
    
    // Rendezés
    if (sortField) {
      filtered.sort((a, b) => {
        let comparison = 0;
        
        switch (sortField) {
          case 'startTime':
            comparison = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            break;
          case 'cim':
            const cimA = (a.cim || '1088 Budapest, Szentkirályi utca 47').toLowerCase();
            const cimB = (b.cim || '1088 Budapest, Szentkirályi utca 47').toLowerCase();
            comparison = cimA.localeCompare(cimB, 'hu');
            break;
          case 'teremszam':
            const teremA = (a.teremszam || '').toLowerCase();
            const teremB = (b.teremszam || '').toLowerCase();
            comparison = teremA.localeCompare(teremB, 'hu');
            break;
          case 'dentistName':
            const dentistA = (a.dentistName || a.userEmail || '').toLowerCase();
            const dentistB = (b.dentistName || b.userEmail || '').toLowerCase();
            comparison = dentistA.localeCompare(dentistB, 'hu');
            break;
          case 'status':
            const statusA = a.status === 'available' ? 0 : 1;
            const statusB = b.status === 'available' ? 0 : 1;
            comparison = statusA - statusB;
            break;
        }
        
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }
    
    return filtered;
  }, [timeSlots, filterCim, filterTeremszam, filterDentistName, filterStatus, filterAppointmentType, appointments, sortField, sortDirection]);
  
  // Pagináció - most már nem használjuk közvetlenül, mert külön pagináljuk a jövőbeli és elmúlt időpontokat
  
  // Egyedi értékek a szűrőkhöz
  const uniqueCims = useMemo(() => {
    const cims = new Set<string>();
    timeSlots.forEach(slot => {
      const cim = slot.cim || '1088 Budapest, Szentkirályi utca 47';
      cims.add(cim);
    });
    return Array.from(cims).sort();
  }, [timeSlots]);
  
  const uniqueTeremszamok = useMemo(() => {
    const teremszamok = new Set<string>();
    timeSlots.forEach(slot => {
      if (slot.teremszam) {
        teremszamok.add(slot.teremszam);
      }
    });
    return Array.from(teremszamok).sort();
  }, [timeSlots]);
  
  const uniqueDentists = useMemo(() => {
    const dentists = new Set<string>();
    timeSlots.forEach(slot => {
      const dentist = slot.dentistName || slot.userEmail || '';
      if (dentist) {
        dentists.add(dentist);
      }
    });
    return Array.from(dentists).sort();
  }, [timeSlots]);
  
  // Szétválasztjuk a jövőbeli és elmúlt időpontokat (SZŰRÉS UTÁN, de PAGINÁCIÓ ELŐTT)
  // 4 órás késleltetés: ne vedd elmúlt időpontnak 4 óráig
  const now = new Date();
  const fourHoursBeforeNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const allFutureSlots = filteredAndSortedSlots.filter(slot => new Date(slot.startTime) >= fourHoursBeforeNow);
  const allPastSlots = filteredAndSortedSlots.filter(slot => new Date(slot.startTime) < fourHoursBeforeNow);
  
  // Automatikusan mutassuk az elmúlt időpontokat, ha nincs jövőbeli
  useEffect(() => {
    if (allFutureSlots.length === 0 && allPastSlots.length > 0) {
      setShowPastSlots(true);
    }
  }, [allFutureSlots.length, allPastSlots.length]);
  
  // Pagináció külön a jövőbeli és elmúlt időpontokra
  const futureTotalPages = Math.ceil(allFutureSlots.length / itemsPerPage);
  const futureStartIndex = (currentPage - 1) * itemsPerPage;
  const futureEndIndex = futureStartIndex + itemsPerPage;
  const futureSlots = allFutureSlots.slice(futureStartIndex, futureEndIndex);
  
  const pastTotalPages = Math.ceil(allPastSlots.length / itemsPerPage);
  const pastStartIndex = (currentPage - 1) * itemsPerPage;
  const pastEndIndex = pastStartIndex + itemsPerPage;
  const pastSlots = allPastSlots.slice(pastStartIndex, pastEndIndex);

  const availableSlotsForModification = filteredAndSortedSlots.filter(
    slot => {
      const slotDate = new Date(slot.startTime);
      return slot.status === 'available' 
        && slotDate >= fourHoursBeforeNow
        && (!modifyingAppointment || slot.id !== modifyingAppointment.timeSlotId);
    }
  );

  const handleSort = (field: 'startTime' | 'cim' | 'teremszam' | 'dentistName' | 'status') => {
    if (sortField === field) {
      // Ha ugyanaz a mező, fordítjuk a rendezési irányt
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Ha új mező, alapértelmezetten növekvő
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortableHeader = (label: string, field: 'startTime' | 'cim' | 'teremszam' | 'dentistName' | 'status', className?: string) => {
    const isActive = sortField === field;
    const SortIcon = isActive 
      ? (sortDirection === 'asc' ? ArrowUp : ArrowDown)
      : null;
    
    return (
      <th 
        className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none ${
          isActive ? 'bg-gray-100' : ''
        } ${className || ''}`}
        onClick={() => handleSort(field)}
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

  if (loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  const renderTimeSlotTable = (slots: TimeSlot[], isPast: boolean = false) => {
    if (slots.length === 0) {
      return null;
    }

    const bookedSlotsInTable = slots.filter(s => s.status === 'booked' && appointments[s.id]);
    const allSelected = bookedSlotsInTable.length > 0 && 
                        bookedSlotsInTable.every(s => selectedAppointmentIds.has(appointments[s.id].id));

    // Desktop table header
    const renderTableHeader = () => (
      <>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">
          {bookedSlotsInTable.length > 0 && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => handleSelectAllAppointments(slots)}
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

    // Desktop table row
    const renderTableRow = (slot: TimeSlot) => {
      const appointment = appointments[slot.id];
      return (
        <>
          <td className="px-4 py-4 whitespace-nowrap">
            {slot.status === 'booked' && appointment ? (
              <input
                type="checkbox"
                checked={selectedAppointmentIds.has(appointment.id)}
                onChange={() => handleToggleAppointmentSelection(appointment.id)}
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
                  onClick={() => handleDeleteTimeSlot(slot.id)}
                  className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-red-600 hover:text-red-900'} mobile-touch-target`}
                  title="Törlés"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {slot.status === 'booked' && appointment && (
                <>
                  <button
                    onClick={() => handleEditAppointmentType(appointment.id, appointment.appointmentType || null)}
                    className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-blue-600 hover:text-blue-900'} flex items-center gap-1 text-xs mobile-touch-target`}
                    title="Időpont típusa módosítása"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span className="hidden sm:inline">Típus</span>
                  </button>
                  <button
                    onClick={() => handleModifyAppointment(appointment.id, slot.id, slot.startTime)}
                    className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-amber-600 hover:text-amber-900'} flex items-center gap-1 mobile-touch-target`}
                    title="Időpont módosítása"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Módosítás</span>
                  </button>
                  <button
                    onClick={() => handleCancelAppointment(appointment.id)}
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

    // Mobile card
    const renderMobileCard = (slot: TimeSlot) => {
      const appointment = appointments[slot.id];
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
          {/* Top row: Időpont + Státusz */}
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

          {/* Middle: Key-value sorok */}
          <MobileKeyValueGrid
            items={[
              { key: 'Cím', value: slot.cim || '1088 Budapest, Szentkirályi utca 47' },
              { key: 'Teremszám', value: slot.teremszam || '-' },
              { key: 'Fogpótlástanász', value: slot.dentistName || slot.userEmail || '-' },
            ]}
            className="mb-3"
          />

          {/* Appointment info */}
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

          {/* Bottom: Actions */}
          <div className="pt-3 border-t border-gray-200 flex flex-col gap-2">
            {slot.status === 'available' && (
              <button
                onClick={() => handleDeleteTimeSlot(slot.id)}
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
                  onClick={() => handleEditAppointmentType(appointment.id, appointment.appointmentType || null)}
                  className={`w-full btn-secondary flex items-center justify-center gap-2 mobile-touch-target ${
                    isPast ? 'text-gray-500' : 'text-blue-600'
                  }`}
                >
                  <Edit2 className="w-4 h-4" />
                  Típus módosítása
                </button>
                <button
                  onClick={() => handleModifyAppointment(appointment.id, slot.id, slot.startTime)}
                  className={`w-full btn-secondary flex items-center justify-center gap-2 mobile-touch-target ${
                    isPast ? 'text-gray-500' : 'text-amber-600'
                  }`}
                >
                  <Edit2 className="w-4 h-4" />
                  Időpont módosítása
                </button>
                <button
                  onClick={() => handleCancelAppointment(appointment.id)}
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

    // Row className
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
                  <strong>{selectedAppointmentIds.size} időpont</strong> kijelölve
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Időpont típusa
                </label>
                <select
                  value={bulkAppointmentType || ''}
                  onChange={(e) => setBulkAppointmentType(e.target.value as any || null)}
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
                  disabled={isBulkUpdating}
                >
                  Mégse
                </button>
                <button
                  onClick={handleBulkUpdateAppointmentType}
                  disabled={isBulkUpdating}
                  className="btn-primary"
                >
                  {isBulkUpdating ? 'Módosítás...' : `Módosítás (${selectedAppointmentIds.size})`}
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
                  onChange={(e) => setNewAppointmentType(e.target.value as any || null)}
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
            value={filterCim}
            onChange={(e) => {
              setFilterCim(e.target.value);
              setCurrentPage(1); // Reset to first page when filter changes
            }}
            className="form-input w-full"
          >
            <option value="">Összes cím</option>
            {uniqueCims.map(cim => (
              <option key={cim} value={cim}>{cim}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Teremszám
          </label>
          <select
            value={filterTeremszam}
            onChange={(e) => {
              setFilterTeremszam(e.target.value);
              setCurrentPage(1);
            }}
            className="form-input w-full"
          >
            <option value="">Összes terem</option>
            {uniqueTeremszamok.map(terem => (
              <option key={terem} value={terem}>{terem}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Fogpótlástanász
          </label>
          <select
            value={filterDentistName}
            onChange={(e) => {
              setFilterDentistName(e.target.value);
              setCurrentPage(1);
            }}
            className="form-input w-full"
          >
            <option value="">Összes fogpótlástanász</option>
            {uniqueDentists.map(dentist => (
              <option key={dentist} value={dentist}>{dentist}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Státusz
          </label>
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value as 'all' | 'available' | 'booked');
              setCurrentPage(1);
            }}
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
            value={filterAppointmentType === null ? 'null' : filterAppointmentType}
            onChange={(e) => {
              const value = e.target.value;
              setFilterAppointmentType(
                value === 'all' ? 'all' : 
                value === 'null' ? null : 
                value as 'elso_konzultacio' | 'munkafazis' | 'kontroll'
              );
              setCurrentPage(1);
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
          Összesen: {filteredAndSortedSlots.length} időpont
          {filteredAndSortedSlots.length !== timeSlots.length && (
            <span> (szűrve: {timeSlots.length} összesből)</span>
          )}
        </div>
        {(filterCim || filterTeremszam || filterDentistName || filterStatus !== 'all' || filterAppointmentType !== 'all') && (
          <button
            onClick={() => {
              setFilterCim('');
              setFilterTeremszam('');
              setFilterDentistName('');
              setFilterStatus('all');
              setFilterAppointmentType('all');
              setCurrentPage(1);
            }}
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
            {userRole === 'admin' && (
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
                  {users.map((user) => (
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
                  onChange={(e) => setNewTeremszam(validateTeremszam(e.target.value))}
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
      {(allFutureSlots.length > 0 || allPastSlots.length === 0) && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-semibold">Jövőbeli időpontok</h4>
            {selectedAppointmentIds.size > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">
                  {selectedAppointmentIds.size} időpont kijelölve
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
                  onClick={() => setSelectedAppointmentIds(new Set())}
                  className="btn-secondary text-sm"
                >
                  Kijelölés törlése
                </button>
              </div>
            )}
          </div>
          {futureSlots.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Nincs jövőbeli időpont.</p>
            </div>
          ) : (
            renderTimeSlotTable(futureSlots, false)
          )}
        </div>
      )}

      {/* Elmúlt időpontok */}
      {allPastSlots.length > 0 && (
        <div className="card">
          <button
            onClick={() => setShowPastSlots(!showPastSlots)}
            className="flex items-center justify-between w-full mb-4 text-left"
          >
            <h4 className="text-lg font-semibold text-gray-600">
              Elmúlt időpontok ({allPastSlots.length})
            </h4>
            {showPastSlots ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          {showPastSlots && (
            <>
              {pastSlots.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">Nincs elmúlt időpont ezen az oldalon.</p>
                </div>
              ) : (
                renderTimeSlotTable(pastSlots, true)
              )}
              {/* Pagináció elmúlt időpontokhoz */}
              {pastTotalPages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    Oldal {currentPage} / {pastTotalPages} (összesen {allPastSlots.length} elmúlt időpont)
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        currentPage === 1
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                      }`}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, pastTotalPages) }, (_, i) => {
                        let pageNum: number;
                        if (pastTotalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= pastTotalPages - 2) {
                          pageNum = pastTotalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`px-3 py-2 rounded-md text-sm font-medium ${
                              currentPage === pageNum
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
                      onClick={() => setCurrentPage(prev => Math.min(pastTotalPages, prev + 1))}
                      disabled={currentPage === pastTotalPages}
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        currentPage === pastTotalPages
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
      {futureTotalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Oldal {currentPage} / {futureTotalPages} (összesen {allFutureSlots.length} jövőbeli időpont)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                currentPage === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, futureTotalPages) }, (_, i) => {
                let pageNum: number;
                if (futureTotalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= futureTotalPages - 2) {
                  pageNum = futureTotalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-2 rounded-md text-sm font-medium ${
                      currentPage === pageNum
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
              onClick={() => setCurrentPage(prev => Math.min(futureTotalPages, prev + 1))}
              disabled={currentPage === futureTotalPages}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                currentPage === futureTotalPages
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {timeSlots.length === 0 && (
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

