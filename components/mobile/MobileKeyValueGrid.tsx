'use client';

import { ReactNode } from 'react';

interface KeyValueItem {
  key: string;
  value: string | ReactNode;
}

interface MobileKeyValueGridProps {
  items: KeyValueItem[];
  className?: string;
}

/**
 * Mobile key-value grid component
 * - 2 column layout for key-value pairs
 * - Used in mobile cards (PatientList, WaitingPatientsList, etc.)
 * - Consistent styling across the app
 */
export function MobileKeyValueGrid({ items, className = '' }: MobileKeyValueGridProps) {
  if (items.length === 0) return null;

  return (
    <div className={`grid grid-cols-2 gap-x-4 gap-y-2 ${className}`}>
      {items.map((item, index) => (
        <div key={index}>
          <div className="text-gray-600 text-sm">{item.key}</div>
          <div className="text-gray-900 text-sm font-medium mt-0.5">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
