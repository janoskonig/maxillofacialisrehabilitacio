'use client';

import { useState } from 'react';
import { Mail, CreditCard, Loader2, User, Calendar, Phone, MapPin, Building, FileText } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export function PortalLogin() {
  const [step, setStep] = useState<'check' | 'register'>('check');
  const [email, setEmail] = useState('');
  const [taj, setTaj] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  
  // Registration fields
  const [nev, setNev] = useState('');
  const [telefonszam, setTelefonszam] = useState('');
  const [szuletesiDatum, setSzuletesiDatum] = useState('');
  const [nem, setNem] = useState<'ferfi' | 'no' | 'nem_ismert' | ''>('');
  const [cim, setCim] = useState('');
  const [varos, setVaros] = useState('');
  const [iranyitoszam, setIranyitoszam] = useState('');
  const [beutaloOrvos, setBeutaloOrvos] = useState('');
  const [beutaloIndokolas, setBeutaloIndokolas] = useState('');
  
  const { showToast } = useToast();

  // Format TAJ number: xxx-xxx-xxx (max 9 digits)
  const formatTaj = (value: string): string => {
    // Remove all non-digit characters
    const digits = value.replace(/\D/g, '');
    
    // Limit to 9 digits
    const limitedDigits = digits.slice(0, 9);
    
    // Format: xxx-xxx-xxx
    if (limitedDigits.length <= 3) {
      return limitedDigits;
    } else if (limitedDigits.length <= 6) {
      return `${limitedDigits.slice(0, 3)}-${limitedDigits.slice(3)}`;
    } else {
      return `${limitedDigits.slice(0, 3)}-${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
    }
  };

  const handleTajChange = (value: string) => {
    const formatted = formatTaj(value);
    setTaj(formatted);
  };

  const handleCheckPatient = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !taj.trim()) {
      showToast('Kérjük, töltse ki mindkét mezőt', 'error');
      return;
    }

    setChecking(true);

    try {
      // Check if patient exists
      // Remove dashes from TAJ before sending
      const tajClean = taj.replace(/-/g, '');
      const response = await fetch('/api/patient-portal/auth/check-patient', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim(), taj: tajClean }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt');
      }

      if (data.exists) {
        // Patient exists - send magic link directly
        await requestMagicLink();
      } else {
        // New patient - show registration form
        setStep('register');
      }
    } catch (error) {
      console.error('Error checking patient:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt',
        'error'
      );
    } finally {
      setChecking(false);
    }
  };

  const requestMagicLink = async () => {
    setLoading(true);

    try {
      // Remove dashes from TAJ before sending
      const tajClean = taj.replace(/-/g, '');
      const response = await fetch('/api/patient-portal/auth/request-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          taj: tajClean,
          // Include registration data if this is a new patient
          ...(step === 'register' ? {
            nev: nev.trim() || undefined,
            telefonszam: telefonszam.trim() || undefined,
            szuletesiDatum: szuletesiDatum || undefined,
            nem: nem || undefined,
            cim: cim.trim() || undefined,
            varos: varos.trim() || undefined,
            iranyitoszam: iranyitoszam.trim() || undefined,
            beutaloOrvos: beutaloOrvos.trim() || undefined,
            beutaloIndokolas: beutaloIndokolas.trim() || undefined,
          } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt');
      }

      showToast(
        'Bejelentkezési link elküldve az email címére. Kérjük, ellenőrizze email fiókját és kattintson a linkre.',
        'success'
      );
      
      // Reset form
      setEmail('');
      setTaj('');
      setNev('');
      setTelefonszam('');
      setSzuletesiDatum('');
      setNem('');
      setCim('');
      setVaros('');
      setIranyitoszam('');
      setBeutaloOrvos('');
      setBeutaloIndokolas('');
      setStep('check');
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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    await requestMagicLink();
  };

  if (step === 'register') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Regisztráció
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          Kérjük, töltse ki az alábbi adatokat az időpontfoglaláshoz.
        </p>

        <form onSubmit={handleRegister} className="space-y-4">
          {/* Basic Info Section */}
          <div className="border-b border-gray-200 pb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Alapadatok</h3>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="form-label flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email cím <span className="text-red-500">*</span>
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
                  TAJ szám <span className="text-red-500">*</span>
                </label>
                <input
                  id="taj"
                  type="text"
                  value={taj}
                  onChange={(e) => handleTajChange(e.target.value)}
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

              <div>
                <label htmlFor="nev" className="form-label flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Teljes név <span className="text-red-500">*</span>
                </label>
                <input
                  id="nev"
                  type="text"
                  value={nev}
                  onChange={(e) => setNev(e.target.value)}
                  className="form-input"
                  placeholder="Kovács János"
                  required
                  disabled={loading}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="szuletesiDatum" className="form-label flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Születési dátum <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="szuletesiDatum"
                    type="date"
                    value={szuletesiDatum}
                    onChange={(e) => setSzuletesiDatum(e.target.value)}
                    className="form-input"
                    required
                    disabled={loading}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <div>
                  <label htmlFor="nem" className="form-label">
                    Nem <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="nem"
                    value={nem}
                    onChange={(e) => setNem(e.target.value as 'ferfi' | 'no' | 'nem_ismert' | '')}
                    className="form-input"
                    required
                    disabled={loading}
                  >
                    <option value="">Válasszon...</option>
                    <option value="ferfi">Férfi</option>
                    <option value="no">Nő</option>
                    <option value="nem_ismert">Nem ismert</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="telefonszam" className="form-label flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Telefonszám
                </label>
                <input
                  id="telefonszam"
                  type="tel"
                  value={telefonszam}
                  onChange={(e) => setTelefonszam(e.target.value)}
                  className="form-input"
                  placeholder="+36-30-123-4567"
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Address Section */}
          <div className="border-b border-gray-200 pb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Lakcím</h3>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="cim" className="form-label flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Cím
                </label>
                <input
                  id="cim"
                  type="text"
                  value={cim}
                  onChange={(e) => setCim(e.target.value)}
                  className="form-input"
                  placeholder="Utca, házszám"
                  disabled={loading}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="varos" className="form-label">
                    Város
                  </label>
                  <input
                    id="varos"
                    type="text"
                    value={varos}
                    onChange={(e) => setVaros(e.target.value)}
                    className="form-input"
                    placeholder="Budapest"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label htmlFor="iranyitoszam" className="form-label">
                    Irányítószám
                  </label>
                  <input
                    id="iranyitoszam"
                    type="text"
                    value={iranyitoszam}
                    onChange={(e) => setIranyitoszam(e.target.value)}
                    className="form-input"
                    placeholder="1011"
                    disabled={loading}
                    maxLength={10}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Referral Section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Beutaló adatok</h3>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="beutaloOrvos" className="form-label flex items-center gap-2">
                  <Building className="w-4 h-4" />
                  Beutaló orvos neve
                </label>
                <input
                  id="beutaloOrvos"
                  type="text"
                  value={beutaloOrvos}
                  onChange={(e) => setBeutaloOrvos(e.target.value)}
                  className="form-input"
                  placeholder="Dr. Kovács János"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="beutaloIndokolas" className="form-label flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Beutalás indoka
                </label>
                <textarea
                  id="beutaloIndokolas"
                  value={beutaloIndokolas}
                  onChange={(e) => setBeutaloIndokolas(e.target.value)}
                  className="form-input"
                  placeholder="Beutalás indokának leírása..."
                  rows={4}
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => setStep('check')}
              className="btn-secondary flex-1"
              disabled={loading}
            >
              Vissza
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Küldés...
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  Regisztráció és link küldése
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">
        Bejelentkezés
      </h2>
      <p className="text-sm text-gray-600 mb-6">
        Adja meg email címét és TAJ számát. Bejelentkezési linket küldünk emailben. Ha még nem regisztrált, automatikusan létrehozzuk a fiókját.
      </p>

      <form onSubmit={handleCheckPatient} className="space-y-4">
        <div>
          <label htmlFor="email-check" className="form-label flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email cím
          </label>
          <input
            id="email-check"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form-input"
            placeholder="pelda@email.hu"
            required
            disabled={checking || loading}
          />
        </div>

        <div>
          <label htmlFor="taj-check" className="form-label flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            TAJ szám
          </label>
          <input
            id="taj-check"
            type="text"
            value={taj}
            onChange={(e) => handleTajChange(e.target.value)}
            className="form-input"
            placeholder="123-456-789"
            required
            disabled={checking || loading}
            maxLength={11}
          />
          <p className="text-xs text-gray-500 mt-1">
            Formátum: XXX-XXX-XXX (9 számjegy)
          </p>
        </div>

        <button
          type="submit"
          disabled={checking || loading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
        >
          {checking ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Ellenőrzés...
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
