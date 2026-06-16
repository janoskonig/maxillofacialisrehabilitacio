'use client';

import { ToothConditions } from './tooth-conditions';
import { ToothShape } from './ToothShape';

interface ToothProps {
  fdi: number | string;
  conditions: ToothConditions;
  size?: number;
  selected?: boolean;
  showNumber?: boolean;
  numberPosition?: 'below' | 'above';
  onClick?: () => void;
  title?: string;
}

/**
 * Önálló fog (jelmagyarázat, szerkesztő-fejléc). Az ívek rajzolása
 * az Odontogram-ban egyetlen közös SVG-be komponálva történik (ToothShape).
 */
export function Tooth({
  fdi,
  conditions,
  size = 26,
  selected = false,
  showNumber = true,
  numberPosition = 'below',
  onClick,
  title,
}: ToothProps) {
  const interactive = !!onClick;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      {showNumber && numberPosition === 'above' && (
        <span className="text-[9.5px] leading-none mb-0.5 text-gray-400 dark:text-gray-500">{fdi}</span>
      )}
      <svg
        width={size}
        height={size * 1.46}
        viewBox="0 0 28 40"
        onClick={onClick}
        role={interactive ? 'button' : 'img'}
        aria-label={title || `${fdi} fog`}
        className={interactive ? 'cursor-pointer' : ''}
      >
        {title && <title>{title}</title>}
        {selected && (
          <rect x="1" y="0.5" width="26" height="39" rx="6" fill="#185FA5" opacity="0.12" stroke="#185FA5" strokeWidth="1" />
        )}
        <ToothShape fdi={fdi} conditions={conditions} />
      </svg>
      {showNumber && numberPosition === 'below' && (
        <span className="text-[9.5px] leading-none mt-0.5 text-gray-400 dark:text-gray-500">{fdi}</span>
      )}
    </div>
  );
}
