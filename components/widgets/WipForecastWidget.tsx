'use client';

import { useState, useEffect } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { TrendingUp, User } from 'lucide-react';

interface DoctorWipForecast {
  providerId: string | null;
  providerName: string | null;
  providerEmail: string | null;
  wipCount: number;
  wipCompletionP50Max: string | null;
  wipCompletionP80Max: string | null;
  wipVisitsRemainingP50Sum: number;
  wipVisitsRemainingP80Sum: number;
}

interface AggregateData {
  wipCount: number;
  wipCompletionP50Max: string | null;
  wipCompletionP80Max: string | null;
  wipVisitsRemainingP50Sum: number;
  wipVisitsRemainingP80Sum: number;
  byDoctor: DoctorWipForecast[];
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}.${day}`;
}

function doctorDisplayName(doc: DoctorWipForecast): string {
  if (doc.providerName) return doc.providerName;
  if (doc.providerEmail) return doc.providerEmail.split('@')[0];
  return 'Nem hozzárendelt';
}

export function WipForecastWidget() {
  const [data, setData] = useState<AggregateData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/forecast/aggregate?horizonDays=120', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <DashboardWidget title="Aktív kezelések prognózisa" icon={<TrendingUp className="w-5 h-5" />}>
        <div className="text-center py-4 text-gray-500 text-sm">Betöltés...</div>
      </DashboardWidget>
    );
  }

  if (!data) {
    return (
      <DashboardWidget title="Aktív kezelések prognózisa" icon={<TrendingUp className="w-5 h-5" />}>
        <div className="text-center py-4 text-gray-500 text-sm">Nem elérhető</div>
      </DashboardWidget>
    );
  }

  const doctors = data.byDoctor ?? [];
  const hasDoctors = doctors.length > 0;

  return (
    <DashboardWidget title="Aktív kezelések prognózisa" icon={<TrendingUp className="w-5 h-5" />}>
      <div className="space-y-3">
        {hasDoctors ? (
          <>
            <div className="space-y-2">
              {doctors.map((doc) => (
                <div key={doc.providerId ?? '__unassigned__'} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                  <div className="flex items-center gap-2 mb-1.5">
                    <User className="w-3.5 h-3.5 text-medical-primary flex-shrink-0" />
                    <span className="text-sm font-semibold text-gray-900 truncate">{doctorDisplayName(doc)}</span>
                    <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">{doc.wipCount} epizód</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <span className="text-gray-500">Kifutás: </span>
                      <span className="font-medium text-gray-800">
                        {doc.wipCompletionP50Max ? `~${formatShortDate(doc.wipCompletionP50Max)}` : '–'}
                      </span>
                      {doc.wipCompletionP80Max && (
                        <span className="text-gray-400 ml-1">
                          (P80 ~{formatShortDate(doc.wipCompletionP80Max)})
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500">Hátralévő: </span>
                      <span className="font-medium text-gray-800">
                        {doc.wipVisitsRemainingP50Sum} látogatás
                      </span>
                      {doc.wipVisitsRemainingP80Sum !== doc.wipVisitsRemainingP50Sum && (
                        <span className="text-gray-400 ml-1">
                          (P80: {doc.wipVisitsRemainingP80Sum})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-gray-500 pt-1 border-t border-gray-100">
              Összesen {data.wipCount} aktív kezelés
              {data.wipCompletionP80Max && (
                <> · legkésőbb ~{formatShortDate(data.wipCompletionP80Max)}</>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-500">Nincs folyamatban lévő kezelés</div>
        )}
      </div>
    </DashboardWidget>
  );
}
