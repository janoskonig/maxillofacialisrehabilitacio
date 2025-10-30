'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, getUserEmail } from '@/lib/auth';
import { getUserRole, setUserRole, UserRole } from '@/lib/roles';

type UsersMap = Record<string, string>;

export default function AdminPage() {
  const router = useRouter();
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [roles, setRoles] = useState<Record<string, UserRole>>({});
  const [usage, setUsage] = useState<Array<{ user_email: string; last_seen: string | null; last_7d: number; last_30d: number; last_90d: number }>>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const parseAllowedUsers = (envValue?: string): UsersMap => {
    const map: UsersMap = {};
    if (!envValue) return map;
    envValue
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const [user, pass] = pair.split(':');
        if (user && pass) {
          map[user.trim()] = pass.trim();
        }
      });
    return map;
  };

  const allowedUsers = useMemo(
    () => parseAllowedUsers(process.env.NEXT_PUBLIC_ALLOWED_USERS),
    []
  );

  const userList = Object.keys(allowedUsers);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    const email = getUserEmail();
    setCurrentEmail(email);
    const role = getUserRole(email);
    // Restrict strictly to konig.janos or anyone with admin role
    setAuthorized(email === 'konig.janos' || role === 'admin');
  }, [router]);

  useEffect(() => {
    // Initialize local role state from storage for existing users
    const map: Record<string, UserRole> = {};
    userList.forEach((email) => {
      map[email] = getUserRole(email);
    });
    setRoles(map);
  }, [userList.length]);

  const updateRole = (email: string, role: UserRole) => {
    setUserRole(email, role);
    setRoles((prev) => ({ ...prev, [email]: role }));
  };

  useEffect(() => {
    // Load usage summary for admin
    const load = async () => {
      if (!authorized) return;
      setUsageLoading(true);
      try {
        const res = await fetch('/api/activity');
        const data = await res.json();
        setUsage(data.summary || []);
      } catch (e) {
        setUsage([]);
      } finally {
        setUsageLoading(false);
      }
    };
    load();
  }, [authorized]);

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
            {currentEmail && (
              <p className="text-sm text-gray-500">Bejelentkezve: {currentEmail}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Felhasználói jogosultságok</h2>
          {userList.length === 0 ? (
            <p className="text-gray-600">Nincsenek konfigurált felhasználók a .env fájlban.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Felhasználó</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Szerepkör</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {userList.map((email) => (
                    <tr key={email}>
                      <td className="px-4 py-3 text-sm text-gray-900">{email}</td>
                      <td className="px-4 py-3">
                        <select
                          className="form-input"
                          value={roles[email] || 'editor'}
                          onChange={(e) => updateRole(email, e.target.value as UserRole)}
                        >
                          <option value="admin">admin</option>
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
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


