'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export const formInput = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-blue-950';
export const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40';
export const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium dark:border-slate-600 dark:bg-slate-900 disabled:opacity-40';

export function WorkflowSteps({ labels, current }: { labels: string[]; current: number }) {
  return <ol aria-label="Kitöltés lépései" className="my-5 flex gap-2">
    {labels.map((label, i) => <li key={label} aria-current={i === current ? 'step' : undefined} className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center text-xs sm:flex-row sm:gap-2 sm:px-3 sm:text-left ${i === current ? 'bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-100' : 'text-slate-500'}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${i < current ? 'bg-teal-600 text-white' : i === current ? 'bg-blue-700 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{i < current ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
      <span className="min-w-0 break-words">{label}</span>
    </li>)}
  </ol>;
}

export function FormField({ id, label, hint, optional, children }: { id: string; label: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return <div className="min-w-0">
    <label htmlFor={id} className="text-sm font-medium">{label}{optional && <span className="ml-1 font-normal text-slate-400">· opcionális</span>}</label>
    {children}
    {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>}
  </div>;
}

export function FormErrors({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return <div role="alert" tabIndex={-1} className="my-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
    <p className="font-semibold">Ezt még ellenőrizd:</p>
    <ul className="mt-1 list-disc space-y-1 pl-5">{messages.map((message, i) => <li key={i}>{message}</li>)}</ul>
  </div>;
}
