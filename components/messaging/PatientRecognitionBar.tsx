'use client';

import { useEffect, useRef, useState } from 'react';
import { UserPlus, X, Check } from 'lucide-react';
import type { PatientDetection } from '@/lib/patient-name-recognition';

/** Egy megerősített (üzenethez kötött) beteg. */
export interface RecognizedPatient {
  id: string;
  nev: string;
  taj?: string | null;
}

interface PatientRecognitionBarProps {
  /** Az aktuális szerkesztett üzenet szövege. */
  text: string;
  /** A felhasználó által eddig megerősített betegek. */
  confirmed: RecognizedPatient[];
  /** Egy beteg megerősítése (hozzákötés az üzenethez). */
  onConfirm: (patient: RecognizedPatient) => void;
  /** Megerősített beteg eltávolítása. */
  onRemove: (patientId: string) => void;
}

const DEBOUNCE_MS = 400;

function detectionKey(d: PatientDetection): string {
  return `${d.kind}:${d.candidates.map((c) => c.id).sort().join(',')}`;
}

/**
 * Automatikus beteg-felismerés megerősítő sávja. A szabad szövegben felismert
 * betegeket ("Megbeszéltem Kovács Jánossal…") jeleníti meg; a felhasználó egy
 * koppintással hozzáköti őket az üzenethez (a klinikai adat miatt sosem köt
 * automatikusan). Azonos nevű betegeknél a TAJ alapján lehet egyértelműsíteni.
 */
export function PatientRecognitionBar({
  text,
  confirmed,
  onConfirm,
  onRemove,
}: PatientRecognitionBarProps) {
  const [detections, setDetections] = useState<PatientDetection[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  // Debounce-olt felismerés a szöveg változására.
  useEffect(() => {
    if (!text.trim()) {
      setDetections([]);
      setDismissed(new Set());
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch('/api/patients/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        setDetections(data.detections || []);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Beteg-felismerés hiba:', err);
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [text]);

  const confirmedIds = new Set(confirmed.map((p) => p.id));

  // Megjeleníthető javaslatok: nincs még megerősítve és nincs elvetve.
  const suggestions = detections.filter((d) => {
    if (dismissed.has(detectionKey(d))) return false;
    return !d.candidates.every((c) => confirmedIds.has(c.id));
  });

  if (suggestions.length === 0 && confirmed.length === 0) {
    return null;
  }

  const dismiss = (d: PatientDetection) => {
    setDismissed((prev) => new Set(prev).add(detectionKey(d)));
  };

  return (
    <div className="px-3 pt-2 flex flex-wrap items-center gap-1.5">
      {/* Megerősített betegek — eltávolítható, kék chip. */}
      {confirmed.map((p) => (
        <span
          key={p.id}
          className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 text-xs font-medium"
        >
          <Check className="w-3 h-3" />
          {p.nev}
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            aria-label={`${p.nev} hivatkozás eltávolítása`}
            className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}

      {/* Felismert, még meg nem erősített betegek. */}
      {suggestions.map((d) => {
        const key = detectionKey(d);
        if (d.ambiguous) {
          return (
            <span key={key} className="inline-flex items-center gap-1 flex-wrap text-xs text-gray-600 dark:text-gray-400">
              <span className="opacity-80">Melyik beteg?</span>
              {d.candidates
                .filter((c) => !confirmedIds.has(c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onConfirm(c)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                  >
                    <UserPlus className="w-3 h-3" />
                    {c.nev}
                    {c.taj ? <span className="opacity-60">· {c.taj}</span> : null}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => dismiss(d)}
                aria-label="Javaslat elvetése"
                className="p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        }

        const c = d.candidates[0];
        return (
          <span key={key} className="inline-flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => onConfirm(c)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 font-medium"
            >
              <UserPlus className="w-3 h-3" />
              {c.nev} hivatkozása
            </button>
            <button
              type="button"
              onClick={() => dismiss(d)}
              aria-label="Javaslat elvetése"
              className="p-0.5 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
