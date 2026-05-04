'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { TimelineEpisode, TimelineStep } from './types';
import { STATUS_CONFIG, STATUS_DOT } from './constants';
import { buildWorklistUrl } from '@/lib/build-worklist-url';

export interface StepPopoverProps {
  open: boolean;
  step: TimelineStep | null;
  episode: TimelineEpisode | null;
  isMobile: boolean;
  onClose: () => void;
}

export function StepPopover({ open, step, episode, isMobile, onClose }: StepPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const first = panelRef.current.querySelector<HTMLElement>('button, a');
    first?.focus();
  }, [open, step?.stepSeq]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  if (!open || !step || !episode) return null;

  const cfg = STATUS_CONFIG[step.status];
  const worklistHref = buildWorklistUrl(episode.episodeId, step.stepCode, step.pool || 'work');
  const showBook = step.status === 'booked';
  const showBookIntent = step.status === 'planned';

  const body = (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-2 mb-2">
        <div>
          <div className="font-semibold text-gray-900 text-sm">{step.label}</div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-600">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_DOT[step.status] }} />
            {cfg.label}
          </div>
        </div>
        <button
          type="button"
          className="p-1 rounded hover:bg-gray-100 text-gray-500"
          aria-label="Bezárás"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="text-xs text-gray-600 space-y-1 mb-3">
        <div>
          Pool: <span className="font-medium text-gray-800">{step.pool}</span> · {step.durationMinutes} perc
        </div>
        {step.windowStart && (
          <div>
            Ablak: {new Date(step.windowStart).toLocaleDateString('hu-HU')}
            {step.windowEnd && ` – ${new Date(step.windowEnd).toLocaleDateString('hu-HU')}`}
          </div>
        )}
        {step.appointmentStart && (
          <div>
            Időpont:{' '}
            {new Date(step.appointmentStart).toLocaleString('hu-HU', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Link
          href={`/patients/${episode.patientId}/view`}
          className="btn-secondary text-center text-sm py-2"
          onClick={onClose}
        >
          Beteg megnyitása
        </Link>
        {showBook && (
          <Link
            href={`/patients/${episode.patientId}/view`}
            className="btn-secondary text-center text-sm py-2"
            onClick={onClose}
          >
            Időpont / epizód megnyitása
          </Link>
        )}
        {showBookIntent && (
          <Link href={worklistHref} className="btn-primary text-center text-sm py-2" onClick={onClose}>
            Foglalás ebbe az ablakba (munkalista)
          </Link>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40"
        role="presentation"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tp-pop-title"
          className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
          onClick={(e) => e.stopPropagation()}
        >
          <div id="tp-pop-title" className="sr-only">
            Lépés részletei
          </div>
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      className="fixed z-[100] w-[min(100vw-2rem,22rem)] rounded-xl border border-gray-200 bg-white shadow-xl p-4"
      style={{
        top: 'min(12rem, 20vh)',
        right: '1rem',
      }}
    >
      {body}
    </div>
  );
}
