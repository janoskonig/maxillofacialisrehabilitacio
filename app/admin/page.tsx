'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';

type UserRole = 'admin' | 'editor' | 'viewer';

type User = {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login: string | null;
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
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
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
      </main>
    </div>
  );
}


