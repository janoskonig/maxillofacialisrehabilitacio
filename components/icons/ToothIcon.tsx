import type { SVGProps } from 'react';

/**
 * Fog ikon (lucide-stílusú, stroke alapú, currentColor) — fogorvosi
 * kontextusban ezzel jelöljük a kezelő-/felelős orvost a fonendoszkóp helyett.
 * Drop-in csere a lucide `Stethoscope` ikonra: ugyanúgy fogad `className`-t
 * és minden SVG propot.
 */
export function ToothIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M12 5.5c-1.074 -1.265 -2.92 -2.5 -5 -2.5c-3.5 0 -5 2.5 -5 5c0 2.5 1 4 2 6c.5 1 1 4 1.5 5.5c.5 1.5 1.5 1.5 2 0c.5 -1.5 1 -2.5 1.5 -2.5s1 1 1.5 2.5c.5 1.5 1.5 1.5 2 0c.5 -1.5 1 -4.5 1.5 -5.5c1 -2 2 -3.5 2 -6c0 -2.5 -1.5 -5 -5 -5c-2.08 0 -3.926 1.235 -5 2.5z" />
    </svg>
  );
}
