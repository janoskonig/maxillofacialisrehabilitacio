import type { LucideIcon } from 'lucide-react';

export type StatTone = 'primary' | 'success' | 'warning' | 'error' | 'neutral';

interface StatCardProps {
  label: string;
  value: string | number;
  /** Kis kiegészítő sor az érték alatt (pl. „3 hátravan"). */
  delta?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  className?: string;
}

// A bal akcentcsík + ikon-háttér tónusai a medical.* / Tailwind tokenekből,
// dark-mode variánsokkal — a .card osztály fölött.
const ACCENT: Record<StatTone, string> = {
  primary: 'bg-medical-primary',
  success: 'bg-medical-success',
  warning: 'bg-medical-warning',
  error: 'bg-medical-error',
  neutral: 'bg-gray-400 dark:bg-gray-600',
};

const ICON_WRAP: Record<StatTone, string> = {
  primary: 'bg-medical-primary/10 text-medical-primary',
  success: 'bg-medical-success/10 text-medical-success',
  warning: 'bg-medical-warning/10 text-medical-warning',
  error: 'bg-medical-error/10 text-medical-error',
  neutral: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

const DELTA_COLOR: Record<StatTone, string> = {
  primary: 'text-medical-primary',
  success: 'text-medical-success',
  warning: 'text-medical-warning',
  error: 'text-medical-error',
  neutral: 'text-gray-500 dark:text-gray-400',
};

/**
 * KPI-kártya (label + nagy érték + opcionális delta/ikon). A showcase `statCards`
 * megfelelője az éles design-rendszerben. Használja: Mai időpontok, Várakozás.
 */
export function StatCard({ label, value, delta, icon: Icon, tone = 'primary', className = '' }: StatCardProps) {
  return (
    <div className={`card relative overflow-hidden !p-4 ${className}`.trim()}>
      <span className={`absolute left-0 top-0 h-full w-1 ${ACCENT[tone]}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-gray-500 dark:text-gray-400 truncate">{label}</p>
          <p className="mt-1 text-2xl md:text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-50 leading-none">
            {value}
          </p>
          {delta && <p className={`mt-1.5 text-xs font-medium ${DELTA_COLOR[tone]}`}>{delta}</p>}
        </div>
        {Icon && (
          <div className={`flex-shrink-0 p-2 rounded-lg ${ICON_WRAP[tone]}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}
