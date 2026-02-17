'use client';

import { useState, useEffect } from 'react';
import { Calendar, Link2, Unlink, CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

interface GoogleCalendarStatus {
  enabled: boolean;
  email: string | null;
  status?: string | null;
  lastErrorCode?: string | null;
  lastErrorAt?: string | null;
}

interface GoogleCalendar {
  id: string;
  summary: string;
}

interface CalendarSettings {
  calendars: GoogleCalendar[];
  sourceCalendarId: string;
  targetCalendarId: string;
}

export function GoogleCalendarSettings() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendarSettings, setCalendarSettings] = useState<CalendarSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingAppointments, setSyncingAppointments] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sourceCalendarId, setSourceCalendarId] = useState<string>('primary');
  const [targetCalendarId, setTargetCalendarId] = useState<string>('primary');

  useEffect(() => {
    loadStatus();
    
    // URL paraméterek ellenőrzése (callback után)
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_calendar_success') === 'true') {
      setSuccess('Google Calendar sikeresen összekötve!');
      setTimeout(() => {
        setSuccess(null);
        window.history.replaceState({}, '', '/settings');
      }, 3000);
      loadStatus();
    }
    
    const errorParam = params.get('google_calendar_error');
    if (errorParam) {
      const errorMessages: Record<string, string> = {
        'missing_params': 'Hiányzó paraméterek az OAuth2 callback-ben',
        'not_configured': 'Google Calendar integráció nincs beállítva',
        'invalid_state': 'Érvénytelen state paraméter',
        'token_exchange_failed': 'Token exchange sikertelen',
        'missing_tokens': 'Hiányzó tokenek',
        'internal_error': 'Belső hiba történt',
      };
      setError(errorMessages[errorParam] || 'Ismeretlen hiba történt');
      setTimeout(() => {
        setError(null);
        window.history.replaceState({}, '', '/settings');
      }, 5000);
      loadStatus();
    }
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const [statusResponse, calendarsResponse] = await Promise.all([
        fetch('/api/google-calendar/status', { credentials: 'include' }),
        fetch('/api/google-calendar/calendars', { credentials: 'include' }),
      ]);
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        setStatus(statusData);
      } else {
        console.error('Failed to load Google Calendar status');
      }

      if (calendarsResponse.ok) {
        const calendarsData = await calendarsResponse.json();
        console.log('Calendar settings loaded:', calendarsData);
        if (calendarsData.calendars && calendarsData.calendars.length > 0) {
          setCalendarSettings(calendarsData);
          setSourceCalendarId(calendarsData.sourceCalendarId || 'primary');
          setTargetCalendarId(calendarsData.targetCalendarId || 'primary');
        } else {
          console.warn('No calendars found in response');
          // Mégis beállítjuk, hogy a UI megjelenjen, de üres listával
          setCalendarSettings({
            calendars: [],
            sourceCalendarId: calendarsData.sourceCalendarId || 'primary',
            targetCalendarId: calendarsData.targetCalendarId || 'primary',
          });
        }
      } else {
        const errorData = await calendarsResponse.json().catch(() => ({}));
        console.error('Failed to load Google Calendar calendars:', calendarsResponse.status, errorData);
        // Ha nincs összekötve (400), nem hiba, de ha más hiba, akkor jelezzük
        if (calendarsResponse.status !== 400) {
          setError('Nem sikerült betölteni a naptárakat. Próbálja újra később.');
        }
      }
    } catch (error) {
      console.error('Error loading Google Calendar status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      setConnecting(true);
      setError(null);
      
      // Ha reconnect_required állapotban van, explicit reconnect paraméterrel hívjuk
      const isReconnect = status?.status === 'reconnect_required';
      const url = isReconnect 
        ? '/api/google-calendar/auth?reconnect=1'
        : '/api/google-calendar/auth';
      
      const response = await fetch(url, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Hiba történt az összekötés indításakor');
      }
      
      const data = await response.json();
      
      // Redirect Google OAuth2 oldalra
      window.location.href = data.authUrl;
    } catch (err) {
      console.error('Error connecting Google Calendar:', err);
      setError(err instanceof Error ? err.message : 'Hiba történt az összekötés indításakor');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Biztosan le szeretné bontani a Google Calendar kapcsolatot?')) {
      return;
    }

    try {
      setDisconnecting(true);
      setError(null);
      
      const response = await fetch('/api/google-calendar/status', {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Hiba történt a kapcsolat megszüntetésekor');
      }
      
      setSuccess('Google Calendar kapcsolat sikeresen megszüntetve');
      setTimeout(() => setSuccess(null), 3000);
      await loadStatus();
    } catch (err) {
      console.error('Error disconnecting Google Calendar:', err);
      setError(err instanceof Error ? err.message : 'Hiba történt a kapcsolat megszüntetésekor');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      setSuccess(null);
      
      const response = await fetch('/api/google-calendar/sync', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Hiba történt a szinkronizáció során');
      }
      
      const data = await response.json();
      setSuccess(data.message || 'Szinkronizáció sikeresen befejezve');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error('Error syncing Google Calendar:', err);
      setError(err instanceof Error ? err.message : 'Hiba történt a szinkronizáció során');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAppointments = async () => {
    try {
      setSyncingAppointments(true);
      setError(null);
      setSuccess(null);
      
      const response = await fetch('/api/google-calendar/sync-appointments', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Hiba történt az időpontok szinkronizálásakor');
      }
      
      const data = await response.json();
      setSuccess(data.message || 'Időpontok sikeresen szinkronizálva');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error('Error syncing appointments to Google Calendar:', err);
      setError(err instanceof Error ? err.message : 'Hiba történt az időpontok szinkronizálásakor');
    } finally {
      setSyncingAppointments(false);
    }
  };

  const handleSaveCalendarSettings = async () => {
    try {
      setSavingSettings(true);
      setError(null);
      setSuccess(null);
      
      const response = await fetch('/api/google-calendar/calendars', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          sourceCalendarId: sourceCalendarId,
          targetCalendarId: targetCalendarId,
        }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Hiba történt a beállítások mentésekor');
      }
      
      const data = await response.json();
      setSuccess(data.message || 'Naptár beállítások sikeresen mentve');
      setTimeout(() => setSuccess(null), 3000);
      await loadStatus();
    } catch (err) {
      console.error('Error saving calendar settings:', err);
      setError(err instanceof Error ? err.message : 'Hiba történt a beállítások mentésekor');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-medical-primary" />
          <h2 className="text-xl font-semibold">Google Calendar integráció</h2>
        </div>
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Betöltés...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-5 h-5 text-medical-primary" />
        <h2 className="text-xl font-semibold">Google Calendar integráció</h2>
      </div>

      <p className="text-sm text-gray-600 mb-6">
        Összekötheti a Google Calendar fiókját, hogy az időpontfoglalások automatikusan megjelenjenek a naptárában.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm mb-4">
          {success}
        </div>
      )}

      {status?.enabled ? (
        <div className="space-y-4">
          {/* Státusz megjelenítése */}
          {status.status === 'reconnect_required' ? (
            <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Újracsatlakoztatás szükséges</div>
                <div className="text-sm text-gray-600 mt-1">
                  {status.email && `Email: ${status.email}`}
                  {status.lastErrorCode && (
                    <div className="mt-1">
                      <span className="font-medium">Hiba kód:</span> {status.lastErrorCode}
                    </div>
                  )}
                  {status.lastErrorAt && (
                    <div className="mt-1 text-xs text-gray-500">
                      Utolsó hiba: {new Date(status.lastErrorAt).toLocaleString('hu-HU')}
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="btn-primary flex items-center justify-center gap-2"
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Újracsatlakoztatás...
                      </>
                    ) : (
                      <>
                        <Link2 className="w-4 h-4" />
                        Újracsatlakoztatás
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : status.status === 'broken_config' ? (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-md">
              <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Konfigurációs hiba</div>
                <div className="text-sm text-gray-600 mt-1">
                  {status.email && `Email: ${status.email}`}
                  {status.lastErrorCode && (
                    <div className="mt-1">
                      <span className="font-medium">Hiba kód:</span> {status.lastErrorCode}
                    </div>
                  )}
                  {status.lastErrorAt && (
                    <div className="mt-1 text-xs text-gray-500">
                      Utolsó hiba: {new Date(status.lastErrorAt).toLocaleString('hu-HU')}
                    </div>
                  )}
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  Kérjük, lépjen kapcsolatba a rendszergazdával.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Google Calendar összekötve</div>
                {status.email && (
                  <div className="text-sm text-gray-600 mt-1">
                    Email: {status.email}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Naptár beállítások */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md space-y-4">
            <h3 className="font-medium text-gray-900">Naptár beállítások</h3>
            
            {!calendarSettings || calendarSettings.calendars.length === 0 ? (
              <div className="space-y-4">
                <div className="text-sm text-yellow-600 bg-yellow-50 border border-yellow-200 px-4 py-3 rounded-md">
                  Nem sikerült betölteni a naptárakat. Kérjük, próbálja újra vagy ellenőrizze a Google Calendar kapcsolatot.
                </div>
                <button
                  onClick={loadStatus}
                  className="btn-secondary w-full flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Újrapróbálás
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Forrás naptár (honnan szedje ki a "szabad" eseményeket)
                  </label>
                  <select
                    value={sourceCalendarId}
                    onChange={(e) => setSourceCalendarId(e.target.value)}
                    className="form-input w-full"
                    disabled={savingSettings}
                  >
                    {calendarSettings.calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.summary} {cal.id === 'primary' ? '(Alapértelmezett)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Ebből a naptárból keresi a "szabad" nevű eseményeket
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cél naptár (hova mentse az új eseményeket)
                  </label>
                  <select
                    value={targetCalendarId}
                    onChange={(e) => setTargetCalendarId(e.target.value)}
                    className="form-input w-full"
                    disabled={savingSettings}
                  >
                    {calendarSettings.calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.summary} {cal.id === 'primary' ? '(Alapértelmezett)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Ide menti az új időpontfoglalásokat
                  </p>
                </div>

                <button
                  onClick={handleSaveCalendarSettings}
                  disabled={savingSettings || 
                    (calendarSettings && sourceCalendarId === calendarSettings.sourceCalendarId && 
                     targetCalendarId === calendarSettings.targetCalendarId)}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {savingSettings ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Mentés...
                    </>
                  ) : (
                    <>
                      Mentés
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Csak akkor jelenítjük meg a szinkronizálás és kapcsolat megszüntetése gombokat, ha aktív állapotban van */}
          {status.status === 'active' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="btn-primary flex items-center justify-center gap-2 flex-1"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Szinkronizálás...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Szabad időpontok betöltése
                    </>
                  )}
                </button>
                <button
                  onClick={handleSyncAppointments}
                  disabled={syncingAppointments}
                  className="btn-secondary flex items-center justify-center gap-2 flex-1"
                >
                  {syncingAppointments ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Szinkronizálás...
                    </>
                  ) : (
                    <>
                      <Calendar className="w-4 h-4" />
                      Időpontok küldése a naptárba
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                „Szabad időpontok betöltése”: a naptárból hozza be a szabad időpontokat. „Időpontok küldése a naptárba”: a korábbi foglalásokat feltölti a Google Naptárba.
              </p>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="btn-secondary flex items-center justify-center gap-2"
              >
                {disconnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Kapcsolat megszüntetése...
                  </>
                ) : (
                  <>
                    <Unlink className="w-4 h-4" />
                    Kapcsolat megszüntetése
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-md">
            <XCircle className="w-5 h-5 text-gray-400" />
            <div className="flex-1">
              <div className="font-medium text-gray-900">Google Calendar nincs összekötve</div>
              <div className="text-sm text-gray-600 mt-1">
                Kattintson az alábbi gombra az összekötéshez
              </div>
            </div>
          </div>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="btn-primary flex items-center justify-center gap-2"
          >
            {connecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Összekötés...
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4" />
                Google Calendar összekötése
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

