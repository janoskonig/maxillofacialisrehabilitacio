'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Loader2 } from 'lucide-react';
import { BLOCK_LABELS, blockLabel } from '@/lib/episode-block-taxonomy';
import { obstacleDate, obstacleWaitingDays, obstacleWaitlistRows, type WaitingObstacle } from '@/lib/episode-obstacles';
import { EpisodeObstaclesPanel } from './EpisodeObstaclesPanel';

const inputClass = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const formatDate = (date: string) => new Date(date).toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' });

export function ObstacleWaitingList() {
  const filterId = useId();
  const [obstacles, setObstacles] = useState<WaitingObstacle[]>([]);
  const [serverNow, setServerNow] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [key, setKey] = useState('');
  const [providerId, setProviderId] = useState('');
  const [sort, setSort] = useState<'oldest' | 'name' | 'expected'>('oldest');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch('/api/episode-blocks', { credentials: 'include', signal });
      if (!response.ok) throw new Error('A várólista betöltése nem sikerült.');
      const data = await response.json();
      if (signal?.aborted) return;
      setObstacles(data.obstacles ?? []);
      setServerNow(data.serverNow ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Betöltési hiba');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const providers = useMemo(() => Array.from(new Map(obstacles.filter((item) => item.assignedProviderId)
    .map((item) => [item.assignedProviderId!, item.assignedProviderName ?? 'Név nélküli orvos'])).entries())
    .sort((a, b) => a[1].localeCompare(b[1], 'hu')), [obstacles]);
  const rows = useMemo(() => obstacleWaitlistRows(obstacles, { search, key, providerId, sort }, new Date(serverNow)), [obstacles, search, key, providerId, sort, serverNow]);

  return <div className="space-y-4">
    <p className="text-sm text-gray-600 dark:text-gray-400">Rögzített akadály miatt várakozó kezelések. Alapból a legrégebb óta várakozó kezelés kerül előre.</p>
    <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs text-gray-600 dark:text-gray-400">Beteg vagy várt személy / intézmény<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Keresés…" className={inputClass} /></label>
      <div className="text-xs text-gray-600 dark:text-gray-400"><label htmlFor={`${filterId}-key`}>Mire várunk?</label><select id={`${filterId}-key`} value={key} onChange={(event) => setKey(event.target.value)} className={inputClass}><option value="">Minden akadály</option>{Object.entries(BLOCK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="text-xs text-gray-600 dark:text-gray-400"><label htmlFor={`${filterId}-provider`}>Kezelőorvos</label><select id={`${filterId}-provider`} value={providerId} onChange={(event) => setProviderId(event.target.value)} className={inputClass}><option value="">Minden orvos</option>{providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
      <div className="text-xs text-gray-600 dark:text-gray-400"><label htmlFor={`${filterId}-sort`}>Rendezés</label><select id={`${filterId}-sort`} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className={inputClass}><option value="oldest">Legrégebb óta várakozók elöl</option><option value="expected">Várt válasz dátuma</option><option value="name">Betegnév</option></select></div>
    </div>
    <div className="flex items-center justify-between gap-3 text-sm text-gray-500 dark:text-gray-400"><span>{rows.length} várakozó kezelés · {rows.reduce((sum, row) => sum + row.obstacles.length, 0)} akadály{key || search || providerId ? ' a szűrés szerint' : ''}</span><button type="button" disabled={loading} onClick={() => void load()} className="text-medical-primary disabled:opacity-50">Frissítés</button></div>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Várólista betöltése…</p>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    {!loading && !error && !rows.length && <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">{obstacles.length ? 'Nincs a szűrésnek megfelelő kezelés.' : 'Nincs rögzített aktív akadály. Akadályt a beteg „Kezelés menete” oldalán lehet felvenni.'}</div>}
    {!error && !!rows.length && <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"><tr>{['Beteg / kezelés', 'Mire és kire várunk?', 'Várakozás', 'Várt válasz', ''].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">{rows.map((row) => <Fragment key={row.episodeId}>
          <tr>
            <td className="min-w-[180px] px-4 py-3 align-top"><Link href={`/patients/${row.patientId}/stages?episodeId=${row.episodeId}#akadalyok`} className="font-medium text-medical-primary hover:underline">{row.patientName}</Link><p className="mt-1 text-xs text-gray-500">{row.episodeTitle}</p>{row.currentStageLabel && <p className="mt-1 text-xs text-gray-500">{row.currentStageLabel}</p>}<p className="mt-1 text-xs text-gray-500">{row.assignedProviderName ?? 'Nincs kijelölt kezelőorvos'}</p></td>
            <td className="min-w-[230px] px-4 py-3 align-top"><ul className="space-y-2">{row.obstacles.map((block) => <li key={block.id}><p className="font-medium">{blockLabel(block.key)}</p><p className="break-words text-xs text-gray-600 dark:text-gray-400">{block.waitingOn || 'A várt személy / intézmény még nincs megadva'}</p></li>)}</ul></td>
            <td className="whitespace-nowrap px-4 py-3 align-top"><strong>{obstacleWaitingDays(row.waitingSince, serverNow)} nap</strong><p className="mt-1 text-xs text-gray-500">{formatDate(row.waitingSince)} óta</p></td>
            <td className="min-w-[130px] px-4 py-3 align-top"><ul className="space-y-2">{row.obstacles.map((block) => <li key={block.id} className={block.expectedUnblockDate && obstacleDate(block.expectedUnblockDate) < obstacleDate(serverNow) ? 'text-red-700 dark:text-red-300' : 'text-gray-500'}>{block.expectedUnblockDate ? <>{formatDate(block.expectedUnblockDate)}{obstacleDate(block.expectedUnblockDate) < obstacleDate(serverNow) && <p className="text-xs">Elmúlt a várt dátum</p>}</> : 'Nincs megadva'}</li>)}</ul></td>
            <td className="px-3 py-3 align-top"><button type="button" aria-expanded={expandedId === row.episodeId} aria-label={`${row.patientName} akadályainak kezelése`} onClick={() => setExpandedId((current) => current === row.episodeId ? null : row.episodeId)} className="inline-flex items-center gap-1 text-xs text-medical-primary">Kezelés<ChevronDown className={`h-4 w-4 ${expandedId === row.episodeId ? 'rotate-180' : ''}`} /></button></td>
          </tr>
          {expandedId === row.episodeId && <tr><td colSpan={5} className="p-3"><EpisodeObstaclesPanel key={row.episodeId} episodeId={row.episodeId} onChanged={() => void load()} /></td></tr>}
        </Fragment>)}</tbody>
      </table>
    </div>}
  </div>;
}
