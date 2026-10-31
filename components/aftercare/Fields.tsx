'use client';

import type { ReactNode } from 'react';

export const panel = 'rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900';
export const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}{children}</label>;
}
export function Choices<T extends string>({ legend, options, value, onChange, compact = false }: {
  legend: string; options: Record<T, string>; value: T[]; onChange: (value: T[]) => void; compact?: boolean;
}) {
  return <fieldset><legend className="mb-1 text-sm font-medium">{legend}</legend>
    <div className="flex flex-wrap gap-1.5">{(Object.keys(options) as T[]).map((key) => <label key={key}
      className={`cursor-pointer rounded-lg border ${compact ? 'px-2 py-1.5 text-[13px]' : 'px-3 py-2 text-sm'} ${value.includes(key)
        ? 'border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200'
        : 'border-gray-200 dark:border-gray-700'}`}>
      <input type="checkbox" className="mr-2 accent-teal-700" checked={value.includes(key)}
        onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((v) => v !== key))} />{options[key]}
    </label>)}</div>
  </fieldset>;
}
export function Options({ options }: { options: Record<string, string> }) {
  return <>{Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</>;
}
export function Rating({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return <Field label={`${label} (0–10, beteg által jelzett)`}><input type="number" min={0} max={10} step={1}
    className={inputClass} placeholder="Nincs mérés" value={value ?? ''}
    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  </Field>;
}
export async function requestJson<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, body === undefined ? { credentials: 'include', cache: 'no-store' } : {
    credentials: 'include', method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'A művelet nem sikerült');
  return data;
}
export function shortDate(date: string | null | undefined) {
  return date ? new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', dateStyle: 'medium' }).format(new Date(date)) : '—';
}
export function appointmentDate(date: string | null | undefined) {
  return date ? new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date)) : '—';
}
