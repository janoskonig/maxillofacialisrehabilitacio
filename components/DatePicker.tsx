'use client';

import DatePickerLib from 'react-datepicker';
import { registerLocale } from 'react-datepicker';
import { hu } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

// Register Hungarian locale
registerLocale('hu', hu);

interface DatePickerProps {
  selected: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  isClearable?: boolean;
  dateFormat?: string;
}

export function DatePicker({
  selected,
  onChange,
  placeholder = 'Válasszon dátumot',
  className = 'form-input w-full',
  disabled = false,
  minDate,
  maxDate,
  isClearable = true,
  dateFormat = 'yyyy-MM-dd',
}: DatePickerProps) {
  // Convert string date to Date object if needed
  const selectedDate = selected instanceof Date ? selected : (selected ? new Date(selected) : null);

  return (
    <DatePickerLib
      selected={selectedDate}
      onChange={onChange}
      dateFormat={dateFormat}
      placeholderText={placeholder}
      className={className}
      disabled={disabled}
      minDate={minDate}
      maxDate={maxDate}
      locale={hu}
      isClearable={isClearable}
    />
  );
}



