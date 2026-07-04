'use client';

import { useEffect, useState } from 'react';
import { HeartPulse, Check } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface Habits {
  alkoholfogyasztas: string | null;
  dohanyzasSzam: string | null;
  felsoFogpotlasVan: boolean | null;
  felsoFogpotlasElegedett: boolean | null;
  felsoFogpotlasProblema: string | null;
  alsoFogpotlasVan: boolean | null;
  alsoFogpotlasElegedett: boolean | null;
  alsoFogpotlasProblema: string | null;
}

/**
 * „Egészségi adataim” — a beteg által önkitölthető mezők a portál Profil
 * oldalán: dohányzás, alkoholfogyasztás, meglévő fogpótlás elégedettség.
 * A kitöltéssel a nyitott emlékeztető-feladat automatikusan lezárul.
 */
export function HealthHabitsCard() {
  const { showToast } = useToast();
  const [habits, setHabits] = useState<Habits | null>(null);
  const [dohanyzas, setDohanyzas] = useState('');
  const [alkohol, setAlkohol] = useState('');
  const [felsoElegedett, setFelsoElegedett] = useState<boolean | null>(null);
  const [felsoProblema, setFelsoProblema] = useState('');
  const [alsoElegedett, setAlsoElegedett] = useState<boolean | null>(null);
  const [alsoProblema, setAlsoProblema] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/patient-portal/health-habits', { credentials: 'include', signal: ac.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.habits) return;
        const h: Habits = data.habits;
        setHabits(h);
        setDohanyzas(h.dohanyzasSzam ?? '');
        setAlkohol(h.alkoholfogyasztas ?? '');
        setFelsoElegedett(h.felsoFogpotlasElegedett);
        setFelsoProblema(h.felsoFogpotlasProblema ?? '');
        setAlsoElegedett(h.alsoFogpotlasElegedett);
        setAlsoProblema(h.alsoFogpotlasProblema ?? '');
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/patient-portal/health-habits', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dohanyzasSzam: dohanyzas,
          alkoholfogyasztas: alkohol,
          felsoFogpotlasElegedett: felsoElegedett,
          felsoFogpotlasProblema: felsoProblema,
          alsoFogpotlasElegedett: alsoElegedett,
          alsoFogpotlasProblema: alsoProblema,
        }),
      });
      if (!res.ok) throw new Error('Mentés sikertelen');
      const data = await res.json();
      showToast(
        data.complete
          ? 'Köszönjük! Minden kért adatot megadott.'
          : 'Adatai elmentve.',
        'success'
      );
    } catch {
      showToast('Hiba a mentés során — kérjük, próbálja újra.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const triStateButtons = (
    value: boolean | null,
    onChange: (v: boolean) => void,
    groupLabel: string
  ) => (
    <div role="radiogroup" aria-label={groupLabel} className="flex gap-2">
      {[
        { v: true, label: 'Igen, elégedett vagyok' },
        { v: false, label: 'Nem vagyok elégedett' },
      ].map(opt => (
        <button
          key={String(opt.v)}
          type="button"
          role="radio"
          aria-checked={value === opt.v}
          onClick={() => onChange(opt.v)}
          className={`flex-1 px-3 py-3 rounded-lg text-sm font-medium border transition-colors ${
            value === opt.v
              ? 'border-medical-primary bg-medical-primary/5 ring-1 ring-medical-primary text-gray-900 dark:text-gray-100'
              : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-medical-primary/60'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div id="health-habits" className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <HeartPulse className="w-5 h-5 text-medical-primary" aria-hidden="true" />
        Egészségi adataim
      </h2>
      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-4">
        Ezeket az adatokat Ön tudja a legpontosabban megadni — a kezelés eredményességének
        értékeléséhez szükségesek.
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="habit-dohanyzas" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Dohányzik? Ha igen, mennyit?
          </label>
          <input
            id="habit-dohanyzas"
            value={dohanyzas}
            onChange={e => setDohanyzas(e.target.value)}
            className="form-input w-full"
            placeholder="Pl.: nem dohányzom / napi 10 szál"
          />
        </div>
        <div>
          <label htmlFor="habit-alkohol" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Fogyaszt alkoholt? Ha igen, milyen gyakran?
          </label>
          <input
            id="habit-alkohol"
            value={alkohol}
            onChange={e => setAlkohol(e.target.value)}
            className="form-input w-full"
            placeholder="Pl.: nem fogyasztok / alkalmanként, hetente"
          />
        </div>

        {habits?.felsoFogpotlasVan === true && (
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Elégedett a felső fogpótlásával?
            </p>
            {triStateButtons(felsoElegedett, setFelsoElegedett, 'Felső fogpótlás elégedettség')}
            {felsoElegedett === false && (
              <textarea
                value={felsoProblema}
                onChange={e => setFelsoProblema(e.target.value)}
                className="form-input w-full mt-2"
                rows={2}
                placeholder="Ha szeretné, írja le röviden a problémát..."
                aria-label="Felső fogpótlás — probléma leírása"
              />
            )}
          </div>
        )}

        {habits?.alsoFogpotlasVan === true && (
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Elégedett az alsó fogpótlásával?
            </p>
            {triStateButtons(alsoElegedett, setAlsoElegedett, 'Alsó fogpótlás elégedettség')}
            {alsoElegedett === false && (
              <textarea
                value={alsoProblema}
                onChange={e => setAlsoProblema(e.target.value)}
                className="form-input w-full mt-2"
                rows={2}
                placeholder="Ha szeretné, írja le röviden a problémát..."
                aria-label="Alsó fogpótlás — probléma leírása"
              />
            )}
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary w-full sm:w-auto px-5 py-2.5 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          {saving ? 'Mentés...' : 'Adataim mentése'}
        </button>
      </div>
    </div>
  );
}
