'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess(false);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Hiba történt a kérés feldolgozása során');
        setIsLoading(false);
        return;
      }

      // Sikeres kérés - mindig ugyanazt a választ kapjuk biztonsági okokból
      setSuccess(true);
      setIsLoading(false);
    } catch (err) {
      console.error('Forgot password error:', err);
      setError('Hiba történt a kérés feldolgozása során');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Logo width={100} height={115} />
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
          Jelszó visszaállítása
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Adja meg az email címét, és elküldjük Önnek a jelszó-visszaállítási linket
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="card py-8 px-4 sm:px-10 shadow-soft-lg">
          {success ? (
            <div className="space-y-6">
              <div className="bg-medical-success/10 border border-medical-success/20 text-medical-success px-4 py-3 rounded-lg text-sm font-medium">
                Ha ez az email cím regisztrálva van, akkor elküldtük a jelszó-visszaállítási linket. 
                Kérjük ellenőrizze az email fiókját és kövesse a linkben található utasításokat.
              </div>
              <div className="text-sm text-gray-600">
                <p className="mb-2">A link 1 órán belül érvényes.</p>
                <p>Ha nem találja az emailt, ellenőrizze a spam mappát is.</p>
              </div>
              <Link
                href="/login"
                className="btn-primary w-full flex justify-center items-center"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Vissza a bejelentkezéshez
              </Link>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="form-label">
                  Email cím
                </label>
                <div className="mt-1 relative">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="form-input pl-10"
                    placeholder="vezeteknev.keresztnev@example.com"
                  />
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
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
                      Küldés...
                    </>
                  ) : (
                    'Jelszó-visszaállítási link küldése'
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
