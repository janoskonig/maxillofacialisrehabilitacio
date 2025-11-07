'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { MessageCircle, ChevronDown, ChevronUp, AlertCircle, Bug, Lightbulb } from 'lucide-react';

type UserRole = 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'epitéziskészítő' | 'sebészorvos';

type User = {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  restricted_view: boolean;
  created_at: string;
  updated_at: string;
  last_login: string | null;
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

export default function AdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usage, setUsage] = useState<Array<{ user_email: string; last_seen: string | null; last_7d: number; last_30d: number; last_90d: number }>>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<string>('');
  const [expandedFeedback, setExpandedFeedback] = useState<Set<string>>(new Set());

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) {
      router.push('/login');
      return;
    }
      setCurrentUser(user);
      setAuthorized(user.role === 'admin');
      setLoading(false);
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    const loadUsers = async () => {
      if (!authorized) return;
      setUsersLoading(true);
      try {
        const res = await fetch('/api/users', {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setUsers(data.users || []);
        }
      } catch (e) {
        console.error('Error loading users:', e);
      } finally {
        setUsersLoading(false);
      }
    };
    loadUsers();
  }, [authorized]);

  const updateRole = async (userId: string, role: UserRole) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        // Frissítjük a lokális state-et
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role } : u))
        );
      } else {
        const data = await res.json();
        alert(data.error || 'Hiba történt a szerepkör frissítésekor');
      }
    } catch (e) {
      console.error('Error updating role:', e);
      alert('Hiba történt a szerepkör frissítésekor');
    }
  };


  const approveUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ active: true }),
      });
      if (res.ok) {
        // Frissítjük a lokális state-et
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, active: true } : u))
        );
        // Újratöltjük a listát
        const res2 = await fetch('/api/users', { credentials: 'include' });
        if (res2.ok) {
          const data = await res2.json();
          setUsers(data.users || []);
        }
      } else {
        const data = await res.json();
        alert(data.error || 'Hiba történt a jóváhagyáskor');
      }
    } catch (e) {
      console.error('Error approving user:', e);
      alert('Hiba történt a jóváhagyáskor');
    }
  };

  const rejectUser = async (userId: string) => {
    if (!confirm('Biztosan törölni szeretné ezt a felhasználót?')) {
      return;
    }
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        // Eltávolítjuk a listából
        setUsers((prev) => prev.filter((u) => u.id !== userId));
      } else {
        const data = await res.json();
        alert(data.error || 'Hiba történt a törléskor');
      }
    } catch (e) {
      console.error('Error rejecting user:', e);
      alert('Hiba történt a törléskor');
    }
  };

  useEffect(() => {
    const loadUsage = async () => {
      if (!authorized) return;
      setUsageLoading(true);
      try {
        const res = await fetch('/api/activity', {
          credentials: 'include',
        });
        const data = await res.json();
        setUsage(data.summary || []);
      } catch (e) {
        setUsage([]);
      } finally {
        setUsageLoading(false);
      }
    };
    loadUsage();
  }, [authorized]);

  useEffect(() => {
    const loadFeedback = async () => {
      if (!authorized) return;
      setFeedbackLoading(true);
      try {
        const url = feedbackStatusFilter 
          ? `/api/feedback?status=${feedbackStatusFilter}`
          : '/api/feedback';
        const res = await fetch(url, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setFeedback(data.feedback || []);
        }
      } catch (e) {
        console.error('Error loading feedback:', e);
        setFeedback([]);
      } finally {
        setFeedbackLoading(false);
      }
    };
    loadFeedback();
  }, [authorized, feedbackStatusFilter]);

  const updateFeedbackStatus = async (feedbackId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/feedback/${feedbackId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setFeedback((prev) =>
          prev.map((f) => (f.id === feedbackId ? { ...f, status: newStatus as any, updated_at: new Date().toISOString() } : f))
        );
      } else {
        const data = await res.json();
        alert(data.error || 'Hiba történt a status frissítésekor');
      }
    } catch (e) {
      console.error('Error updating feedback status:', e);
      alert('Hiba történt a status frissítésekor');
    }
  };

  const toggleFeedbackExpanded = (feedbackId: string) => {
    setExpandedFeedback((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(feedbackId)) {
        newSet.delete(feedbackId);
      } else {
        newSet.add(feedbackId);
      }
      return newSet;
    });
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'bug':
        return <Bug className="w-4 h-4" />;
      case 'error':
      case 'crash':
        return <AlertCircle className="w-4 h-4" />;
      case 'suggestion':
        return <Lightbulb className="w-4 h-4" />;
      default:
        return <MessageCircle className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-yellow-100 text-yellow-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'resolved':
        return 'bg-green-100 text-green-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Betöltés...</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white shadow rounded-lg p-6 max-w-md w-full text-center">
          <p className="text-gray-700">Nincs jogosultsága az admin felülethez.</p>
          <button
            className="btn-secondary mt-4"
            onClick={() => router.push('/')}
          >
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-medical-primary">Admin felület</h1>
            {currentUser && (
              <p className="text-sm text-gray-500">Bejelentkezve: {currentUser.email} ({currentUser.role})</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Jóváhagyásra váró felhasználók */}
        {users.filter(u => !u.active).length > 0 && (
          <div className="card mb-6 border-l-4 border-yellow-400">
            <h2 className="text-xl font-semibold mb-4 text-yellow-800">
              Jóváhagyásra váró felhasználók ({users.filter(u => !u.active).length})
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Regisztráció ideje</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Műveletek</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users
                    .filter((u) => !u.active)
                    .map((user) => (
                      <tr key={user.id} className="bg-yellow-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{user.email}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {user.created_at ? new Date(user.created_at).toLocaleString('hu-HU') : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => approveUser(user.id)}
                              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                            >
                              Jóváhagyás
                            </button>
                            <button
                              onClick={() => rejectUser(user.id)}
                              className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                            >
                              Elutasítás
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Felhasználók kezelése</h2>
          {usersLoading ? (
            <p className="text-gray-600">Betöltés...</p>
          ) : users.length === 0 ? (
            <p className="text-gray-600">Nincsenek felhasználók az adatbázisban.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Szerepkör</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Állapot</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Utolsó bejelentkezés</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users
                    .filter((u) => u.active)
                    .map((user) => (
                      <tr key={user.id}>
                        <td className="px-4 py-3 text-sm text-gray-900">{user.email}</td>
                      <td className="px-4 py-3">
                        <select
                          className="form-input"
                            value={user.role}
                            onChange={(e) => updateRole(user.id, e.target.value as UserRole)}
                        >
                          <option value="admin">admin</option>
                          <option value="fogpótlástanász">fogpótlástanász</option>
                          <option value="epitéziskészítő">epitéziskészítő</option>
                          <option value="sebészorvos">sebészorvos</option>
                        </select>
                      </td>
                        <td className="px-4 py-3 text-sm">
                          {user.active ? (
                            <span className="text-green-600">Aktív</span>
                          ) : (
                            <span className="text-red-600">Inaktív</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {user.last_login ? new Date(user.last_login).toLocaleString('hu-HU') : '-'}
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-6">
            <button className="btn-secondary" onClick={() => router.push('/')}>Vissza</button>
          </div>
        </div>

        <div className="card mt-6">
          <h2 className="text-xl font-semibold mb-4">Használati statisztika</h2>
          {usageLoading ? (
            <p className="text-gray-600">Betöltés...</p>
          ) : usage.length === 0 ? (
            <p className="text-gray-600">Még nincs adat.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Felhasználó</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Utoljára láttuk</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">7 nap</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">30 nap</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">90 nap</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {usage.map((row) => (
                    <tr key={row.user_email}>
                      <td className="px-4 py-3 text-sm text-gray-900">{row.user_email}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.last_seen ? new Date(row.last_seen).toLocaleString() : '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.last_7d}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.last_30d}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.last_90d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card mt-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Visszajelzések napló</h2>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Szűrés:</label>
              <select
                value={feedbackStatusFilter}
                onChange={(e) => setFeedbackStatusFilter(e.target.value)}
                className="form-input text-sm"
              >
                <option value="">Összes</option>
                <option value="open">Nyitott</option>
                <option value="in_progress">Folyamatban</option>
                <option value="resolved">Megoldva</option>
                <option value="closed">Lezárva</option>
              </select>
            </div>
          </div>
          {feedbackLoading ? (
            <p className="text-gray-600">Betöltés...</p>
          ) : feedback.length === 0 ? (
            <p className="text-gray-600">Nincsenek visszajelzések.</p>
          ) : (
            <div className="space-y-3">
              {feedback.map((item) => {
                const isExpanded = expandedFeedback.has(item.id);
                return (
                  <div
                    key={item.id}
                    className="border border-gray-200 rounded-lg overflow-hidden"
                  >
                    <div
                      className="bg-gray-50 p-4 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => toggleFeedbackExpanded(item.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="mt-1">
                            {getTypeIcon(item.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900">
                                {item.title || `${item.type} jelentés`}
                              </span>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(item.status)}`}>
                                {item.status === 'open' && 'Nyitott'}
                                {item.status === 'in_progress' && 'Folyamatban'}
                                {item.status === 'resolved' && 'Megoldva'}
                                {item.status === 'closed' && 'Lezárva'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 line-clamp-2">
                              {item.description}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                              <span>{item.user_email || 'Névtelen'}</span>
                              <span>•</span>
                              <span>{new Date(item.created_at).toLocaleString('hu-HU')}</span>
                              {item.type === 'error' || item.type === 'crash' ? (
                                <>
                                  <span>•</span>
                                  <span className="text-red-600 font-medium">Hiba log elérhető</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <select
                            value={item.status}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateFeedbackStatus(item.id, e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="form-input text-xs"
                          >
                            <option value="open">Nyitott</option>
                            <option value="in_progress">Folyamatban</option>
                            <option value="resolved">Megoldva</option>
                            <option value="closed">Lezárva</option>
                          </select>
                          {isExpanded ? (
                            <ChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="p-4 bg-white border-t border-gray-200">
                        <div className="space-y-4">
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1">Leírás</h4>
                            <p className="text-sm text-gray-900 whitespace-pre-wrap">{item.description}</p>
                          </div>
                          {(item.error_log || item.error_stack) && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 mb-1">Error log</h4>
                              <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto max-h-64">
                                {item.error_log || item.error_stack}
                              </pre>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="font-medium text-gray-700">URL:</span>
                              <span className="ml-2 text-gray-600">{item.url || 'N/A'}</span>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">User Agent:</span>
                              <span className="ml-2 text-gray-600 text-xs">{item.user_agent || 'N/A'}</span>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Létrehozva:</span>
                              <span className="ml-2 text-gray-600">{new Date(item.created_at).toLocaleString('hu-HU')}</span>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Frissítve:</span>
                              <span className="ml-2 text-gray-600">{new Date(item.updated_at).toLocaleString('hu-HU')}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}


