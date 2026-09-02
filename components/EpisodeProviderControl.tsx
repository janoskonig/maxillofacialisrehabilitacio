'use client';

/**
 * Felelős orvos — az epizód elsőrendű tulajdonsága, a sablontól függetlenül.
 *
 * Feltűnő chip a kezelési terv fejlécében: a jelenlegi felelős orvos neve
 * (vagy borostyán „nincs felelős orvos" nudge), kattintásra popover: orvos
 * választása (fogpótlástanász lista), opcionális indok, lekapcsolás, és a
 * váltások története („ki volt a felelős mikor"). A váltás előre hat: az új
 * foglalások az új orvos naptárába mennek, a nyitott intentek lejárnak; a
 * korábbi időpontok érintetlenek. Nem blokkol semmit — nudge, nem kapu.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { UserRound, Check, Loader2, History, ChevronDown, UserX, Search } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { formatApiErrorParts } from '@/lib/extract-api-error';
import { Popover, MenuHeading } from './visit-plan/Popover';
import type { ProviderAssignmentEvent } from '@/lib/episode-provider';

interface DoctorOption {
  id: string;
  name: string;
  intezmeny: string | null;
}

export interface EpisodeProviderControlProps {
  episodeId: string;
  patientId?: string | null;
  assignedProviderId: string | null;
  assignedProviderName: string | null;
  /** admin / fogpótlástanász — másnak csak megjelenítés. */
  canEdit: boolean;
  /** Sikeres váltás után (a karton és a foglalási motor frissítéséhez). */
  onChanged?: () => void;
  /** Kompakt (fejléc-) változat. */
  compact?: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' });
}

const SAVE_ERROR_FALLBACK = 'Nem sikerült a felelős orvos mentése';

/**
 * Toast-szöveg a sikertelen mentéshez. A szerver konkrét üzenete (pl.
 * PROVIDER_NOT_FOUND) marad; a generikus 500-as „Hiba történt" helyett a
 * művelet neve áll, és mindkét esetben ott a [kód · correlationId] címke, hogy
 * a felületi hiba a szerver-loggal összeköthető legyen.
 */
function describeSaveError(
  body: { error?: unknown; code?: unknown; hint?: unknown } | null,
  res: Pick<Response, 'status'> & { headers?: { get?: (name: string) => string | null } }
): string {
  const raw = typeof body?.error === 'string' ? body.error.trim() : '';
  const message = raw && raw !== 'Hiba történt' ? raw : SAVE_ERROR_FALLBACK;
  return formatApiErrorParts({ ...(body ?? {}), error: message }, res, SAVE_ERROR_FALLBACK);
}

/**
 * Érintőképernyőn (mobil) ne fókuszáljuk automatikusan a keresőt: a felugró
 * billentyűzet eltakarná az orvos-listát. Csak a nyitott panel renderelésekor
 * (kliensen) hívjuk.
 */
function shouldAutoFocusSearch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(pointer: coarse)').matches;
}

export function EpisodeProviderControl({
  episodeId,
  patientId,
  assignedProviderId,
  assignedProviderName,
  canEdit,
  onChanged,
  compact = false,
}: EpisodeProviderControlProps) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [doctors, setDoctors] = useState<DoctorOption[] | null>(null);
  const [history, setHistory] = useState<ProviderAssignmentEvent[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  // Felajánlás: ha a betegnek nincs kezelőorvosa, az új felelős orvos egy
  // kattintással kezelőorvos is lehet (a régi sablon-szerkesztőből átvéve).
  const [kezeleoorvosOffer, setKezeleoorvosOffer] = useState<{ userId: string; name: string } | null>(null);
  const [assigningKezeleoorvos, setAssigningKezeleoorvos] = useState(false);

  // A lista egyszer töltődik; ref-őr, hogy a betöltés ne változtassa a callback
  // identitását (különben a nyitó effect újra lefutna, és a történetet is
  // kétszer kérné).
  const doctorsRequestedRef = useRef(false);
  const loadDoctors = useCallback(async () => {
    if (doctorsRequestedRef.current) return;
    doctorsRequestedRef.current = true;
    try {
      const res = await fetch('/api/users/fogpotlastanasz', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setDoctors(
        (data.users ?? []).map((u: { id: string; name?: string; displayName?: string; email?: string; intezmeny?: string | null }) => ({
          id: u.id,
          name: u.displayName || u.name || u.email || u.id,
          intezmeny: u.intezmeny ?? null,
        }))
      );
    } catch {
      // non-critical — a következő nyitásnál újrapróbáljuk
      doctorsRequestedRef.current = false;
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/provider-history`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.events ?? []);
    } catch {
      /* non-critical */
    }
  }, [episodeId]);

  useEffect(() => {
    if (!open) return;
    void loadDoctors();
    void loadHistory();
  }, [open, loadDoctors, loadHistory]);

  const save = async (userId: string | null, doctorName: string | null) => {
    if (saving) return;
    if ((userId ?? null) === (assignedProviderId ?? null)) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          assignedProviderId: userId,
          providerChangeReason: reason.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(describeSaveError(data, res));
      }
      setReason('');
      setQuery('');
      setOpen(false);
      setHistory(null);
      onChanged?.();
      // Kezelőorvos-ajánlat: csak ha a betegnek még nincs.
      if (userId && doctorName && patientId) {
        try {
          const kRes = await fetch(`/api/patients/${patientId}/kezeleoorvos`, { credentials: 'include' });
          if (kRes.ok) {
            const kData = await kRes.json();
            if (!kData.kezeleoorvos?.userId) setKezeleoorvosOffer({ userId, name: doctorName });
          }
        } catch {
          /* non-critical */
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : SAVE_ERROR_FALLBACK, 'error');
    } finally {
      setSaving(false);
    }
  };

  const acceptKezeleoorvosOffer = async () => {
    if (!kezeleoorvosOffer || !patientId || assigningKezeleoorvos) return;
    setAssigningKezeleoorvos(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/kezeleoorvos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: kezeleoorvosOffer.userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Hiba a kezelőorvos beállításakor');
      }
      showToast(`${kezeleoorvosOffer.name} a beteg kezelőorvosa is`, 'success');
      setKezeleoorvosOffer(null);
      onChanged?.();
      window.dispatchEvent(new Event('kezeleoorvos-changed'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a kezelőorvos beállításakor', 'error');
    } finally {
      setAssigningKezeleoorvos(false);
    }
  };

  const filtered = (doctors ?? []).filter((d) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return d.name.toLowerCase().includes(q) || (d.intezmeny ?? '').toLowerCase().includes(q);
  });

  const hasProvider = Boolean(assignedProviderId);
  const chipClass = hasProvider
    ? 'border-medical-primary/30 bg-medical-primary/10 text-gray-900 dark:text-gray-100 hover:bg-medical-primary/15'
    : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/60';

  const chipContent = (
    <>
      <UserRound className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0`} />
      <span className="text-[11px] uppercase tracking-wide opacity-70 shrink-0">Felelős orvos</span>
      <span className={`font-semibold truncate ${compact ? 'text-sm' : 'text-base'}`}>
        {hasProvider ? assignedProviderName ?? '—' : 'nincs kijelölve'}
      </span>
      {canEdit && <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />}
    </>
  );

  return (
    <div className="flex flex-col items-end gap-1 min-w-0" data-testid="episode-provider-control">
      {canEdit ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          align="right"
          widthClass="w-80"
          triggerAriaLabel={`Felelős orvos: ${hasProvider ? assignedProviderName ?? '' : 'nincs kijelölve'} — módosítás`}
          triggerTitle="Az epizód felelős orvosa — bármikor váltható, a váltás előre hat"
          triggerClassName={`inline-flex items-center gap-1.5 max-w-full pl-2.5 pr-2 py-1 rounded-full border transition-colors ${chipClass}`}
          trigger={chipContent}
        >
          {() => (
            <div className="p-1">
              <MenuHeading>Felelős orvos váltása</MenuHeading>
              <p className="px-2 pb-1 text-[11px] text-gray-500 dark:text-gray-400">
                A váltás előre hat: az új foglalások az új orvos naptárába mennek, a korábbi
                időpontok maradnak.
              </p>
              <div className="relative mx-1 mb-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Orvos keresése…"
                  aria-label="Orvos keresése"
                  autoFocus={shouldAutoFocusSearch()}
                  className="w-full pl-7 pr-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900"
                />
              </div>
              <div className="max-h-44 overflow-y-auto">
                {doctors == null ? (
                  <p className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Orvosok betöltése…
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400">Nincs találat.</p>
                ) : (
                  filtered.map((d) => {
                    const current = d.id === assignedProviderId;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        role="menuitem"
                        disabled={saving}
                        onClick={() => void save(d.id, d.name)}
                        className={`w-full text-left px-2 py-1.5 rounded text-sm inline-flex items-center gap-2 transition-colors disabled:opacity-50 ${
                          current
                            ? 'bg-medical-primary/10 text-medical-primary font-medium'
                            : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        {current ? <Check className="w-3.5 h-3.5 shrink-0" /> : <UserRound className="w-3.5 h-3.5 shrink-0 text-gray-400" />}
                        <span className="truncate">{d.name}</span>
                        {d.intezmeny && (
                          <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[40%]">
                            {d.intezmeny}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mx-1 mt-1">
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Váltás indoka (opcionális, a történetbe kerül)"
                  aria-label="Váltás indoka"
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900"
                />
              </div>
              {hasProvider && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={saving}
                  onClick={() => void save(null, null)}
                  className="mt-1 w-full text-left px-2 py-1.5 rounded text-xs inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                >
                  <UserX className="w-3.5 h-3.5" /> Felelős orvos lekapcsolása
                </button>
              )}

              {/* Történet */}
              <div className="mt-1 border-t border-gray-100 dark:border-gray-800 pt-1">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  aria-expanded={historyOpen}
                  className="w-full text-left px-2 py-1 text-xs inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-medical-primary"
                >
                  <History className="w-3.5 h-3.5" />
                  Váltások története{history ? ` (${history.length})` : ''}
                  <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
                </button>
                {historyOpen && (
                  <ul className="px-2 pb-1 space-y-1" data-testid="provider-history">
                    {history == null ? (
                      <li className="text-xs text-gray-400">Betöltés…</li>
                    ) : history.length === 0 ? (
                      <li className="text-xs text-gray-400 dark:text-gray-500">Még nem volt váltás ebben az epizódban.</li>
                    ) : (
                      history.map((ev) => (
                        <li key={ev.id} className="text-xs text-gray-600 dark:text-gray-400">
                          <span className="text-gray-400 dark:text-gray-500">{formatDate(ev.createdAt)}</span>{' '}
                          <span className="text-gray-700 dark:text-gray-300">
                            {ev.oldName ?? '—'} → {ev.newName ?? 'nincs'}
                          </span>
                          {ev.reason && <span className="italic"> · {ev.reason}</span>}
                          {ev.createdBy && <span className="text-gray-400 dark:text-gray-500"> · {ev.createdBy}</span>}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
              {saving && (
                <p className="px-2 pt-1 text-xs text-gray-500 inline-flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Mentés…
                </p>
              )}
            </div>
          )}
        </Popover>
      ) : (
        <span
          className={`inline-flex items-center gap-1.5 max-w-full pl-2.5 pr-2.5 py-1 rounded-full border ${chipClass}`}
          title="Az epizód felelős orvosa"
        >
          {chipContent}
        </span>
      )}

      {kezeleoorvosOffer && (
        <div className="text-xs text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-md px-2 py-1 inline-flex items-center gap-2 flex-wrap max-w-full">
          <span>
            A betegnek nincs kezelőorvosa — legyen <strong>{kezeleoorvosOffer.name}</strong> az is?
          </span>
          <button
            type="button"
            onClick={() => void acceptKezeleoorvosOffer()}
            disabled={assigningKezeleoorvos}
            className="font-medium underline disabled:opacity-50"
          >
            Igen
          </button>
          <button type="button" onClick={() => setKezeleoorvosOffer(null)} className="opacity-70 hover:opacity-100">
            Most nem
          </button>
        </div>
      )}
    </div>
  );
}
