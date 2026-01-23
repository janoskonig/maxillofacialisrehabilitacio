'use client';

import { useState } from 'react';
import { Mail, CreditCard, User, Loader2, Phone, Calendar, MapPin } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export function PortalRegister() {
  const [email, setEmail] = useState('');
  const [taj, setTaj] = useState('');
  const [nev, setNev] = useState('');
  const [telefonszam, setTelefonszam] = useState('');
  const [szuletesiDatum, setSzuletesiDatum] = useState('');
  const [nem, setNem] = useState<'ferfi' | 'no' | ''>('');
  const [cim, setCim] = useState('');
  const [varos, setVaros] = useState('');
  const [iranyitoszam, setIranyitoszam] = useState('');
  const [beutaloOrvos, setBeutaloOrvos] = useState('');
  const [beutaloIndokolas, setBeutaloIndokolas] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !taj.trim()) {
      showToast('Kérjük, töltse ki az email címet és TAJ számot', 'error');
      return;
    }

    if (!nev.trim()) {
      showToast('Kérjük, töltse ki a nevet', 'error');
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
          nev: nev.trim() || undefined,
          telefonszam: telefonszam.trim() || undefined,
          szuletesiDatum: szuletesiDatum.trim() || undefined,
          nem: nem || undefined,
          cim: cim.trim() || undefined,
          varos: varos.trim() || undefined,
          iranyitoszam: iranyitoszam.trim() || undefined,
          beutaloOrvos: beutaloOrvos.trim() || undefined,
          beutaloIndokolas: beutaloIndokolas.trim() || undefined,
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
        {/* Required Fields */}
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
            className="form-input mobile-touch-target"
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
            className="form-input mobile-touch-target"
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
          <label htmlFor="reg-nev" className="form-label flex items-center gap-2">
            <User className="w-4 h-4" />
            Név *
          </label>
          <input
            id="reg-nev"
            type="text"
            value={nev}
            onChange={(e) => setNev(e.target.value)}
            className="form-input mobile-touch-target"
            placeholder="Kovács János"
            required
            disabled={loading}
          />
        </div>

        {/* Optional Personal Information */}
        <div className="border-t pt-4">
          <p className="text-sm font-medium text-gray-700 mb-3">
            Személyes adatok (opcionális):
          </p>

          <div className="space-y-4">
            <div>
              <label htmlFor="reg-telefon" className="form-label flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Telefonszám
              </label>
              <input
                id="reg-telefon"
                type="tel"
                value={telefonszam}
                onChange={(e) => setTelefonszam(e.target.value)}
                className="form-input mobile-touch-target"
                placeholder="+36123456789"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="reg-szuletesi" className="form-label flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Születési dátum
              </label>
              <input
                id="reg-szuletesi"
                type="date"
                value={szuletesiDatum}
                onChange={(e) => setSzuletesiDatum(e.target.value)}
                className="form-input mobile-touch-target"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="reg-nem" className="form-label flex items-center gap-2">
                <User className="w-4 h-4" />
                Nem
              </label>
              <select
                id="reg-nem"
                value={nem}
                onChange={(e) => setNem(e.target.value as 'ferfi' | 'no' | '')}
                className="form-input mobile-touch-target"
                disabled={loading}
              >
                <option value="">Válasszon...</option>
                <option value="ferfi">Férfi</option>
                <option value="no">Nő</option>
              </select>
            </div>

            <div>
              <label htmlFor="reg-cim" className="form-label flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Cím
              </label>
              <input
                id="reg-cim"
                type="text"
                value={cim}
                onChange={(e) => setCim(e.target.value)}
                className="form-input mobile-touch-target"
                placeholder="Utca, házszám"
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="reg-varos" className="form-label">
                  Város
                </label>
                <input
                  id="reg-varos"
                  type="text"
                  value={varos}
                  onChange={(e) => setVaros(e.target.value)}
                  className="form-input mobile-touch-target"
                  placeholder="Budapest"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="reg-iranyitoszam" className="form-label">
                  Irányítószám
                </label>
                <input
                  id="reg-iranyitoszam"
                  type="text"
                  value={iranyitoszam}
                  onChange={(e) => setIranyitoszam(e.target.value)}
                  className="form-input mobile-touch-target"
                  placeholder="1088"
                  disabled={loading}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Referring Doctor Information */}
        <div className="border-t pt-4">
          <p className="text-sm font-medium text-gray-700 mb-3">
            Beutaló orvos adatai (opcionális):
          </p>

          <div className="space-y-4">
            <div>
              <label htmlFor="reg-beutalo-orvos" className="form-label flex items-center gap-2">
                <User className="w-4 h-4" />
                Beutaló orvos neve
              </label>
              <input
                id="reg-beutalo-orvos"
                type="text"
                value={beutaloOrvos}
                onChange={(e) => setBeutaloOrvos(e.target.value)}
                className="form-input mobile-touch-target"
                placeholder="Dr. Kovács János"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="reg-beutalo-indokolas" className="form-label flex items-center gap-2">
                <User className="w-4 h-4" />
                Beutalás indoka
              </label>
              <textarea
                id="reg-beutalo-indokolas"
                value={beutaloIndokolas}
                onChange={(e) => setBeutaloIndokolas(e.target.value)}
                className="form-input mobile-touch-target"
                placeholder="Beutalás indokának leírása..."
                rows={3}
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 mobile-touch-target"
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








