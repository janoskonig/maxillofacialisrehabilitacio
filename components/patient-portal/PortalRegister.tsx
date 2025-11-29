'use client';

import { useState } from 'react';
import { Mail, CreditCard, User, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export function PortalRegister() {
  const [email, setEmail] = useState('');
  const [taj, setTaj] = useState('');
  const [surgeonName, setSurgeonName] = useState('');
  const [surgeonEmail, setSurgeonEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !taj.trim()) {
      showToast('Kérjük, töltse ki az email címet és TAJ számot', 'error');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/patient-portal/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          taj: taj.trim(),
          surgeonName: surgeonName.trim() || undefined,
          surgeonEmail: surgeonEmail.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt');
      }

      showToast(
        'Regisztráció sikeres! Kérjük, ellenőrizze email címét a megerősítő linkhez.',
        'success'
      );
      setEmail('');
      setTaj('');
      setSurgeonName('');
      setSurgeonEmail('');
    } catch (error) {
      console.error('Error registering:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt a regisztráció során',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">
        Új regisztráció
      </h2>
      <p className="text-sm text-gray-600 mb-6">
        Regisztráljon a páciens portálra. Emailben megerősítő linket küldünk.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reg-email" className="form-label flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email cím *
          </label>
          <input
            id="reg-email"
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
          <label htmlFor="reg-taj" className="form-label flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            TAJ szám *
          </label>
          <input
            id="reg-taj"
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

        <div className="border-t pt-4">
          <p className="text-sm text-gray-600 mb-3">
            Beutaló orvos adatai (opcionális, de ajánlott):
          </p>

          <div className="space-y-4">
            <div>
              <label htmlFor="surgeon-name" className="form-label flex items-center gap-2">
                <User className="w-4 h-4" />
                Beutaló orvos neve
              </label>
              <input
                id="surgeon-name"
                type="text"
                value={surgeonName}
                onChange={(e) => setSurgeonName(e.target.value)}
                className="form-input"
                placeholder="Dr. Kovács János"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="surgeon-email" className="form-label flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Beutaló orvos email címe
              </label>
              <input
                id="surgeon-email"
                type="email"
                value={surgeonEmail}
                onChange={(e) => setSurgeonEmail(e.target.value)}
                className="form-input"
                placeholder="orvos@email.hu"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Regisztrálás...
            </>
          ) : (
            <>
              <Mail className="w-4 h-4" />
              Regisztráció
            </>
          )}
        </button>
      </form>
    </div>
  );
}


