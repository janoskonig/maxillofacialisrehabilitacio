'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, ArrowRight, AlertTriangle, CheckCircle, X, Users, Plus, Trash2 } from 'lucide-react';

interface PatientSummary {
  id: string;
  nev: string;
  taj: string;
  email: string;
  telefonszam: string;
  szuletesiDatum: string;
  createdAt: string;
}

type MergeStep = 'search' | 'confirm' | 'done';

export function PatientMerge() {
  const [step, setStep] = useState<MergeStep>('search');
  const [searchPrimary, setSearchPrimary] = useState('');
  const [searchSecondary, setSearchSecondary] = useState('');
  const [resultsPrimary, setResultsPrimary] = useState<PatientSummary[]>([]);
  const [resultsSecondary, setResultsSecondary] = useState<PatientSummary[]>([]);
  const [primaryPatient, setPrimaryPatient] = useState<PatientSummary | null>(null);
  const [secondaryPatients, setSecondaryPatients] = useState<PatientSummary[]>([]);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [mergedCount, setMergedCount] = useState(0);
  const debounceRef1 = useRef<ReturnType<typeof setTimeout>>();
  const debounceRef2 = useRef<ReturnType<typeof setTimeout>>();

  const selectedIds = new Set([
    primaryPatient?.id,
    ...secondaryPatients.map(p => p.id),
  ].filter(Boolean));

  const searchPatientsApi = useCallback(async (query: string): Promise<PatientSummary[]> => {
    if (!query || query.length < 2) return [];
    const res = await fetch(`/api/patients?q=${encodeURIComponent(query)}&limit=10`, {
      credentials: 'include',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.patients || []).map((p: any) => ({
      id: p.id,
      nev: p.nev || '',
      taj: p.taj || '',
      email: p.email || '',
      telefonszam: p.telefonszam || '',
      szuletesiDatum: p.szuletesiDatum || p.szuletesi_datum || '',
      createdAt: p.createdAt || p.created_at || '',
    }));
  }, []);

  useEffect(() => {
    if (debounceRef1.current) clearTimeout(debounceRef1.current);
    debounceRef1.current = setTimeout(async () => {
      const results = await searchPatientsApi(searchPrimary);
      setResultsPrimary(results.filter(p => !selectedIds.has(p.id)));
    }, 300);
    return () => { if (debounceRef1.current) clearTimeout(debounceRef1.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchPrimary, searchPatientsApi]);

  useEffect(() => {
    if (debounceRef2.current) clearTimeout(debounceRef2.current);
    debounceRef2.current = setTimeout(async () => {
      const results = await searchPatientsApi(searchSecondary);
      setResultsSecondary(results.filter(p => !selectedIds.has(p.id)));
    }, 300);
    return () => { if (debounceRef2.current) clearTimeout(debounceRef2.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSecondary, searchPatientsApi]);

  const addSecondary = (p: PatientSummary) => {
    if (selectedIds.has(p.id)) return;
    setSecondaryPatients(prev => [...prev, p]);
    setSearchSecondary('');
    setResultsSecondary([]);
  };

  const removeSecondary = (id: string) => {
    setSecondaryPatients(prev => prev.filter(p => p.id !== id));
  };

  const handleMerge = async () => {
    if (!primaryPatient || secondaryPatients.length === 0) return;
    setMerging(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/merge-patients', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryPatientId: primaryPatient.id,
          secondaryPatientIds: secondaryPatients.map(p => p.id),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const meta = data._errorMeta;
        const detail = meta ? ` [${meta.code || ''} ${meta.constraint || ''} ${meta.table || ''}]`.trim() : '';
        setError((data.error || 'Hiba történt az összevonás során') + detail);
        return;
      }

      setSuccessMsg(data.message);
      setMergedCount(data.mergedCount || secondaryPatients.length);
      setStep('done');
    } catch {
      setError('Hálózati hiba történt');
    } finally {
      setMerging(false);
    }
  };

  const reset = () => {
    setStep('search');
    setSearchPrimary('');
    setSearchSecondary('');
    setResultsPrimary([]);
    setResultsSecondary([]);
    setPrimaryPatient(null);
    setSecondaryPatients([]);
    setError(null);
    setSuccessMsg(null);
    setMergedCount(0);
  };

  const formatDate = (d: string) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('hu-HU'); } catch { return d; }
  };

  const PatientCard = ({ patient, label, color, onRemove, compact }: {
    patient: PatientSummary;
    label: string;
    color: 'green' | 'red';
    onRemove: () => void;
    compact?: boolean;
  }) => (
    <div className={`border-2 rounded-lg p-3 ${compact ? 'p-2.5' : 'p-4'} ${color === 'green' ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-bold uppercase tracking-wide ${color === 'green' ? 'text-green-700' : 'text-red-700'}`}>
          {label}
        </span>
        <button onClick={onRemove} className="text-gray-400 hover:text-gray-600 transition-colors" title="Eltávolítás">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className={`font-semibold text-gray-900 ${compact ? 'text-base' : 'text-lg'}`}>{patient.nev}</p>
      <div className={`mt-1.5 ${compact ? 'flex flex-wrap gap-x-4 gap-y-0.5' : 'space-y-1'} text-sm text-gray-600`}>
        <p>TAJ: <span className="font-medium text-gray-800">{patient.taj || '—'}</span></p>
        <p>Szül.: <span className="font-medium text-gray-800">{formatDate(patient.szuletesiDatum)}</span></p>
        <p>Tel.: <span className="font-medium text-gray-800">{patient.telefonszam || '—'}</span></p>
        {!compact && <p>Email: <span className="font-medium text-gray-800">{patient.email || '—'}</span></p>}
        <p>Rögzítve: <span className="font-medium text-gray-800">{formatDate(patient.createdAt)}</span></p>
      </div>
    </div>
  );

  const SearchDropdown = ({ results, onSelect, color }: {
    results: PatientSummary[];
    onSelect: (p: PatientSummary) => void;
    color: 'green' | 'red';
  }) => {
    if (results.length === 0) return null;
    return (
      <ul className="mt-2 border rounded-lg divide-y max-h-60 overflow-y-auto bg-white shadow-sm">
        {results.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p)}
              className={`w-full text-left px-4 py-2.5 transition-colors ${color === 'green' ? 'hover:bg-green-50' : 'hover:bg-red-50'}`}
            >
              <span className="font-medium text-gray-900">{p.nev}</span>
              <span className="text-xs text-gray-500 ml-2">TAJ: {p.taj || '—'}</span>
              {p.szuletesiDatum && <span className="text-xs text-gray-500 ml-2">Szül.: {formatDate(p.szuletesiDatum)}</span>}
            </button>
          </li>
        ))}
      </ul>
    );
  };

  if (step === 'done') {
    return (
      <div className="text-center py-8">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Összevonás sikeres!</h3>
        <p className="text-gray-600 mb-2">{successMsg}</p>
        <p className="text-sm text-gray-500 mb-6">{mergedCount} profil lett egyesítve egyetlen páciensbe.</p>
        <button onClick={reset} className="btn-primary">
          Újabb összevonás
        </button>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div>
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-1">Figyelem! Ez a művelet nem visszavonható!</h3>
              <p className="text-sm text-amber-800">
                {secondaryPatients.length === 1 ? (
                  <>A <strong>„{secondaryPatients[0].nev}"</strong> páciens összes adata átkerül a <strong>„{primaryPatient?.nev}"</strong> pácienshez, majd a másodlagos profil törlésre kerül.</>
                ) : (
                  <><strong>{secondaryPatients.length} páciens profil</strong> összes adata ({secondaryPatients.map(p => `„${p.nev}"`).join(', ')}) átkerül a <strong>„{primaryPatient?.nev}"</strong> pácienshez, majd a duplikált profilok törlésre kerülnek.</>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-start mb-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-red-700 uppercase tracking-wide">
              Törlendő ({secondaryPatients.length} profil)
            </h4>
            {secondaryPatients.map((p, i) => (
              <PatientCard
                key={p.id}
                patient={p}
                label={`#${i + 1} törlendő`}
                color="red"
                onRemove={() => {
                  removeSecondary(p.id);
                  if (secondaryPatients.length <= 1) setStep('search');
                }}
                compact={secondaryPatients.length > 2}
              />
            ))}
          </div>
          <div className="flex justify-center pt-8">
            <ArrowRight className="w-8 h-8 text-gray-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-green-700 uppercase tracking-wide mb-3">
              Megmaradó (elsődleges)
            </h4>
            {primaryPatient && (
              <PatientCard
                patient={primaryPatient}
                label="Megmaradó"
                color="green"
                onRemove={() => { setPrimaryPatient(null); setStep('search'); }}
              />
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-3 mb-4 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={() => setStep('search')} className="btn-secondary" disabled={merging}>
            Vissza
          </button>
          <button
            onClick={handleMerge}
            disabled={merging}
            className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-6 rounded-lg transition-colors disabled:opacity-50"
          >
            {merging ? 'Összevonás folyamatban...' : `Végleges összevonás (${secondaryPatients.length} → 1)`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-6">
        Válaszd ki az <strong>elsődleges</strong> (megmaradó) pácienst, majd add hozzá az összes <strong>duplikált</strong> profilt.
        Az összevonáskor minden adat átkerül az elsődlegeshez, a duplikátumok törlésre kerülnek.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Primary patient */}
        <div>
          <label className="block text-sm font-semibold text-green-700 mb-2">
            Megmaradó páciens (elsődleges)
          </label>
          {primaryPatient ? (
            <PatientCard patient={primaryPatient} label="Megmaradó" color="green" onRemove={() => setPrimaryPatient(null)} />
          ) : (
            <div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchPrimary}
                  onChange={(e) => setSearchPrimary(e.target.value)}
                  placeholder="Keresés név, TAJ, telefon..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                />
              </div>
              <SearchDropdown
                results={resultsPrimary}
                onSelect={(p) => { setPrimaryPatient(p); setSearchPrimary(''); setResultsPrimary([]); }}
                color="green"
              />
            </div>
          )}
        </div>

        {/* Secondary patients */}
        <div>
          <label className="block text-sm font-semibold text-red-700 mb-2">
            Törlendő duplikátumok
            {secondaryPatients.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs bg-red-600 text-white rounded-full">
                {secondaryPatients.length}
              </span>
            )}
          </label>

          {secondaryPatients.length > 0 && (
            <div className="space-y-2 mb-3">
              {secondaryPatients.map((p) => (
                <div key={p.id} className="flex items-center gap-2 border border-red-300 bg-red-50 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900 text-sm">{p.nev}</span>
                    <span className="text-xs text-gray-500 ml-2">TAJ: {p.taj || '—'}</span>
                    {p.szuletesiDatum && <span className="text-xs text-gray-500 ml-2">Szül.: {formatDate(p.szuletesiDatum)}</span>}
                  </div>
                  <button
                    onClick={() => removeSecondary(p.id)}
                    className="text-red-400 hover:text-red-600 transition-colors shrink-0"
                    title="Eltávolítás"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="relative">
              <Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchSecondary}
                onChange={(e) => setSearchSecondary(e.target.value)}
                placeholder={secondaryPatients.length === 0 ? 'Keresés név, TAJ, telefon...' : 'Még egy duplikátum hozzáadása...'}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
              />
            </div>
            <SearchDropdown
              results={resultsSecondary}
              onSelect={addSecondary}
              color="red"
            />
          </div>
        </div>
      </div>

      {primaryPatient && secondaryPatients.length > 0 && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setStep('confirm')}
            className="btn-primary flex items-center gap-2"
          >
            <Users className="w-4 h-4" />
            Összevonás előnézet ({secondaryPatients.length} → 1)
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
