'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { MessageCircle, ChevronDown, ChevronUp, AlertCircle, Bug, Lightbulb, Mail, Send } from 'lucide-react';
import { Logo } from '@/components/Logo';

type UserRole = 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';

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
  
  // E-mail küldés állapotok
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

  // E-mail előnézet betöltése
  const loadEmailPreview = async () => {
    if (emailRoles.length === 0) {
      setEmailPreview([]);
      setEmailPreviewData(null);
      return;
    }

    setEmailPreviewLoading(true);
    setEmailError(null);
    try {
      const rolesParam = emailRoles.join(',');
      const res = await fetch(`/api/users/send-email?roles=${encodeURIComponent(rolesParam)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setEmailPreview(data.users || []);
        setEmailPreviewData({
          users: data.users || [],
          includeAdmins: data.includeAdmins || false,
          adminCount: data.adminCount || 0,
        });
      } else {
        const data = await res.json();
        setEmailError(data.error || 'Hiba történt az előnézet betöltésekor');
        setEmailPreview([]);
        setEmailPreviewData(null);
      }
    } catch (e) {
      console.error('Error loading email preview:', e);
      setEmailError('Hiba történt az előnézet betöltésekor');
      setEmailPreview([]);
      setEmailPreviewData(null);
    } finally {
      setEmailPreviewLoading(false);
    }
  };

  // E-mail küldése
  const sendEmailToUsers = async () => {
    if (emailRoles.length === 0) {
      setEmailError('Válasszon ki legalább egy szerepkört');
      return;
    }

    if (!emailSubject.trim()) {
      setEmailError('Az e-mail tárgyának megadása kötelező');
      return;
    }

    if (!emailContent.trim()) {
      setEmailError('Az e-mail tartalmának megadása kötelező');
      return;
    }

    setEmailSending(true);
    setEmailError(null);
    setEmailSuccess(null);

    try {
      const res = await fetch('/api/users/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          roles: emailRoles,
          subject: emailSubject,
          html: emailContent.replace(/\n/g, '<br>'),
          text: emailContent,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setEmailSuccess(data.message || 'E-mail sikeresen elküldve');
        setEmailSubject('');
        setEmailContent('');
        setEmailRoles([]);
        setEmailPreview([]);
        setEmailPreviewData(null);
      } else {
        const data = await res.json();
        setEmailError(data.error || 'Hiba történt az e-mail küldésekor');
      }
    } catch (e) {
      console.error('Error sending email:', e);
      setEmailError('Hiba történt az e-mail küldésekor');
    } finally {
      setEmailSending(false);
    }
  };

  // E-mail előnézet automatikus frissítése, amikor a szerepkörök változnak
  useEffect(() => {
    if (emailRoles.length === 0) {
      setEmailPreview([]);
      return;
    }

    const timer = setTimeout(() => {
      const loadPreview = async () => {
        setEmailPreviewLoading(true);
        setEmailError(null);
        try {
          const rolesParam = emailRoles.join(',');
          const res = await fetch(`/api/users/send-email?roles=${encodeURIComponent(rolesParam)}`, {
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            setEmailPreview(data.users || []);
            setEmailPreviewData({
              users: data.users || [],
              includeAdmins: data.includeAdmins || false,
              adminCount: data.adminCount || 0,
            });
          } else {
            const data = await res.json();
            setEmailError(data.error || 'Hiba történt az előnézet betöltésekor');
            setEmailPreview([]);
            setEmailPreviewData(null);
          }
        } catch (e) {
          console.error('Error loading email preview:', e);
          setEmailError('Hiba történt az előnézet betöltésekor');
          setEmailPreview([]);
        } finally {
          setEmailPreviewLoading(false);
        }
      };
      loadPreview();
    }, 500); // Debounce: 500ms késleltetés

    return () => clearTimeout(timer);
  }, [emailRoles]);

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
            <div className="flex items-center gap-4">
              <Logo width={60} height={69} />
              <h1 className="text-2xl font-bold text-medical-primary">Admin felület</h1>
            </div>
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
                          <option value="technikus">technikus</option>
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

        {/* E-mail küldés */}
        <div className="card mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-medical-primary" />
            <h2 className="text-xl font-semibold">E-mail küldés felhasználóknak</h2>
          </div>

          {/* Szerepkör választás */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Szerepkörök (több választható)
            </label>
            <div className="flex flex-wrap gap-3">
              {['sebészorvos', 'fogpótlástanász', 'technikus', 'admin'].map((role) => (
                <label key={role} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={emailRoles.includes(role)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEmailRoles([...emailRoles, role]);
                      } else {
                        setEmailRoles(emailRoles.filter((r) => r !== role));
                      }
                    }}
                    className="mr-2 h-4 w-4 text-medical-primary focus:ring-medical-primary border-gray-300 rounded"
                  />
                  <span className="text-sm text-gray-700">
                    {role === 'sebészorvos' ? 'Sebészorvos' :
                     role === 'fogpótlástanász' ? 'Fogpótlástanász' :
                     role === 'technikus' ? 'Technikus' :
                     role === 'admin' ? 'Adminisztrátor' : role}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Előnézet */}
          {emailPreviewLoading ? (
            <div className="mb-4 text-sm text-gray-600">Előnézet betöltése...</div>
          ) : emailPreview.length > 0 ? (
            <div className="mb-4 space-y-3">
              <div className="p-3 bg-blue-50 rounded border border-blue-200">
                <p className="text-sm font-medium text-blue-900 mb-2">
                  Címzettek ({emailPreview.length}):
                </p>
                <div className="text-sm text-blue-800 space-y-1 max-h-32 overflow-y-auto">
                  {emailPreview.map((user, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-blue-600">({user.email})</span>
                      <span className="text-xs text-blue-500">- {user.role}</span>
                    </div>
                  ))}
                </div>
              </div>
              {emailPreviewData?.includeAdmins && emailPreviewData.adminCount > 0 && (
                <div className="p-3 bg-green-50 rounded border border-green-200">
                  <p className="text-sm font-medium text-green-900 mb-1">
                    ℹ️ Admin felhasználók automatikusan kapják az e-mailt másolatként
                  </p>
                  <p className="text-xs text-green-700">
                    ({emailPreviewData.adminCount} admin felhasználó)
                  </p>
                </div>
              )}
            </div>
          ) : emailRoles.length > 0 ? (
            <div className="mb-4 p-3 bg-yellow-50 rounded border border-yellow-200">
              <p className="text-sm text-yellow-800">Nem található aktív felhasználó a kiválasztott szerepkörökkel.</p>
            </div>
          ) : null}

          {/* E-mail tárgy */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              E-mail tárgya
            </label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Pl: Fontos értesítés"
              className="form-input w-full"
            />
          </div>

          {/* E-mail tartalom */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              E-mail tartalma
            </label>
            <textarea
              value={emailContent}
              onChange={(e) => setEmailContent(e.target.value)}
              placeholder="Írja be az e-mail tartalmát..."
              rows={8}
              className="form-input w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              A sortörések automatikusan bekerülnek az e-mailbe.
            </p>
          </div>

          {/* Hiba/Siker üzenetek */}
          {emailError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-800">{emailError}</p>
            </div>
          )}

          {emailSuccess && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
              <p className="text-sm text-green-800">{emailSuccess}</p>
            </div>
          )}

          {/* Küldés gomb */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setEmailSubject('');
                setEmailContent('');
                setEmailRoles([]);
                setEmailPreview([]);
                setEmailPreviewData(null);
                setEmailError(null);
                setEmailSuccess(null);
              }}
              className="btn-secondary"
              disabled={emailSending}
            >
              Törlés
            </button>
            <button
              onClick={sendEmailToUsers}
              disabled={emailSending || emailRoles.length === 0 || !emailSubject.trim() || !emailContent.trim()}
              className="btn-primary flex items-center gap-2"
            >
              {emailSending ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Küldés...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  E-mail küldése
                </>
              )}
            </button>
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


