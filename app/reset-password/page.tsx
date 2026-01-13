'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function ResetPassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tokenParam = searchParams.get('token');
    if (!tokenParam) {
      setError('Hiányzó vagy érvénytelen visszaállítási link');
    } else {
      setToken(tokenParam);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Validációk
    if (!newPassword || !confirmPassword) {
      setError('Minden mező kitöltése kötelező');
      setIsLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      setError('A jelszónak legalább 6 karakter hosszúnak kell lennie');
      setIsLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('A jelszavak nem egyeznek meg');
      setIsLoading(false);
      return;
    }

    if (!token) {
      setError('Hiányzó vagy érvénytelen visszaállítási link');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Hiba történt a jelszó-visszaállítás során');
        setIsLoading(false);
        return;
      }

      // Sikeres visszaállítás
      setSuccess(true);
      setIsLoading(false);

      // 3 másodperc után átirányítás a login oldalra
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err) {
      console.error('Reset password error:', err);
      setError('Hiba történt a jelszó-visszaállítás során');
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <Logo width={100} height={115} />
          </div>
          <div className="card py-8 px-4 sm:px-10 shadow-soft-lg mt-8">
            <div className="bg-medical-error/10 border border-medical-error/20 text-medical-error px-4 py-3 rounded-lg text-sm font-medium">
              Hiányzó vagy érvénytelen visszaállítási link
            </div>
            <div className="mt-6 text-center">
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-medical-primary hover:text-medical-primary-dark"
              >
                Új jelszó-visszaállítási link kérése
              </Link>
            </div>
            <div className="mt-4 text-center">
              <Link
                href="/login"
                className="text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center justify-center"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Vissza a bejelentkezéshez
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Logo width={100} height={115} />
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
          Új jelszó beállítása
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Adja meg az új jelszavát
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="card py-8 px-4 sm:px-10 shadow-soft-lg">
          {success ? (
            <div className="space-y-6">
              <div className="bg-medical-success/10 border border-medical-success/20 text-medical-success px-4 py-3 rounded-lg text-sm font-medium">
                Jelszó sikeresen visszaállítva! Átirányítjuk a bejelentkezési oldalra...
              </div>
              <Link
                href="/login"
                className="btn-primary w-full flex justify-center items-center"
              >
                Bejelentkezés
              </Link>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="newPassword" className="form-label">
                  Új jelszó
                </label>
                <div className="mt-1 relative">
                  <input
                    id="newPassword"
                    name="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="form-input pl-10 pr-10"
                    placeholder="••••••••"
                    minLength={6}
                  />
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Legalább 6 karakter
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="form-label">
                  Jelszó megerősítése
                </label>
                <div className="mt-1 relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="form-input pl-10 pr-10"
                    placeholder="••••••••"
                    minLength={6}
                  />
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-medical-error/10 border border-medical-error/20 text-medical-error px-4 py-3 rounded-lg text-sm font-medium">
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
                      Jelszó visszaállítása...
                    </>
                  ) : (
                    'Jelszó visszaállítása'
                  )}
                </button>
              </div>

              <div className="text-center">
                <Link
                  href="/login"
                  className="text-sm font-medium text-medical-primary hover:text-medical-primary-dark flex items-center justify-center"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Vissza a bejelentkezéshez
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Kézjegy */}
      <div className="mt-8 text-center">
        <p className="text-xs text-gray-400">
          Készítette: König
        </p>
      </div>
    </div>
  );
}
