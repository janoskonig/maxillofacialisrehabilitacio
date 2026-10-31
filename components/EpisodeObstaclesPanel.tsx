'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, Loader2, Plus } from 'lucide-react';
import { BLOCK_LABELS, blockLabel } from '@/lib/episode-block-taxonomy';
import { isActiveObstacle, obstacleDate, obstacleWaitingDays, type EpisodeObstacle } from '@/lib/episode-obstacles';

type FormValues = { key: string; waitingOn: string; waitingSince: string; expectedUnblockDate: string; note: string };
const emptyForm = (): FormValues => ({ key: 'WAIT_HISTOLOGY', waitingOn: '', waitingSince: obstacleDate(), expectedUnblockDate: '', note: '' });
const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const formatDate = (value: string) => new Date(value).toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' });

export function EpisodeObstaclesPanel({ episodeId, onChanged, compactEmpty = false }: { episodeId: string; onChanged?: () => void; compactEmpty?: boolean }) {
  const formId = useId();
  const [blocks, setBlocks] = useState<EpisodeObstacle[]>([]);
  const [serverNow, setServerNow] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/episodes/${episodeId}/blocks`, { credentials: 'include', signal });
      if (!response.ok) throw new Error('Az akadályok betöltése nem sikerült.');
      const data = await response.json();
      if (signal?.aborted) return;
      setBlocks(data.blocks ?? []);
      setServerNow(data.serverNow ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Betöltési hiba');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const mutate = async (url: string, method: string, body: unknown) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Az akadály mentése nem sikerült.');
      setForm(null);
      setEditingId(null);
      setResolvingId(null);
      setResolutionNote('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mentési hiba');
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const body = { key: form.key, waitingOn: form.waitingOn, expectedUnblockDate: form.expectedUnblockDate || null, note: form.note };
    void mutate(editingId ? `/api/episode-blocks/${editingId}` : `/api/episodes/${episodeId}/blocks`, editingId ? 'PATCH' : 'POST',
      editingId ? { ...body, action: 'update' } : { ...body, waitingSince: form.waitingSince });
  };
  const now = new Date(serverNow);
  const active = blocks.filter((block) => isActiveObstacle(block, now));
  const history = blocks.filter((block) => !isActiveObstacle(block, now));
  const field = (key: keyof FormValues, value: string) => setForm((current) => current && ({ ...current, [key]: value }));

  if (compactEmpty && !loading && !error && !active.length && !history.length && !form) {
    return <section id="akadalyok" aria-label="Kezelési akadályok" className="flex justify-end scroll-mt-24">
      <button type="button" disabled={saving} onClick={() => { setEditingId(null); setForm(emptyForm()); setResolvingId(null); }} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-medical-primary dark:text-gray-400"><Plus className="h-3 w-3" />Akadály rögzítése</button>
    </section>;
  }

  return (
    <section id="akadalyok" aria-label="Kezelési akadályok" className="scroll-mt-24 rounded-xl border border-amber-200 bg-white p-4 dark:border-amber-900/70 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"><AlertTriangle className="h-4 w-4 text-amber-600" />Akadályok{!loading && ` (${active.length})`}</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Mire vagy kire várunk a kezelés folytatásához?</p>
        </div>
        {!form && <button type="button" disabled={saving || loading || !!error} onClick={() => { setEditingId(null); setForm(emptyForm()); setResolvingId(null); }} className="inline-flex items-center gap-1 text-sm font-medium text-medical-primary disabled:opacity-50"><Plus className="h-4 w-4" />Akadály rögzítése</button>}
      </div>

      {error && <div role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error} <button type="button" disabled={saving} onClick={() => void load()} className="underline">Újratöltés</button></div>}
      {loading && <p role="status" className="mt-3 text-sm text-gray-500">Akadályok betöltése…</p>}

      {form && <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg bg-amber-50/60 p-3 dark:bg-amber-950/20">
        <h3 className="text-sm font-medium">{editingId ? 'Akadály szerkesztése' : 'Új akadály'}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 text-xs"><label htmlFor={`${formId}-key`}>Mire várunk?</label>
            <select id={`${formId}-key`} value={form.key} onChange={(event) => field('key', event.target.value)} className={inputClass} disabled={saving}>{Object.entries(BLOCK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </div>
          <label htmlFor={`${formId}-who`} className="space-y-1 text-xs">Kitől / honnan várjuk pontosan?
            <input id={`${formId}-who`} value={form.waitingOn} onChange={(event) => field('waitingOn', event.target.value)} placeholder="Név, intézmény, labor vagy biztosító" required maxLength={250} className={inputClass} disabled={saving} />
          </label>
          <label htmlFor={`${formId}-since`} className="space-y-1 text-xs">Várakozás kezdete
            <input id={`${formId}-since`} type="date" value={form.waitingSince} onChange={(event) => field('waitingSince', event.target.value)} max={obstacleDate(serverNow)} required className={inputClass} disabled={saving || !!editingId} />
          </label>
          <label htmlFor={`${formId}-expected`} className="space-y-1 text-xs">Várt válasz / teljesülés dátuma (opcionális)
            <input id={`${formId}-expected`} type="date" value={form.expectedUnblockDate} min={form.waitingSince} onChange={(event) => field('expectedUnblockDate', event.target.value)} className={inputClass} disabled={saving} />
          </label>
        </div>
        <label htmlFor={`${formId}-note`} className="block space-y-1 text-xs">Részletek (opcionális)
          <textarea id={`${formId}-note`} value={form.note} onChange={(event) => field('note', event.target.value)} placeholder="Például: felső fogpótlás árajánlata, megkeresés dátuma, ügyazonosító" rows={2} maxLength={4000} className={inputClass} disabled={saving} />
        </label>
        <p className="text-xs text-gray-600 dark:text-gray-400">Az akadály a feloldásig aktív marad. A várt dátum elmúlása után is látszik a várólistán.</p>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 text-sm">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Mentés</button>
          <button type="button" disabled={saving} onClick={() => { setForm(null); setEditingId(null); }} className="text-sm text-gray-600 dark:text-gray-300">Mégse</button>
        </div>
      </form>}

      {!loading && !active.length && <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Nincs rögzített aktív akadály.</p>}
      <ul className="mt-3 space-y-3">
        {active.map((block) => {
          const overdue = block.expectedUnblockDate && obstacleDate(block.expectedUnblockDate) < obstacleDate(serverNow);
          return <li key={block.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{blockLabel(block.key)}</p>
                <p className="mt-1 break-words text-sm text-gray-700 dark:text-gray-300">{block.waitingOn || 'A várt személy / intézmény még nincs megadva'}</p>
                <p className="mt-1 text-xs text-gray-500">{formatDate(block.waitingSince)} óta · {obstacleWaitingDays(block.waitingSince, serverNow)} napja várunk</p>
                {block.expectedUnblockDate && <p className={`mt-1 text-xs ${overdue ? 'font-medium text-red-700 dark:text-red-300' : 'text-gray-500'}`}>Várt dátum: {formatDate(block.expectedUnblockDate)}{overdue ? ' · Elmúlt a várt dátum' : ''}</p>}
                {block.note && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-gray-600 dark:text-gray-400">{block.note}</p>}
              </div>
              <div className="flex gap-3 text-xs">
                <button type="button" disabled={saving || !!form} className="text-medical-primary disabled:opacity-50" onClick={() => {
                  setEditingId(block.id); setResolvingId(null);
                  setForm({ key: block.key, waitingOn: block.waitingOn ?? '', waitingSince: obstacleDate(block.waitingSince), expectedUnblockDate: block.expectedUnblockDate ? obstacleDate(block.expectedUnblockDate) : '', note: block.note ?? '' });
                }}>Szerkesztés</button>
                <button type="button" disabled={saving || !!form} className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 disabled:opacity-50" onClick={() => { setResolvingId(block.id); setResolutionNote(''); }}><Check className="h-3 w-3" />Feloldás</button>
              </div>
            </div>
            {resolvingId === block.id && <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void mutate(`/api/episode-blocks/${block.id}`, 'PATCH', { action: 'resolve', resolutionNote }); }}>
              <label className="block text-xs">Mi oldotta fel az akadályt? (opcionális)
                <textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} maxLength={4000} rows={2} className={`${inputClass} mt-1`} disabled={saving} />
              </label>
              <div className="flex gap-3"><button type="submit" disabled={saving} className="btn-primary text-sm">Akadály feloldása</button><button type="button" disabled={saving} onClick={() => setResolvingId(null)} className="text-sm text-gray-500">Mégse</button></div>
            </form>}
          </li>;
        })}
      </ul>
      {!!history.length && <details className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        <summary className="cursor-pointer">Korábbi akadályok ({history.length})</summary>
        <ul className="mt-2 space-y-2">{history.map((block) => <li key={block.id} className="rounded border border-gray-100 p-2 dark:border-gray-800">
          <p>{blockLabel(block.key)} · {block.waitingOn || 'Nincs megadott személy / intézmény'}</p>
          <p>{formatDate(block.waitingSince)} óta · {block.resolvedAt ? `Feloldva: ${formatDate(block.resolvedAt)}` : block.active ? 'Korábbi, lejárt blokkolás' : 'Lezárva'}</p>
          {block.resolutionNote && <p className="whitespace-pre-wrap break-words">{block.resolutionNote}</p>}
        </li>)}</ul>
      </details>}
    </section>
  );
}
