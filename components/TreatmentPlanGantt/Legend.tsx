'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TimelineStepStatus } from './types';
import { STATUS_CONFIG, STATUS_DOT } from './constants';

export function Legend() {
  const [open, setOpen] = useState(true);
  const entries = Object.entries(STATUS_CONFIG) as [TimelineStepStatus, (typeof STATUS_CONFIG)[TimelineStepStatus]][];

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/80">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
      >
        <span>Jelmagyarázat</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 px-3 pb-3 text-xs text-gray-600">
          {entries.map(([key, cfg]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded shrink-0" style={{ background: STATUS_DOT[key] }} />
              {cfg.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
