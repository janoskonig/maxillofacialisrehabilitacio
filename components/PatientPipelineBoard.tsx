'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Users, Clock, AlertCircle, RefreshCw } from 'lucide-react';

interface PipelinePatient {
  patientId: string;
  patientName: string;
  since: string;
}

interface PipelineColumn {
  id: string;
  label: string;
  patients: PipelinePatient[];
}

function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return 'ma';
  if (days === 1) return '1 napja';
  if (days < 30) return `${days} napja`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 hónapja';
  return `${months} hónapja`;
}

const COLUMN_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  STAGE_0: { bg: 'bg-blue-50', border: 'border-blue-300', badge: 'bg-blue-500' },
  STAGE_1: { bg: 'bg-indigo-50', border: 'border-indigo-300', badge: 'bg-indigo-500' },
  STAGE_2: { bg: 'bg-violet-50', border: 'border-violet-300', badge: 'bg-violet-500' },
  STAGE_3: { bg: 'bg-purple-50', border: 'border-purple-300', badge: 'bg-purple-500' },
  STAGE_4: { bg: 'bg-fuchsia-50', border: 'border-fuchsia-300', badge: 'bg-fuchsia-500' },
};

const DEFAULT_COLOR = { bg: 'bg-gray-50', border: 'border-gray-300', badge: 'bg-gray-500' };

export function PatientPipelineBoard() {
  const [columns, setColumns] = useState<PipelineColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/dashboard/patient-pipeline', { credentials: 'include' });
      if (!res.ok) throw new Error('Hiba a beteg pipeline betöltésekor');
      const json = await res.json();
      setColumns(json.columns ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ismeretlen hiba');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPatients = columns.reduce((sum, col) => sum + col.patients.length, 0);

  if (loading && columns.length === 0) {
    return (
      <div className="card flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary" />
        <span className="ml-3 text-body-sm">Pipeline betöltése...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-medical-error/20 bg-medical-error/5">
        <div className="flex items-center justify-center gap-2 py-6">
          <AlertCircle className="w-5 h-5 text-medical-error" />
          <p className="text-medical-error font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Beteg előkészítés pipeline &mdash; <span className="font-medium">{totalPatients}</span> beteg összesen
        </p>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-medical-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Frissítés
        </button>
      </div>

      {/* Kanban board */}
      <div className="overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          {columns.map((col) => {
            const colors = COLUMN_COLORS[col.id] ?? DEFAULT_COLOR;
            return (
              <div
                key={col.id}
                className={`flex flex-col w-[260px] sm:w-[280px] flex-shrink-0 snap-start rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-inherit">
                  <h3 className="text-sm font-semibold text-gray-800 truncate">{col.label}</h3>
                  <span className={`${colors.badge} text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[24px] text-center`}>
                    {col.patients.length}
                  </span>
                </div>

                {/* Cards container */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[60vh] min-h-[120px]">
                  {col.patients.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <Users className="w-8 h-8 text-gray-300 mb-2" />
                      <p className="text-xs text-gray-400">Nincs beteg</p>
                    </div>
                  ) : (
                    col.patients.map((patient) => (
                      <Link
                        key={patient.patientId}
                        href={`/patients/${patient.patientId}/view`}
                        className="block bg-white rounded-lg border border-gray-200 p-3 shadow-sm hover:shadow-md hover:border-medical-primary/40 transition-all duration-150 cursor-pointer group"
                      >
                        <p className="text-sm font-medium text-gray-900 group-hover:text-medical-primary truncate">
                          {patient.patientName}
                        </p>
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-500">
                          <Clock className="w-3 h-3" />
                          <span>{timeAgo(patient.since)}</span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
