'use client';

import { useState } from 'react';
import { Mail, CreditCard, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export function PortalLogin() {
  const [email, setEmail] = useState('');
  const [taj, setTaj] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !taj.trim()) {
      showToast('Kérjük, töltse ki mindkét mezőt', 'error');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/patient-portal/auth/request-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim(), taj: taj.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt');
      }

      showToast(
        'Bejelentkezési link elküldve az email címére. Kérjük, ellenőrizze email fiókját.',
        'success'
      );
      setEmail('');
      setTaj('');
    } catch (error) {
      console.error('Error requesting magic link:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt a bejelentkezési link kérésekor',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">
        Bejelentkezés
      </h2>
      <p className="text-sm text-gray-600 mb-6">
        Adja meg email címét és TAJ számát. Bejelentkezési linket küldünk emailben.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="form-label flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email cím
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form-input"
            placeholder="pelda@email.hu"
            required
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="taj" className="form-label flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            TAJ szám
          </label>
          <input
            id="taj"
            type="text"
            value={taj}
            onChange={(e) => setTaj(e.target.value)}
            className="form-input"
            placeholder="123-456-789"
            required
            disabled={loading}
            maxLength={11}
          />
          <p className="text-xs text-gray-500 mt-1">
            Formátum: XXX-XXX-XXX (9 számjegy)
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Küldés...
            </>
          ) : (
            <>
              <Mail className="w-4 h-4" />
              Bejelentkezési link küldése
            </>
          )}
        </button>
      </form>
    </div>
  );
}






