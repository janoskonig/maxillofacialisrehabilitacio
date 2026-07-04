'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Calendar, MessageCircle, AlertTriangle } from 'lucide-react';

interface ReferredPatient {
  id: string;
  nev: string | null;
  stageCode: string | null;
  stageLabel: string | null;
  nextAppointmentAt: string | null;
  nextAppointmentDentist: string | null;
  unreadMessages: number;
}

/**
 * „Beutalt betegeim” — a beutaló orvos főoldali panelje: a saját beutalt
 * betegei, aktuális stádiummal, következő időponttal és olvasatlan
 * beteg-üzenet jelzéssel. A „hol tart a betegem?” kérdésre válaszol
 * belépés után azonnal, külön navigáció nélkül.
 */
export function ReferredPatientsPanel() {
  const [patients, setPatients] = useState<ReferredPatient[]>([]);
  const [missingDoctorName, setMissingDoctorName] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/referring-doctor/my-patients', { credentials: 'include', signal: ac.signal })
      .then(async res => {
        if (!res.ok) throw new Error('Hiba a betegek betöltésekor');
        return res.json();
      })
      .then(data => {
        setPatients(Array.isArray(data.patients) ? data.patients : []);
        setMissingDoctorName(!!data.missingDoctorName);
      })
      .catch(e => {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('hu-HU', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Budapest',
    });

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1">
        <Users className="w-5 h-5 text-medical-primary" aria-hidden="true" />
        Beutalt betegeim
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Az Ön által beutalt betegek aktuális állapota.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Betöltés...</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400 py-2">{error}</p>
      ) : missingDoctorName ? (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            A fiókjához nincs orvosnév rögzítve, ezért a beutalt betegei nem azonosíthatók. Kérjük,
            jelezze az adminisztrációnak.
          </p>
        </div>
      ) : patients.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
          Jelenleg nincs Önhöz rendelt beutalt beteg.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                <th className="py-2 pr-4 font-medium">Beteg</th>
                <th className="py-2 pr-4 font-medium">Stádium</th>
                <th className="py-2 pr-4 font-medium">Következő időpont</th>
                <th className="py-2 font-medium text-right">Üzenet</th>
              </tr>
            </thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800/60">
                  <td className="py-2.5 pr-4">
                    <Link
                      href={`/patients/${p.id}/view`}
                      className="font-medium text-medical-primary hover:underline"
                    >
                      {p.nev || 'Név nélküli beteg'}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300">
                    {p.stageLabel || p.stageCode || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300">
                    {p.nextAppointmentAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
                        {formatDate(p.nextAppointmentAt)}
                        {p.nextAppointmentDentist && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({p.nextAppointmentDentist})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400">nincs</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {p.unreadMessages > 0 ? (
                      <Link
                        href={`/messages?patient=${p.id}`}
                        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 font-medium hover:underline"
                        aria-label={`${p.unreadMessages} olvasatlan üzenet — ${p.nev || 'beteg'}`}
                      >
                        <MessageCircle className="w-4 h-4" aria-hidden="true" />
                        {p.unreadMessages}
                      </Link>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
