'use client';

import { useState, useEffect } from 'react';
import { Calendar, Link2, Unlink, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface GoogleCalendarStatus {
  enabled: boolean;
  email: string | null;
}

export function GoogleCalendarSettings() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      const response = await fetch('/api/google-calendar/status', {
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      } else {
        console.error('Failed to load Google Calendar status');
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
      
      const response = await fetch('/api/google-calendar/auth', {
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

