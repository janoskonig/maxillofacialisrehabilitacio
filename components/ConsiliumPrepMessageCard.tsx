'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  ExternalLink,
  Image as ImageIcon,
  Lock,
  Stethoscope,
  Users,
} from 'lucide-react';

type PreviewPatient = {
  id: string | null;
  name: string | null;
  taj: string | null;
  birthYear: number | null;
  age: number | null;
  diagnozis: string | null;
  missing: boolean;
};

type PreviewResponse =
  | {
      accessible: false;
      reason: 'invalid_token' | 'revoked_or_not_found';
    }
  | {
      accessible: true;
      sessionId: string;
      sessionTitle: string;
      sessionScheduledAt: string;
      sessionStatus: 'draft' | 'active' | 'closed';
      itemId: string;
      patient: PreviewPatient;
      mediaCounts: { opImageCount: number; photoImageCount: number };
    };

interface ConsiliumPrepMessageCardProps {
  token: string;
}

function formatHuDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('hu-HU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: 'draft' | 'active' | 'closed'): string {
  if (status === 'active') return 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700';
  if (status === 'closed') return 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700';
  return 'bg-cyan-100 dark:bg-cyan-950/50 text-cyan-800 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700';
}

function statusLabelHu(status: 'draft' | 'active' | 'closed'): string {
  if (status === 'active') return 'Aktív';
  if (status === 'closed') return 'Lezárt';
  return 'Előkészítés';
}

export function ConsiliumPrepMessageCard({ token }: ConsiliumPrepMessageCardProps) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNetworkError(false);
    fetch(`/api/consilium/prep/${encodeURIComponent(token)}/preview`, {
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`status_${res.status}`);
        }
        return res.json() as Promise<PreviewResponse>;
      })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setNetworkError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const prepHref = `/consilium/prep/${encodeURIComponent(token)}`;

  if (loading) {
    return (
      <div className="my-2 rounded-lg border border-cyan-200 dark:border-cyan-800 bg-cyan-50/70 dark:bg-cyan-950/40 p-3 max-w-md">
        <div className="flex items-center gap-2 text-sm text-cyan-900/80 dark:text-cyan-200">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-cyan-600 border-t-transparent" />
          <span>Konzílium előkészítő betöltése…</span>
        </div>
      </div>
    );
  }

  if (networkError || !preview) {
    return (
      <div className="my-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 max-w-md">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Konzílium előkészítő</p>
        <p className="text-xs text-amber-800/80 dark:text-amber-300 mt-1">
          Az előnézet betöltése sikertelen. Próbáld megnyitni a linket közvetlenül.
        </p>
        <a
          href={prepHref}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 hover:text-amber-700"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Megnyitás
        </a>
      </div>
    );
  }

  if (!preview.accessible) {
    const title = 'Konzílium előkészítő';
    const body =
      preview.reason === 'revoked_or_not_found'
        ? 'Az előkészítő linket visszavonták, vagy az alkalom időközben megszűnt.'
        : 'Érvénytelen előkészítő link.';
    return (
      <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3 max-w-md">
        <div className="flex items-start gap-2">
          <div className="p-1.5 bg-gray-200 dark:bg-gray-800 rounded-md text-gray-700 dark:text-gray-300 flex-shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{body}</p>
          </div>
        </div>
      </div>
    );
  }

  const patientLine = (() => {
    const parts: string[] = [];
    if (preview.patient.taj) parts.push(`TAJ ${preview.patient.taj}`);
    if (typeof preview.patient.age === 'number') {
      const ageBit = preview.patient.birthYear
        ? `${preview.patient.age} éves (szül.: ${preview.patient.birthYear})`
        : `${preview.patient.age} éves`;
      parts.push(ageBit);
    } else if (preview.patient.birthYear) {
      parts.push(`szül.: ${preview.patient.birthYear}`);
    }
    return parts.join(' · ');
  })();

  return (
    <div className="my-2 rounded-lg border-2 border-cyan-300 dark:border-cyan-700 bg-gradient-to-br from-cyan-50 via-white to-cyan-50/40 shadow-sm overflow-hidden max-w-md">
      <div className="px-3 pt-2.5 pb-2 border-b border-cyan-200/80 dark:border-cyan-800 bg-cyan-100/40 dark:bg-cyan-950/50 flex items-center gap-2 flex-wrap">
        <Users className="w-4 h-4 text-cyan-800 dark:text-cyan-300 flex-shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-cyan-900/80 dark:text-cyan-200">
          Konzílium előkészítő
        </span>
        <span
          className={`ml-auto inline-block text-[10px] font-medium border rounded px-1.5 py-0.5 ${statusBadgeClass(
            preview.sessionStatus,
          )}`}
        >
          {statusLabelHu(preview.sessionStatus)}
        </span>
      </div>

      <div className="px-3 py-3 space-y-2.5">
        <div>
          <p className="text-[11px] font-medium text-cyan-900/70 dark:text-cyan-200 truncate">
            {preview.sessionTitle}
          </p>
          <p className="text-[10px] text-cyan-900/60 dark:text-cyan-300 mt-0.5 inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatHuDateTime(preview.sessionScheduledAt)}
          </p>
        </div>

        <div className="border-t border-cyan-200/60 dark:border-cyan-800 pt-2">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {preview.patient.missing
              ? 'Beteg rekord nem elérhető'
              : preview.patient.name || 'Névtelen beteg'}
          </p>
          {patientLine && (
            <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">{patientLine}</p>
          )}
          {preview.patient.diagnozis && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300 mt-1 line-clamp-2 inline-flex items-start gap-1">
              <Stethoscope className="w-3 h-3 mt-0.5 flex-shrink-0 text-cyan-700 dark:text-cyan-300" />
              <span>{preview.patient.diagnozis}</span>
            </p>
          )}
        </div>

        {(preview.mediaCounts.opImageCount > 0 || preview.mediaCounts.photoImageCount > 0) && (
          <div className="flex items-center gap-3 text-[11px] text-gray-600 dark:text-gray-400">
            {preview.mediaCounts.opImageCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="w-3 h-3" />
                {preview.mediaCounts.opImageCount} OP
              </span>
            )}
            {preview.mediaCounts.photoImageCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="w-3 h-3" />
                {preview.mediaCounts.photoImageCount} fotó
              </span>
            )}
          </div>
        )}

        <Link
          href={prepHref}
          className="inline-flex items-center justify-center gap-1.5 mt-1 w-full text-xs font-medium text-white bg-cyan-700 hover:bg-cyan-800 rounded-md px-3 py-1.5 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Előkészítő megnyitása
        </Link>
      </div>
    </div>
  );
}
