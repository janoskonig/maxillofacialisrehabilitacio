'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, Lock, Eye, EyeOff, UserX } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  // Inaktivált / jóváhagyásra váró fiók: külön, egyértelmű doboz — NEM a jelszó
  // hibás, ezért ilyenkor az „Elfelejtett jelszó?" linket sem kínáljuk fel.
  const [inactiveNotice, setInactiveNotice] = useState<{ code: string; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const inactiveTitle =
    inactiveNotice?.code === 'ACCOUNT_DEACTIVATED'
      ? 'A fiókot inaktiválták'
      : inactiveNotice?.code === 'ACCOUNT_PENDING_APPROVAL'
        ? 'A fiók még jóváhagyásra vár'
        : 'A fiók inaktív';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setInactiveNotice(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403 && typeof data.code === 'string' && data.code.startsWith('ACCOUNT_')) {
          setInactiveNotice({ code: data.code, message: data.error || 'Ez a fiók inaktív.' });
        } else {
          setError(data.error || 'Hibás email cím vagy jelszó');
        }
        setIsLoading(false);
        return;
      }

      // Sikeres bejelentkezés
      router.push('/');
    } catch (err) {
      console.error('Login error:', err);
      setError('Bejelentkezési hiba történt');
    setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Logo width={100} height={115} />
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900 dark:text-gray-100">
          Maxillofaciális Rehabilitáció
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          BETEGREGISZTER ÉS IDŐPONTKEZELŐ
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-4xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Orvosos bejelentkezés - Bal oldal */}
          <div className="card py-8 px-4 sm:px-10 shadow-soft-lg">
            <div className="bg-medical-primary/10 border border-medical-primary/20 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
                Ha Ön beküldő orvos, kérem regisztráljon vagy lépjen be.
              </p>
            </div>
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="form-label">
                  Felhasználónév
                </label>
                <div className="mt-1 relative">
                  <input
                    id="email"
                    name="email"
                    type="text"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="form-input pl-10"
                    placeholder="vezeteknev.keresztnev"
                  />
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="form-label">
                  Jelszó
                </label>
                <div className="mt-1 relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input pl-10 pr-10"
                    placeholder="••••••••"
                  />
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Jelszó elrejtése' : 'Jelszó megjelenítése'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {!inactiveNotice && (
                  <div className="mt-2 text-right">
                    <Link
                      href="/forgot-password"
                      className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline"
                    >
                      Elfelejtett jelszó?
                    </Link>
                  </div>
                )}
              </div>

              {inactiveNotice && (
                <div
                  role="alert"
                  data-testid="inactive-account-notice"
                  className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 px-4 py-3 rounded-lg text-sm"
                >
                  <div className="flex items-center gap-2 font-semibold text-base mb-1">
                    <UserX className="w-5 h-5 flex-shrink-0" />
                    {inactiveTitle}
                  </div>
                  <p>{inactiveNotice.message}</p>
                  <p className="mt-2 font-semibold">
                    Nem a jelszó hibás, jelszó-visszaállítást nem kell kérnie.
                  </p>
                </div>
              )}

              {error && (
                <div role="alert" className="bg-medical-error/10 border border-medical-error/20 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm font-medium">
                  {error}
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary w-full flex justify-center items-center"
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Bejelentkezés...
                    </>
                  ) : (
                    'Bejelentkezés'
                  )}
                </button>
              </div>

              <div className="text-center mt-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Még nincs fiókja?{' '}
                  <Link href="/register" className="font-medium text-blue-700 dark:text-blue-300 hover:underline">
                    Regisztráció
                  </Link>
                </p>
              </div>
            </form>
          </div>

          {/* Páciens portál - Jobb oldal */}
          <div className="card py-8 px-4 sm:px-10 shadow-soft-lg flex flex-col justify-center">
            <div className="bg-medical-success/10 border border-medical-success/20 rounded-lg p-4">
              <p className="text-sm text-green-800 dark:text-green-200 font-medium mb-2">
                Ha Ön páciens, kérem kattintson az alábbi linkre és kövesse az utasításokat.
              </p>
              <Link
                href="/patient-portal"
                className="btn-primary w-full mt-3 text-center inline-block"
              >
                Páciens portál
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center space-y-2">
        <div className="flex justify-center gap-4 text-xs">
          <Link href="/privacy" className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300 transition-colors">
            Privacy Policy
          </Link>
          <span className="text-gray-300 dark:text-gray-700">|</span>
          <Link href="/terms" className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300 transition-colors">
            Terms of Service
          </Link>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Készítette: König
        </p>
      </div>
    </div>
  );
}

