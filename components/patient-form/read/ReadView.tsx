'use client';

import { ReactNode } from 'react';
import { AlertTriangle, AlertCircle, Pencil, Check } from 'lucide-react';

/**
 * Olvasó-nézet segédek a betegkarton form-szekcióihoz.
 * A szekciók alapból olvasó-nézetet mutatnak (címke–érték párok), és egy
 * „Szerkesztés" gombbal váltanak a meglévő beviteli mezőkre. A hiányzó adatok
 * feltűnően jelennek meg (borostyán / kötelezőnél piros kiemelés).
 */

export function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

interface ReadFieldProps {
  label: string;
  value?: ReactNode;
  /** Üres-e az érték (hiányzó adat). Ha nincs megadva, a `value` ürességéből számoljuk. */
  missing?: boolean;
  required?: boolean;
  /** Teljes sor szélességben (pl. hosszú szöveg). */
  full?: boolean;
  /** Link-szerű érték (telefon/email) kiemelése. */
  accent?: boolean;
}

export function ReadField({ label, value, missing, required, full, accent }: ReadFieldProps) {
  const isMissing = missing ?? isEmptyValue(value);

  return (
    <div
      className={[
        full ? 'sm:col-span-2' : '',
        'px-2.5 py-2 rounded-md',
        isMissing
          ? required
            ? 'bg-red-50 dark:bg-red-900/20'
            : 'bg-amber-50 dark:bg-amber-900/20'
          : '',
      ].join(' ')}
    >
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </div>
      {isMissing ? (
        required ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
            <AlertCircle className="w-3 h-3" />
            Kötelező – hiányzik
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            <AlertTriangle className="w-3 h-3" />
            Hiányzik
          </span>
        )
      ) : (
        <div
          className={`text-sm ${accent ? 'text-medical-primary' : 'text-gray-900 dark:text-gray-100'}`}
        >
          {value}
        </div>
      )}
    </div>
  );
}

export function ReadGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">{children}</div>;
}

interface SectionShellProps {
  id: string;
  title: string;
  icon?: ReactNode;
  /** Hiányzó adatok száma a szekcióban (badge a fejlécen). */
  missingCount?: number;
  editing: boolean;
  onToggleEdit: () => void;
  /** View-only módban nincs szerkesztés gomb. */
  isViewOnly?: boolean;
  children: ReactNode;
}

export function SectionShell({
  id,
  title,
  icon,
  missingCount = 0,
  editing,
  onToggleEdit,
  isViewOnly,
  children,
}: SectionShellProps) {
  return (
    <div id={`section-${id}`} className="card scroll-mt-20 sm:scroll-mt-24">
      <div className="flex items-center gap-2 mb-4">
        {icon && <span className="text-medical-primary">{icon}</span>}
        <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
        {!editing && missingCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            <AlertTriangle className="w-3 h-3" />
            {missingCount} hiányzó
          </span>
        )}
        {!isViewOnly && (
          <button
            type="button"
            onClick={onToggleEdit}
            className="ml-auto inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 transition-colors"
          >
            {editing ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Kész
              </>
            ) : (
              <>
                <Pencil className="w-3.5 h-3.5" />
                Szerkesztés
              </>
            )}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
