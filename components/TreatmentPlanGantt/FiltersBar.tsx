'use client';

import { useEffect, useState } from 'react';
import type { EpisodeStatusFilter, ZoomPreset, ProviderOption } from './types';
import { ZOOM_LABELS } from './constants';

export interface FiltersBarProps {
  status: EpisodeStatusFilter;
  onStatus: (v: EpisodeStatusFilter) => void;
  providerId: string;
  onProviderId: (id: string) => void;
  searchInput: string;
  onSearchInput: (v: string) => void;
  treatmentType: string;
  onTreatmentType: (v: string) => void;
  treatmentTypeOptions: string[];
  attentionOnly: boolean;
  onAttentionOnly: (v: boolean) => void;
  zoom: ZoomPreset;
  onZoom: (z: ZoomPreset) => void;
}

export function FiltersBar({
  status,
  onStatus,
  providerId,
  onProviderId,
  searchInput,
  onSearchInput,
  treatmentType,
  onTreatmentType,
  treatmentTypeOptions,
  attentionOnly,
  onAttentionOnly,
  zoom,
  onZoom,
}: FiltersBarProps) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [provLoading, setProvLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/staff/assignable-providers', { credentials: 'include' });
        if (!res.ok) throw new Error('providers');
        const data = await res.json();
        if (!cancelled) setProviders(data.providers ?? []);
      } catch {
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setProvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 p-3 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-600 min-w-[140px] flex-1">
          Betegnév
          <input
            type="search"
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            placeholder="Keresés…"
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 w-full focus:ring-2 focus:ring-medical-primary/20 focus:border-medical-primary"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-600 min-w-[120px]">
          Epizód
          <select
            value={status}
            onChange={(e) => onStatus(e.target.value as EpisodeStatusFilter)}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-medical-primary/20 focus:border-medical-primary"
          >
            <option value="open">Nyitott</option>
            <option value="closed">Lezárt</option>
            <option value="all">Összes</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-600 min-w-[160px] flex-1">
          Orvos
          <select
            value={providerId}
            onChange={(e) => onProviderId(e.target.value)}
            disabled={provLoading}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-medical-primary/20 focus:border-medical-primary disabled:opacity-50"
          >
            <option value="">Minden orvos</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-600 min-w-[140px] flex-1">
          Kezelés típus
          <select
            value={treatmentType}
            onChange={(e) => onTreatmentType(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-medical-primary/20 focus:border-medical-primary"
          >
            <option value="">Mind</option>
            {treatmentTypeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-600 min-w-[100px]">
          Időablak
          <select
            value={zoom}
            onChange={(e) => onZoom(e.target.value as ZoomPreset)}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-medical-primary/20 focus:border-medical-primary"
          >
            {(['14d', '30d', '90d', 'auto'] as ZoomPreset[]).map((z) => (
              <option key={z} value={z}>
                {ZOOM_LABELS[z]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={attentionOnly}
          onChange={(e) => onAttentionOnly(e.target.checked)}
          className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary/30"
        />
        Csak figyelmet igényel (7 napon belül vagy múltbeli tervezett ablak)
      </label>
    </div>
  );
}
