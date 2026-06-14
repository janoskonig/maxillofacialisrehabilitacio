import type { ReactNode } from 'react';

export type BadgeTone = 'primary' | 'success' | 'warning' | 'error' | 'gray';

const TONE_CLASS: Record<BadgeTone, string> = {
  primary: 'badge-primary',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  gray: 'badge-gray',
};

interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

/**
 * Egységes badge a globals.css .badge-* osztályok fölött. A medical.* tokeneket
 * használja — ez a hely, ahol a korábban ad-hoc (green-100/amber-100) badge-eket
 * a paletta szerinti tónusra váltjuk.
 */
export function Badge({ tone = 'gray', className = '', children }: BadgeProps) {
  return <span className={`badge ${TONE_CLASS[tone]} ${className}`.trim()}>{children}</span>;
}
