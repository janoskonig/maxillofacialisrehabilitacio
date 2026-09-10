'use client';

import { FolderPlus, Send, User, X } from 'lucide-react';
import { MobileBottomSheet } from '@/components/mobile/MobileBottomSheet';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { ChatImageTarget } from '@/lib/messaging/chat-image-upload';
import { PatientQuickSearch } from './PatientQuickSearch';

export interface SuggestedPatient {
  id: string;
  nev: string;
  taj?: string | null;
}

interface Props {
  isOpen: boolean;
  /** Hány képről dönt a felhasználó (a szöveg egyes/többes száma miatt). */
  imageCount: number;
  /** Gyors választás: a szerkesztőben felismert / megerősített betegek. */
  suggestedPatients?: SuggestedPatient[];
  /** Beteg-dokumentum feltöltésre jogosult szerepkör (admin, fogpótlástanász, beutaló orvos). */
  canSaveToPatient: boolean;
  onCancel: () => void;
  onChoose: (target: ChatImageTarget) => void;
}

/**
 * Orvos–orvos chat: küldés előtt megkérdezzük, hogy a kép egy beteg
 * dokumentumai közé is kerüljön-e (címke: chat), vagy csak az üzenetben
 * legyen elérhető.
 */
export function ChatImageSaveTargetDialog({
  isOpen,
  imageCount,
  suggestedPatients = [],
  canSaveToPatient,
  onCancel,
  onChoose,
}: Props) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const plural = imageCount > 1;
  const title = plural ? 'Képek mentése beteghez?' : 'Kép mentése beteghez?';

  if (!isOpen) return null;

  const body = (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {plural
          ? 'A képek elküldés előtt egy beteg dokumentumai közé is menthetők (címke: chat), így később a beteg kartonján is megtalálhatók.'
          : 'A kép elküldés előtt egy beteg dokumentumai közé is menthető (címke: chat), így később a beteg kartonján is megtalálható.'}
      </p>

      {canSaveToPatient ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
            <FolderPlus className="w-4 h-4 text-blue-600 dark:text-blue-300" />
            Mentés beteghez
          </div>
          {suggestedPatients.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestedPatients.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onChoose({ kind: 'patient-document', patientId: p.id, patientName: p.nev })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                >
                  <User className="w-3 h-3" />
                  {p.nev}
                  {p.taj ? <span className="opacity-60">· {p.taj}</span> : null}
                </button>
              ))}
            </div>
          )}
          <PatientQuickSearch
            autoFocus={!isMobile}
            onSelect={(p) =>
              onChoose({ kind: 'patient-document', patientId: p.id, patientName: p.nev ?? null })
            }
          />
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Az Ön szerepköre nem tölthet fel beteg-dokumentumot — a kép csak az üzenetben lesz elérhető.
        </p>
      )}

      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-1 border-t border-gray-100 dark:border-gray-800">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Mégse
        </button>
        <button
          type="button"
          onClick={() => onChoose({ kind: 'doctor-attachment' })}
          className="btn-primary inline-flex items-center justify-center gap-1.5"
        >
          <Send className="w-4 h-4" />
          {canSaveToPatient ? 'Küldés mentés nélkül' : 'Küldés'}
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <MobileBottomSheet open={isOpen} onOpenChange={(open) => !open && onCancel()} title={title}>
        {body}
      </MobileBottomSheet>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-image-save-target-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 id="chat-image-save-target-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Bezárás"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{body}</div>
      </div>
    </div>
  );
}
