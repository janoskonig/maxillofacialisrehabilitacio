"use client";

import { useEffect, useRef, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PWARegister() {
  const refreshInProgressRef = useRef(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // SW regisztráció
    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

        // Ha van már waiting SW, kérjük meg, hogy aktiválódjon
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // Amikor települt, és van aktív SW, az update készen áll
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // Amikor a controller változik, az új SW átvette az irányítást
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshInProgressRef.current) return;
          
          // Rate limiting: maximum 1 update prompt per 5 perc
          const lastUpdateTime = localStorage.getItem("pwa-last-update-prompt");
          if (lastUpdateTime) {
            const timeSinceLastUpdate = Date.now() - parseInt(lastUpdateTime, 10);
            if (timeSinceLastUpdate < 300000) { // 5 perc
              return;
            }
          }
          
          localStorage.setItem("pwa-last-update-prompt", Date.now().toString());
          
          // Ellenőrzés: van-e "Később" gomb dismiss
          const dismissed = localStorage.getItem("pwa-update-dismissed");
          if (dismissed) {
            const timeSinceDismissed = Date.now() - parseInt(dismissed, 10);
            if (timeSinceDismissed < 3600000) { // 1 óra
              return;
            }
          }
          
          setUpdateAvailable(true);
        });
      } catch (e) {
        // Silent fail: PWA nem kritikus funkció, ne törje az appot
        if (process.env.NODE_ENV === "development") {
          console.error("SW registration failed", e);
        }
      }
    };

    register();
  }, []);

  // Update prompt kezelés: újratöltés gomb
  const handleReload = () => {
    setUpdateAvailable(false);
    refreshInProgressRef.current = true;
    window.location.reload();
  };

  // "Később" gomb kezelése
  const handleDismiss = () => {
    setUpdateAvailable(false);
    localStorage.setItem("pwa-update-dismissed", Date.now().toString());
  };

  // (Opcionális) Install prompt kezelés – UI nélkül csak elmentjük későbbre
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      // Itt elmentheted state-be és kirakhatsz "Install" gombot
      // const bipEvent = e as BeforeInstallPromptEvent;
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Update prompt komponens (ha updateAvailable)
  if (updateAvailable) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm">
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg shadow-lg p-4 flex items-start gap-3">
          <div className="flex-1 text-sm font-medium">
            Frissítés elérhető. Kattintson az &apos;Újratöltés&apos; gombra a legújabb verzió használatához.
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleReload}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
            >
              Újratöltés
            </button>
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 transition-colors"
            >
              Később
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
