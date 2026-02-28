'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, ChevronDown, ChevronUp, AlertCircle, Bug, Lightbulb, Mail, Send, ArrowUp, ArrowDown, User, LogIn, Search, UserCircle } from 'lucide-react';

type UserRole = 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  restricted_view: boolean;
  intezmeny: string | null;
  hozzaferes_indokolas: string | null;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  last_activity: string | null;
  last_activity_action: string | null;
  last_activity_detail: string | null;
};

type Feedback = {
  id: string;
  user_email: string | null;
  type: 'bug' | 'error' | 'crash' | 'suggestion' | 'other';
  title: string | null;
  description: string;
  error_log: string | null;
  error_stack: string | null;
  user_agent: string | null;
  url: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  created_at: string;
  updated_at: string;
};

export function UserManagementTab() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usage, setUsage] = useState<Array<{ user_email: string; last_seen: string | null; last_7d: number; last_30d: number; last_90d: number }>>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState('');
  const [expandedFeedback, setExpandedFeedback] = useState<Set<string>>(new Set());

  const [selectedUserId, setSelectedUserId] = useState('');
  const [impersonating, setImpersonating] = useState(false);

  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patients, setPatients] = useState<Array<{ id: string; nev: string; taj: string | null; email: string | null }>>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [impersonatingPatient, setImpersonatingPatient] = useState(false);

  const [emailRoles, setEmailRoles] = useState<string[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailContent, setEmailContent] = useState('');
  const [emailPreview, setEmailPreview] = useState<Array<{ email: string; name: string; role: string }>>([]);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailPreviewData, setEmailPreviewData] = useState<{
    users: Array<{ email: string; name: string; role: string }>;
    includeAdmins: boolean;
    adminCount: number;
  } | null>(null);

  const [userSortField, setUserSortField] = useState<'email' | 'role' | 'last_activity' | null>(null);
  const [userSortDirection, setUserSortDirection] = useState<'asc' | 'desc'>('asc');

  const sortedUsers = useMemo(() => {
    const activeUsers = users.filter((u) => u.active);
    if (!userSortField) return activeUsers;
    return [...activeUsers].sort((a, b) => {
      let comparison = 0;
      switch (userSortField) {
        case 'email': comparison = a.email.localeCompare(b.email, 'hu'); break;
        case 'role': comparison = a.role.localeCompare(b.role, 'hu'); break;
        case 'last_activity': {
          const dateA = a.last_activity ? new Date(a.last_activity).getTime() : 0;
          const dateB = b.last_activity ? new Date(b.last_activity).getTime() : 0;
          comparison = dateA - dateB;
          break;
        }
      }
      return userSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [users, userSortField, userSortDirection]);

  const handleUserSort = (field: 'email' | 'role' | 'last_activity') => {
    if (userSortField === field) {
      setUserSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setUserSortField(field);
      setUserSortDirection('asc');
    }
  };

  const renderSortableHeader = (label: string, field: 'email' | 'role' | 'last_activity') => {
    const isActive = userSortField === field;
    const SortIcon = isActive ? (userSortDirection === 'asc' ? ArrowUp : ArrowDown) : null;
    return (
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleUserSort(field)}>
        <div className="flex items-center gap-1">
          <span>{label}</span>
          {SortIcon && <SortIcon className="w-3 h-3 text-blue-600" />}
        </div>
      </th>
    );
  };

  useEffect(() => {
    (async () => {
      setUsersLoading(true);
      try {
        const res = await fetch('/api/users', { credentials: 'include' });
        if (res.ok) { const data = await res.json(); setUsers(data.users || []); }
      } catch { /* ignore */ } finally { setUsersLoading(false); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setUsageLoading(true);
      try {
        const res = await fetch('/api/activity', { credentials: 'include' });
        const data = await res.json();
        setUsage(data.summary || []);
      } catch { setUsage([]); } finally { setUsageLoading(false); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setFeedbackLoading(true);
      try {
        const url = feedbackStatusFilter ? `/api/feedback?status=${feedbackStatusFilter}` : '/api/feedback';
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) { const data = await res.json(); setFeedback(data.feedback || []); }
      } catch { setFeedback([]); } finally { setFeedbackLoading(false); }
    })();
  }, [feedbackStatusFilter]);

  const updateRole = async (userId: string, role: UserRole) => {
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ role }) });
      if (res.ok) { setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u)); } else { const data = await res.json(); alert(data.error || 'Hiba'); }
    } catch { alert('Hiba történt a szerepkör frissítésekor'); }
  };

  const approveUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ active: true }) });
      if (res.ok) {
        const res2 = await fetch('/api/users', { credentials: 'include' });
        if (res2.ok) { const data = await res2.json(); setUsers(data.users || []); }
      } else { const data = await res.json(); alert(data.error || 'Hiba'); }
    } catch { alert('Hiba történt a jóváhagyáskor'); }
  };

  const rejectUser = async (userId: string) => {
    if (!confirm('Biztosan törölni szeretné ezt a felhasználót?')) return;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { setUsers(prev => prev.filter(u => u.id !== userId)); } else { const data = await res.json(); alert(data.error || 'Hiba'); }
    } catch { alert('Hiba történt a törléskor'); }
  };

  const updateFeedbackStatus = async (feedbackId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/feedback/${feedbackId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: newStatus }) });
      if (res.ok) { setFeedback(prev => prev.map(f => f.id === feedbackId ? { ...f, status: newStatus as Feedback['status'], updated_at: new Date().toISOString() } : f)); }
    } catch { alert('Hiba történt a status frissítésekor'); }
  };

  useEffect(() => {
    if (emailRoles.length === 0) { setEmailPreview([]); setEmailPreviewData(null); return; }
    const timer = setTimeout(async () => {
      setEmailPreviewLoading(true);
      setEmailError(null);
      try {
        const res = await fetch(`/api/users/send-email?roles=${encodeURIComponent(emailRoles.join(','))}`, { credentials: 'include' });
        if (res.ok) { const data = await res.json(); setEmailPreview(data.users || []); setEmailPreviewData({ users: data.users || [], includeAdmins: data.includeAdmins || false, adminCount: data.adminCount || 0 }); }
        else { setEmailPreview([]); setEmailPreviewData(null); }
      } catch { setEmailPreview([]); setEmailPreviewData(null); } finally { setEmailPreviewLoading(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [emailRoles]);

  const sendEmailToUsers = async () => {
    if (emailRoles.length === 0) { setEmailError('Válasszon ki legalább egy szerepkört'); return; }
    if (!emailSubject.trim()) { setEmailError('Az e-mail tárgyának megadása kötelező'); return; }
    if (!emailContent.trim()) { setEmailError('Az e-mail tartalmának megadása kötelező'); return; }
    setEmailSending(true); setEmailError(null); setEmailSuccess(null);
    try {
      const res = await fetch('/api/users/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ roles: emailRoles, subject: emailSubject, html: emailContent.replace(/\n/g, '<br>'), text: emailContent }) });
      if (res.ok) { const data = await res.json(); setEmailSuccess(data.message || 'E-mail sikeresen elküldve'); setEmailSubject(''); setEmailContent(''); setEmailRoles([]); setEmailPreview([]); setEmailPreviewData(null); }
      else { const data = await res.json(); setEmailError(data.error || 'Hiba'); }
    } catch { setEmailError('Hiba történt az e-mail küldésekor'); } finally { setEmailSending(false); }
  };

  const handleImpersonate = async () => {
    if (!selectedUserId) return;
    const selectedUser = users.find(u => u.id === selectedUserId);
    if (!selectedUser || !confirm(`Biztosan be szeretne lépni mint: ${selectedUser.email}?`)) return;
    setImpersonating(true);
    try {
      const res = await fetch('/api/auth/impersonate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId: selectedUserId }) });
      if (res.ok) { router.push('/'); } else { const data = await res.json(); alert(data.error || 'Hiba'); }
    } catch { alert('Hiba történt a bejelentkezéskor'); } finally { setImpersonating(false); }
  };

  useEffect(() => {
    if (!patientSearchQuery.trim()) { setPatients([]); return; }
    const timer = setTimeout(async () => {
      setPatientsLoading(true);
      try {
        const res = await fetch(`/api/patients?q=${encodeURIComponent(patientSearchQuery)}`, { credentials: 'include' });
        if (res.ok) { const data = await res.json(); setPatients((data.patients || []).slice(0, 20)); } else { setPatients([]); }
      } catch { setPatients([]); } finally { setPatientsLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearchQuery]);

  const handleImpersonatePatient = async () => {
    if (!selectedPatientId) return;
    const selectedPatient = patients.find(p => p.id === selectedPatientId);
    if (!selectedPatient || !confirm(`Biztosan be szeretne lépni mint: ${selectedPatient.nev}?`)) return;
    setImpersonatingPatient(true);
    try {
      const res = await fetch('/api/patient-portal/auth/impersonate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ patientId: selectedPatientId }) });
      if (res.ok) { const data = await res.json(); window.location.href = data.redirectUrl || '/patient-portal/dashboard'; }
      else { const data = await res.json(); alert(data.error || 'Hiba'); }
    } catch { alert('Hiba történt a bejelentkezéskor'); } finally { setImpersonatingPatient(false); }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'bug': return <Bug className="w-4 h-4" />;
      case 'error': case 'crash': return <AlertCircle className="w-4 h-4" />;
      case 'suggestion': return <Lightbulb className="w-4 h-4" />;
      default: return <MessageCircle className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-yellow-100 text-yellow-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'resolved': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const ACTIVITY_LABELS: Record<string, string> = {
    login: 'Bejelentkezés', heartbeat: 'Oldal megtekintés', patient_created: 'Beteg létrehozása',
    patient_updated: 'Beteg módosítása', patient_deleted: 'Beteg törlése', patient_viewed: 'Beteg megtekintése',
    register: 'Regisztráció', password_change: 'Jelszó változtatás',
  };

  return (
    <>
      {/* Impersonate user */}
      <div className="card mb-6 border-l-4 border-blue-500">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl font-semibold">Belépés mint másik felhasználó</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">Válasszon felhasználót</label>
            <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="form-input w-full" disabled={impersonating}>
              <option value="">-- Válasszon felhasználót --</option>
              {users.filter(u => u.active).map(user => (<option key={user.id} value={user.id}>{user.email} ({user.role})</option>))}
            </select>
          </div>
          <div className="pt-6">
            <button onClick={handleImpersonate} disabled={!selectedUserId || impersonating} className="btn-primary flex items-center gap-2">
              {impersonating ? <><span className="animate-spin">⏳</span>Belépés...</> : <><LogIn className="w-4 h-4" />Belépés mint...</>}
            </button>
          </div>
        </div>
      </div>

      {/* Impersonate patient */}
      <div className="card mb-6 border-l-4 border-purple-500">
        <div className="flex items-center gap-2 mb-4">
          <UserCircle className="w-5 h-5 text-purple-600" />
          <h2 className="text-xl font-semibold">Belépés mint beteg</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Beteg keresése (név, TAJ, email)</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={patientSearchQuery} onChange={e => setPatientSearchQuery(e.target.value)} placeholder="Kezdjen el gépelni..." className="form-input w-full pl-10" disabled={impersonatingPatient} />
            </div>
          </div>
          {patientsLoading && <div className="text-sm text-gray-600">Keresés...</div>}
          {!patientsLoading && patientSearchQuery.trim() && patients.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Válasszon beteget</label>
              <select value={selectedPatientId} onChange={e => setSelectedPatientId(e.target.value)} className="form-input w-full" disabled={impersonatingPatient}>
                <option value="">-- Válasszon beteget --</option>
                {patients.map(p => (<option key={p.id} value={p.id}>{p.nev} {p.taj ? `(TAJ: ${p.taj})` : ''} {p.email ? `[${p.email}]` : ''}</option>))}
              </select>
            </div>
          )}
          {!patientsLoading && patientSearchQuery.trim() && patients.length === 0 && <div className="text-sm text-gray-600">Nincs találat</div>}
          <div className="flex justify-end">
            <button onClick={handleImpersonatePatient} disabled={!selectedPatientId || impersonatingPatient} className="btn-primary flex items-center gap-2">
              {impersonatingPatient ? <><span className="animate-spin">⏳</span>Belépés...</> : <><UserCircle className="w-4 h-4" />Belépés betegként</>}
            </button>
          </div>
        </div>
      </div>

      {/* Pending users */}
      {users.filter(u => !u.active).length > 0 && (
        <div className="card mb-6 border-l-4 border-yellow-400">
          <h2 className="text-xl font-semibold mb-4 text-yellow-800">Jóváhagyásra váró felhasználók ({users.filter(u => !u.active).length})</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Intézmény</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Indokolás</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Regisztráció</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th></tr></thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.filter(u => !u.active).map(user => (
                  <tr key={user.id} className="bg-yellow-50">
                    <td className="px-4 py-3 text-sm text-gray-900">{user.email}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{user.intezmeny || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-md"><div className="truncate" title={user.hozzaferes_indokolas || ''}>{user.hozzaferes_indokolas || '-'}</div></td>
                    <td className="px-4 py-3 text-sm text-gray-700">{user.created_at ? new Date(user.created_at).toLocaleString('hu-HU') : '-'}</td>
                    <td className="px-4 py-3"><div className="flex gap-2"><button onClick={() => approveUser(user.id)} className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700">Jóváhagyás</button><button onClick={() => rejectUser(user.id)} className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700">Elutasítás</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User table */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Felhasználók kezelése</h2>
        {usersLoading ? (<p className="text-gray-600">Betöltés...</p>) : users.length === 0 ? (<p className="text-gray-600">Nincsenek felhasználók.</p>) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50"><tr>{renderSortableHeader('Email', 'email')}{renderSortableHeader('Szerepkör', 'role')}<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Állapot</th>{renderSortableHeader('Utolsó aktivitás', 'last_activity')}</tr></thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedUsers.map(user => (
                  <tr key={user.id}>
                    <td className="px-4 py-3 text-sm text-gray-900">{user.email}</td>
                    <td className="px-4 py-3">
                      <select className="form-input" value={user.role} onChange={e => updateRole(user.id, e.target.value as UserRole)}>
                        <option value="admin">admin</option><option value="fogpótlástanász">fogpótlástanász</option><option value="technikus">technikus</option><option value="sebészorvos">sebészorvos</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm">{user.active ? <span className="text-green-600">Aktív</span> : <span className="text-red-600">Inaktív</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {user.last_activity ? (<div><div className="font-medium">{ACTIVITY_LABELS[user.last_activity_action || ''] || user.last_activity_action || 'Ismeretlen'}</div>{user.last_activity_detail && <div className="text-xs text-gray-500 mt-1">{user.last_activity_detail}</div>}<div className="text-xs text-gray-400 mt-1">{new Date(user.last_activity).toLocaleString('hu-HU')}</div></div>) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Email sending */}
      <div className="card mt-6">
        <div className="flex items-center gap-2 mb-4"><Mail className="w-5 h-5 text-medical-primary" /><h2 className="text-xl font-semibold">E-mail küldés felhasználóknak</h2></div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Szerepkörök (több választható)</label>
          <div className="flex flex-wrap gap-3">
            {['sebészorvos', 'fogpótlástanász', 'technikus', 'admin'].map(role => (
              <label key={role} className="flex items-center">
                <input type="checkbox" checked={emailRoles.includes(role)} onChange={e => { if (e.target.checked) setEmailRoles([...emailRoles, role]); else setEmailRoles(emailRoles.filter(r => r !== role)); }} className="mr-2 h-4 w-4 text-medical-primary focus:ring-medical-primary border-gray-300 rounded" />
                <span className="text-sm text-gray-700">{role === 'sebészorvos' ? 'Sebészorvos' : role === 'fogpótlástanász' ? 'Fogpótlástanász' : role === 'technikus' ? 'Technikus' : 'Adminisztrátor'}</span>
              </label>
            ))}
          </div>
        </div>
        {emailPreviewLoading ? <div className="mb-4 text-sm text-gray-600">Előnézet betöltése...</div> : emailPreview.length > 0 ? (
          <div className="mb-4 space-y-3">
            <div className="p-3 bg-blue-50 rounded border border-blue-200"><p className="text-sm font-medium text-blue-900 mb-2">Címzettek ({emailPreview.length}):</p><div className="text-sm text-blue-800 space-y-1 max-h-32 overflow-y-auto">{emailPreview.map((u, i) => <div key={i} className="flex items-center gap-2"><span className="font-medium">{u.name}</span><span className="text-blue-600">({u.email})</span><span className="text-xs text-blue-500">- {u.role}</span></div>)}</div></div>
            {emailPreviewData?.includeAdmins && emailPreviewData.adminCount > 0 && <div className="p-3 bg-green-50 rounded border border-green-200"><p className="text-sm font-medium text-green-900">Admin felhasználók automatikusan kapják másolatként ({emailPreviewData.adminCount})</p></div>}
          </div>
        ) : emailRoles.length > 0 ? <div className="mb-4 p-3 bg-yellow-50 rounded border border-yellow-200"><p className="text-sm text-yellow-800">Nem található aktív felhasználó.</p></div> : null}
        <div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-2">E-mail tárgya</label><input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Pl: Fontos értesítés" className="form-input w-full" /></div>
        <div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-2">E-mail tartalma</label><textarea value={emailContent} onChange={e => setEmailContent(e.target.value)} placeholder="Írja be az e-mail tartalmát..." rows={8} className="form-input w-full" /><p className="text-xs text-gray-500 mt-1">A sortörések automatikusan bekerülnek.</p></div>
        {emailError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded"><p className="text-sm text-red-800">{emailError}</p></div>}
        {emailSuccess && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded"><p className="text-sm text-green-800">{emailSuccess}</p></div>}
        <div className="flex justify-end gap-3">
          <button onClick={() => { setEmailSubject(''); setEmailContent(''); setEmailRoles([]); setEmailPreview([]); setEmailPreviewData(null); setEmailError(null); setEmailSuccess(null); }} className="btn-secondary" disabled={emailSending}>Törlés</button>
          <button onClick={sendEmailToUsers} disabled={emailSending || emailRoles.length === 0 || !emailSubject.trim() || !emailContent.trim()} className="btn-primary flex items-center gap-2">
            {emailSending ? <><span className="animate-spin">⏳</span>Küldés...</> : <><Send className="w-4 h-4" />E-mail küldése</>}
          </button>
        </div>
      </div>

      {/* Usage stats */}
      <div className="card mt-6">
        <h2 className="text-xl font-semibold mb-4">Használati statisztika</h2>
        {usageLoading ? <p className="text-gray-600">Betöltés...</p> : usage.length === 0 ? <p className="text-gray-600">Még nincs adat.</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Felhasználó</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Utoljára</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">7 nap</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">30 nap</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">90 nap</th></tr></thead>
              <tbody className="bg-white divide-y divide-gray-200">{usage.map(row => (<tr key={row.user_email}><td className="px-4 py-3 text-sm text-gray-900">{row.user_email}</td><td className="px-4 py-3 text-sm text-gray-700">{row.last_seen ? new Date(row.last_seen).toLocaleString() : '-'}</td><td className="px-4 py-3 text-sm text-gray-700">{row.last_7d}</td><td className="px-4 py-3 text-sm text-gray-700">{row.last_30d}</td><td className="px-4 py-3 text-sm text-gray-700">{row.last_90d}</td></tr>))}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Feedback log */}
      <div className="card mt-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Visszajelzések napló</h2>
          <div className="flex items-center gap-2"><label className="text-sm text-gray-600">Szűrés:</label><select value={feedbackStatusFilter} onChange={e => setFeedbackStatusFilter(e.target.value)} className="form-input text-sm"><option value="">Összes</option><option value="open">Nyitott</option><option value="in_progress">Folyamatban</option><option value="resolved">Megoldva</option><option value="closed">Lezárva</option></select></div>
        </div>
        {feedbackLoading ? <p className="text-gray-600">Betöltés...</p> : feedback.length === 0 ? <p className="text-gray-600">Nincsenek visszajelzések.</p> : (
          <div className="space-y-3">
            {feedback.map(item => {
              const isExpanded = expandedFeedback.has(item.id);
              return (
                <div key={item.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 p-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setExpandedFeedback(prev => { const s = new Set(prev); s.has(item.id) ? s.delete(item.id) : s.add(item.id); return s; })}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="mt-1">{getTypeIcon(item.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1"><span className="font-medium text-gray-900">{item.title || `${item.type} jelentés`}</span><span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}>{item.status === 'open' ? 'Nyitott' : item.status === 'in_progress' ? 'Folyamatban' : item.status === 'resolved' ? 'Megoldva' : 'Lezárva'}</span></div>
                          <p className="text-sm text-gray-600 line-clamp-2">{item.description}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500"><span>{item.user_email || 'Névtelen'}</span><span>•</span><span>{new Date(item.created_at).toLocaleString('hu-HU')}</span>{(item.type === 'error' || item.type === 'crash') && <><span>•</span><span className="text-red-600 font-medium">Hiba log elérhető</span></>}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <select value={item.status} onChange={e => { e.stopPropagation(); updateFeedbackStatus(item.id, e.target.value); }} onClick={e => e.stopPropagation()} className="form-input text-xs"><option value="open">Nyitott</option><option value="in_progress">Folyamatban</option><option value="resolved">Megoldva</option><option value="closed">Lezárva</option></select>
                        {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="p-4 bg-white border-t border-gray-200 space-y-4">
                      <div><h4 className="text-sm font-medium text-gray-700 mb-1">Leírás</h4><p className="text-sm text-gray-900 whitespace-pre-wrap">{item.description}</p></div>
                      {(item.error_log || item.error_stack) && <div><h4 className="text-sm font-medium text-gray-700 mb-1">Error log</h4><pre className="text-xs bg-gray-100 p-3 rounded overflow-auto max-h-64">{item.error_log || item.error_stack}</pre></div>}
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><span className="font-medium text-gray-700">URL:</span><span className="ml-2 text-gray-600">{item.url || 'N/A'}</span></div>
                        <div><span className="font-medium text-gray-700">User Agent:</span><span className="ml-2 text-gray-600 text-xs">{item.user_agent || 'N/A'}</span></div>
                        <div><span className="font-medium text-gray-700">Létrehozva:</span><span className="ml-2 text-gray-600">{new Date(item.created_at).toLocaleString('hu-HU')}</span></div>
                        <div><span className="font-medium text-gray-700">Frissítve:</span><span className="ml-2 text-gray-600">{new Date(item.updated_at).toLocaleString('hu-HU')}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
