'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Shield, X } from 'lucide-react';

const COOKIE_CONSENT_KEY = 'gdpr-cookie-consent';
const SENTRY_CONSENT_KEY = 'gdpr-sentry-consent';

export type CookieConsentPreferences = {
  essential: true;
  errorTracking: boolean;
  acknowledgedAt: string;
};

export function getCookieConsent(): CookieConsentPreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function hasSentryConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SENTRY_CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [errorTracking, setErrorTracking] = useState(false);

  useEffect(() => {
    const consent = getCookieConsent();
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const saveConsent = (preferences: CookieConsentPreferences) => {
    try {
      localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(preferences));
      localStorage.setItem(SENTRY_CONSENT_KEY, String(preferences.errorTracking));
    } catch {
      // localStorage might be unavailable
    }
    setVisible(false);

    if (preferences.errorTracking) {
      initSentryIfNeeded();
    }
  };

  const handleAcceptAll = () => {
    saveConsent({
      essential: true,
      errorTracking: true,
      acknowledgedAt: new Date().toISOString(),
    });
  };

  const handleAcceptEssential = () => {
    saveConsent({
      essential: true,
      errorTracking: false,
      acknowledgedAt: new Date().toISOString(),
    });
  };

  const handleSavePreferences = () => {
    saveConsent({
      essential: true,
      errorTracking,
      acknowledgedAt: new Date().toISOString(),
    });
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-4 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.25rem)]">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-medical-primary flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Sütik és adatvédelem</h3>
            <p className="text-xs sm:text-sm text-gray-600 mt-1">
              Ez az alkalmazás elengedhetetlen munkamenet sütiket használ a bejelentkezéshez. 
              Opcionálisan engedélyezheti a hibakövetést (Sentry) a szolgáltatás javítása érdekében.{' '}
              <Link href="/privacy-hu" className="text-medical-primary hover:underline">
                Adatvédelmi irányelvek
              </Link>
            </p>

            {showDetails && (
              <div className="mt-3 space-y-2 text-xs sm:text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-gray-700">
                    <strong>Elengedhetetlen sütik</strong> &ndash; Bejelentkezés és munkamenet (mindig aktív)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={errorTracking}
                    onChange={(e) => setErrorTracking(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                  />
                  <span className="text-gray-700">
                    <strong>Hibakövetés (Sentry)</strong> &ndash; Hibajelentések a szolgáltatás javításához (anonimizált)
                  </span>
                </label>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              {showDetails ? (
                <button
                  onClick={handleSavePreferences}
                  className="text-xs sm:text-sm py-1.5 px-4 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark transition-colors"
                >
                  Beállítások mentése
                </button>
              ) : (
                <>
                  <button
                    onClick={handleAcceptAll}
                    className="text-xs sm:text-sm py-1.5 px-4 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark transition-colors"
                  >
                    Összes elfogadása
                  </button>
                  <button
                    onClick={handleAcceptEssential}
                    className="text-xs sm:text-sm py-1.5 px-4 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Csak szükségesek
                  </button>
                  <button
                    onClick={() => setShowDetails(true)}
                    className="text-xs sm:text-sm py-1.5 px-4 text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Testreszabás
                  </button>
                </>
              )}
            </div>
          </div>
          <button
            onClick={handleAcceptEssential}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            aria-label="Bezárás"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function initSentryIfNeeded() {
  if (typeof window === 'undefined') return;
  if (process.env.NEXT_PUBLIC_ENABLE_SENTRY !== 'true') return;

  const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!SENTRY_DSN) return;

  import('@sentry/nextjs').then((Sentry) => {
    if (Sentry.getClient()) return; // Already initialized

    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.01,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      beforeSend(event) {
        if (event.user) {
          delete event.user.email;
          delete event.user.username;
        }
        if (event.request?.data) {
          event.request.data = '[Redacted - may contain PII]';
        }
        return event;
      },
    });
  }).catch(() => {});
}
