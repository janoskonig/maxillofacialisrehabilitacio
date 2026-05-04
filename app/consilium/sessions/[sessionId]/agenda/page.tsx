'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarClock, Loader2, Presentation } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';

type AgendaItem = {
  sortOrder: number;
  discussed: boolean;
  name: string | null;
};

type AgendaSession = {
  id: string;
  title: string;
  scheduledAt: string;
  status: 'draft' | 'active' | 'closed';
};

type AgendaResponse = {
  session: AgendaSession;
  items: AgendaItem[];
};

function formatHuDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('hu-HU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export default function ConsiliumSessionAgendaPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId =
    typeof params.sessionId === 'string'
      ? params.sessionId
      : Array.isArray(params.sessionId)
        ? params.sessionId[0]
        : '';

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        if (!u) router.replace('/login');
      })
      .catch(() => router.replace('/login'))
      .finally(() => setLoadingUser(false));
  }, [router]);

  const loadAgenda = useCallback(async () => {
    if (!user || !sessionId) return;
    setLoadingData(true);
    setError(null);
    try {
      const res = await fetch(`/api/consilium/sessions/${encodeURIComponent(sessionId)}/agenda`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as
        | (AgendaResponse & { error?: string })
        | { error?: string }
        | null;
      if (!res.ok) {
        setError((body as { error?: string })?.error || 'Nem sikerült betölteni a napirendet.');
        setData(null);
        return;
      }
      const parsed = body as AgendaResponse;
      if (!parsed?.session || !Array.isArray(parsed.items)) {
        setError('Hiányzó válasz a szervertől.');
        setData(null);
        return;
      }
      setData(parsed);
    } catch {
      setError('Hálózati hiba a napirend betöltésekor.');
      setData(null);
    } finally {
      setLoadingData(false);
    }
  }, [user, sessionId]);

  useEffect(() => {
    void loadAgenda();
  }, [loadAgenda]);

  const sortedItems = useMemo(() => data?.items ?? [], [data]);

  const renderShell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-b from-cyan-50 to-white">
      <header className="bg-white shadow-soft border-b border-gray-200/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo width={36} height={42} />
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-medical-primary truncate">
                Konzílium napirend
              </h1>
              <p className="text-xs text-gray-500">A betegek névsora az alkalomhoz</p>
            </div>
          </div>
          <Link href="/consilium" className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            Konzílium
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );

  if (loadingUser) {
    return renderShell(
      <div className="card p-6 flex items-center gap-3 text-gray-600">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Bejelentkezés ellenőrzése…</span>
      </div>,
    );
  }

  if (!user) {
    return renderShell(
      <div className="card p-6 text-sm text-gray-600">Átirányítás bejelentkezésre…</div>,
    );
  }

  if (loadingData && !data) {
    return renderShell(
      <div className="card p-6 flex items-center gap-3 text-gray-600">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Napirend betöltése…</span>
      </div>,
    );
  }

  if (error || !data) {
    return renderShell(
      <div className="card p-6 space-y-3">
        <h2 className="text-lg font-semibold text-red-700">Nem sikerült betölteni a napirendet</h2>
        <p className="text-sm text-gray-700">
          {error ||
            'Lehet, hogy nincs jogosultságod megnézni ezt az alkalmat (csak az alkalom intézményéhez tartozó felhasználók látják a napirendet).'}
        </p>
        <Link href="/consilium" className="btn-secondary inline-flex items-center gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Vissza a Konzílium oldalra
        </Link>
      </div>,
    );
  }

  return renderShell(
    <div className="space-y-4">
      <section className="card p-4 sm:p-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Téma</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{data.session.title}</p>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 inline-flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5" /> Időpont
            </p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">
              {formatHuDateTime(data.session.scheduledAt)}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">Státusz: {data.session.status}</p>
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            Napirenden lévő betegek ({sortedItems.length})
          </h2>
          <Link
            href={`/consilium/${encodeURIComponent(data.session.id)}/present`}
            className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1"
          >
            <Presentation className="w-3.5 h-3.5" />
            Vetítés
          </Link>
        </div>

        {sortedItems.length === 0 ? (
          <p className="text-sm text-gray-500">Még nincs beteg az alkalmon.</p>
        ) : (
          <ol className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
            {sortedItems.map((it) => (
              <li
                key={it.sortOrder}
                className="px-3 py-2 flex items-center gap-3 text-sm"
              >
                <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-cyan-50 text-cyan-800 text-xs font-semibold">
                  {it.sortOrder}
                </span>
                <span className="flex-1 truncate text-gray-900">
                  {it.name || <em className="text-gray-400">Beteg neve nem elérhető</em>}
                </span>
                {it.discussed && (
                  <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded border bg-emerald-100 text-emerald-900 border-emerald-200">
                    Megbeszélve
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}

        <p className="text-[11px] text-gray-500">
          Részletes előkészítés és napirendi pontok a Konzílium oldalon érhetők el.
        </p>
      </section>
    </div>,
  );
}
