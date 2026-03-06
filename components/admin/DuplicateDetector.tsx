'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, ExternalLink, ArrowRight, Loader2 } from 'lucide-react';

interface PatientInfo {
  id: string;
  nev: string;
  taj: string;
  email: string;
  telefonszam: string;
  szuletesiDatum: string | null;
  createdAt: string;
  kezeleoorvos: string;
}

interface DuplicateGroup {
  reason: string;
  patients: PatientInfo[];
}

export function DuplicateDetector() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/admin/duplicate-patients', { credentials: 'include' });
      if (!res.ok) { setError('Hiba a duplikátumok lekérdezésekor'); return; }
      const data = await res.json();
      setGroups(data.duplicates || []);
      setLoaded(true);
    } catch {
      setError('Hálózati hiba');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQuickMerge = async (group: DuplicateGroup) => {
    const primary = group.patients[0];
    const secondaries = group.patients.slice(1);
    const key = primary.id;

    const names = secondaries.map(s => `„${s.nev}"`).join(', ');
    if (!window.confirm(
      `Összevonás: ${names} → „${primary.nev}" (legrégebbi profil).\n\nEz a művelet nem visszavonható! Folytatod?`
    )) return;

    setMerging(key);
    setError(null);

    try {
      const res = await fetch('/api/admin/merge-patients', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryPatientId: primary.id,
          secondaryPatientIds: secondaries.map(s => s.id),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const meta = data._errorMeta;
        const detail = meta ? ` [${meta.code || ''} ${meta.constraint || ''} ${meta.table || ''}]`.trim() : '';
        setError((data.error || 'Hiba az összevonás során') + detail);
        return;
      }

      setSuccessMsg(data.message);
      setGroups(prev => prev.filter(g => g.patients[0].id !== primary.id));
    } catch {
      setError('Hálózati hiba');
    } finally {
      setMerging(null);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('hu-HU'); } catch { return d; }
  };

  if (!loaded && !loading) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-gray-500 mb-4">Ellenőrizd, vannak-e duplikált páciens profilok az adatbázisban.</p>
        <button onClick={load} className="btn-primary flex items-center gap-2 mx-auto">
          <RefreshCw className="w-4 h-4" />
          Duplikátumok keresése
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 text-medical-primary animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Duplikátumok keresése...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">
          {groups.length === 0
            ? 'Nem találtunk gyanús duplikátumokat.'
            : `${groups.length} gyanús duplikátum csoport találva.`}
        </p>
        <button onClick={load} className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Frissítés
        </button>
      </div>

      {successMsg && (
        <div className="bg-green-50 border border-green-300 rounded-lg p-3 mb-4 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-3 mb-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {groups.length === 0 && !error && (
        <div className="text-center py-6">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">Nincs duplikátum!</p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((group, gi) => {
          const primary = group.patients[0];
          const secondaries = group.patients.slice(1);
          const isMerging = merging === primary.id;

          return (
            <div key={`${gi}-${primary.id}`} className="border border-amber-300 rounded-lg bg-amber-50/50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-amber-100/60 border-b border-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-900">{group.reason}</span>
                  <span className="text-xs text-amber-700 bg-amber-200 rounded-full px-2 py-0.5">{group.patients.length} profil</span>
                </div>
                <button
                  onClick={() => handleQuickMerge(group)}
                  disabled={isMerging}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isMerging ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Összevonás...</>
                  ) : (
                    <><ArrowRight className="w-3.5 h-3.5" /> Összevonás ({secondaries.length} → 1)</>
                  )}
                </button>
              </div>

              <div className="divide-y divide-amber-200">
                {group.patients.map((p, pi) => (
                  <div key={p.id} className={`flex items-center gap-4 px-4 py-2.5 text-sm ${pi === 0 ? 'bg-green-50/50' : ''}`}>
                    <span className={`text-xs font-bold uppercase tracking-wide w-20 shrink-0 ${pi === 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {pi === 0 ? 'Megmarad' : 'Törlendő'}
                    </span>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-0.5">
                      <span className="font-semibold text-gray-900">{p.nev}</span>
                      {p.taj && <span className="text-gray-500">TAJ: {p.taj}</span>}
                      {p.szuletesiDatum && <span className="text-gray-500">Szül.: {formatDate(p.szuletesiDatum)}</span>}
                      {p.telefonszam && <span className="text-gray-500">Tel.: {p.telefonszam}</span>}
                      {p.kezeleoorvos && <span className="text-gray-500">Orvos: {p.kezeleoorvos}</span>}
                      <span className="text-gray-400 text-xs">Rögzítve: {formatDate(p.createdAt)}</span>
                    </div>
                    <a
                      href={`/patients/${p.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-medical-primary hover:text-medical-primary-dark shrink-0"
                      title="Profil megnyitása"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
