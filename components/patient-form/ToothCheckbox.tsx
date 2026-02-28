'use client';

import { normalizeToothData, type ToothStatus } from '@/hooks/usePatientAutoSave';

export function getToothState(value: ToothStatus | undefined): 'empty' | 'present' | 'missing' {
  const normalized = normalizeToothData(value);
  if (!normalized) return 'empty';
  if (normalized.status === 'M') return 'missing';
  return 'present';
}

interface ToothCheckboxProps {
  toothNumber: string;
  value: ToothStatus | undefined;
  onChange: () => void;
  disabled?: boolean;
  idPrefix?: string;
}

export function ToothCheckbox({ toothNumber, value, onChange, disabled, idPrefix = 'tooth' }: ToothCheckboxProps) {
  const state = getToothState(value);
  const isPresent = state === 'present';
  const isMissing = state === 'missing';
  const isChecked = state !== 'empty';
  
  const normalized = normalizeToothData(value);
  const description = normalized?.description || '';
  const descriptionLower = description.toLowerCase();
  const hasKerdeses = descriptionLower.includes('kérdéses');
  const hasRemenytelen = descriptionLower.includes('reménytelen');

  let iconElement = null;
  let borderColor = '';
  let bgColor = '';
  
  if (isMissing) {
    borderColor = 'border-gray-400';
    bgColor = 'bg-gray-200';
    iconElement = (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 4L12 12M12 4L4 12" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (isPresent) {
    if (hasRemenytelen) {
      borderColor = 'border-red-500';
      bgColor = 'bg-red-50';
      iconElement = (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2V9M8 11V13" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="8" cy="14" r="1" fill="#dc2626"/>
        </svg>
      );
    } else if (hasKerdeses) {
      borderColor = 'border-yellow-500';
      bgColor = 'bg-yellow-50';
      iconElement = (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 6C6 4.5 7 3.5 8 3.5C9 3.5 10 4.5 10 6C10 7 9 8 8 8.5V10" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <circle cx="8" cy="13" r="1" fill="#eab308"/>
        </svg>
      );
    } else {
      borderColor = 'border-medical-primary';
      bgColor = 'bg-green-50';
      iconElement = (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 8L6 11L13 4" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      );
    }
  } else {
    borderColor = 'border-gray-300';
    bgColor = '';
  }

  const checkboxId = `${idPrefix}-${toothNumber}`;
  
  return (
    <div className="flex flex-col items-center gap-1">
      <label 
        htmlFor={checkboxId}
        className="text-xs sm:text-xs text-gray-600 font-medium cursor-pointer"
      >
        {toothNumber}
      </label>
      <div className="relative">
        <label
          htmlFor={checkboxId}
          className={`w-8 h-8 sm:w-7 sm:h-7 rounded border-2 flex items-center justify-center focus-within:ring-2 focus-within:ring-medical-primary focus-within:ring-offset-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${borderColor} ${bgColor}`}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={isChecked}
            onChange={(e) => {
              e.stopPropagation();
              if (!disabled) {
                onChange();
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            disabled={disabled}
            className="sr-only"
          />
          {iconElement}
        </label>
      </div>
    </div>
  );
}
