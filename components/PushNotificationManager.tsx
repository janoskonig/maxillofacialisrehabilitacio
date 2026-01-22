"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/contexts/ToastContext";

interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export function usePushNotificationManager() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [publicKeyError, setPublicKeyError] = useState<string | null>(null);
  const { showToast } = useToast();

  // Subscription státusz ellenőrzése
  const checkSubscriptionStatus = useCallback(async () => {
    if (!("serviceWorker" in navigator)) {
      console.log('[Push] Service Worker not supported');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const isSub = !!subscription;
      console.log('[Push] Subscription status:', isSub ? 'subscribed' : 'not subscribed');
      setIsSubscribed(isSub);
    } catch (error) {
      console.error("[Push] Error checking subscription status:", error);
    }
  }, []);

  // VAPID public key betöltése
  const loadPublicKey = useCallback(async () => {
    try {
      const response = await fetch("/api/push/public-key");
      if (response.ok) {
        const data = await response.json();
        if (data.publicKey) {
          setPublicKey(data.publicKey);
          setPublicKeyError(null);
        } else {
          const errorMsg = "VAPID kulcs nem elérhető. Kérjük, futtassa: npm run vapid:generate";
          console.error("VAPID public key not found in response");
          setPublicKeyError(errorMsg);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.message || "VAPID kulcs betöltése sikertelen. Kérjük, futtassa: npm run vapid:generate";
        console.error("Failed to load VAPID public key:", response.status, errorData);
        setPublicKeyError(errorMsg);
      }
    } catch (error) {
      const errorMsg = "Hiba történt a VAPID kulcs betöltésekor. Kérjük, ellenőrizze a szerver konfigurációt.";
      console.error("Error loading VAPID public key:", error);
      setPublicKeyError(errorMsg);
    }
  }, [showToast]);

  // Ellenőrizzük a böngésző támogatását
  useEffect(() => {
    if (typeof window !== "undefined") {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      setIsSupported(supported);

      if (supported) {
        setPermission(Notification.permission);
        checkSubscriptionStatus();
        loadPublicKey();
      }
    }
  }, [checkSubscriptionStatus, loadPublicKey]);

  // Notification permission kérése
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!("Notification" in window)) {
      showToast("A böngésző nem támogatja az értesítéseket", "error");
      return false;
    }

    if (Notification.permission === "granted") {
      setPermission("granted");
      return true;
    }

    if (Notification.permission === "denied") {
      setPermission("denied");
      showToast(
        "Az értesítések le vannak tiltva. Kérjük, engedélyezze a böngésző beállításaiban.",
        "error"
      );
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") {
        showToast("Értesítések engedélyezve", "success");
        return true;
      } else {
        showToast("Az értesítések engedélyezése megtagadva", "error");
        return false;
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      showToast("Hiba történt az engedély kérésekor", "error");
      return false;
    }
  }, [showToast]);

  // Push subscription létrehozása és regisztrálása
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!publicKey) {
      showToast("VAPID kulcs nem elérhető", "error");
      return false;
    }

    if (!("serviceWorker" in navigator)) {
      showToast("Service Worker nem támogatott", "error");
      return false;
    }

    // Permission ellenőrzése
    if (permission !== "granted") {
      const granted = await requestPermission();
      if (!granted) {
        return false;
      }
    }

    try {
      // Ellenőrizzük, hogy a service worker regisztrálva van-e
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        // Ha nincs regisztrálva, regisztráljuk
        registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        // Várunk, amíg aktiválódik
        await navigator.serviceWorker.ready;
      }

      // Ellenőrizzük, hogy van-e már subscription
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        // Új subscription létrehozása
        try {
          const applicationServerKey = urlBase64ToUint8Array(publicKey);
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
          });
        } catch (subscribeError: any) {
          console.error("Error creating push subscription:", subscribeError);
          if (subscribeError.name === "NotAllowedError") {
            showToast("Az értesítések engedélyezése szükséges a push értesítésekhez", "error");
          } else if (subscribeError.name === "InvalidStateError") {
            showToast("A service worker nincs aktiválva. Kérjük, frissítse az oldalt.", "error");
          } else {
            showToast(`Hiba a feliratkozás során: ${subscribeError.message || "Ismeretlen hiba"}`, "error");
          }
          return false;
        }
      }

      // Subscription regisztrálása a backend-en
      const subscriptionData: PushSubscriptionData = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey("p256dh")!),
          auth: arrayBufferToBase64(subscription.getKey("auth")!),
        },
      };

      console.log('[Push] Sending subscription to backend:', {
        endpoint: subscription.endpoint.substring(0, 50) + '...',
        hasKeys: !!subscriptionData.keys
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(subscriptionData),
      });

      if (response.ok) {
        console.log('[Push] Subscription saved successfully');
        // Frissítjük a subscription státuszt
        await checkSubscriptionStatus();
        showToast("Push értesítések engedélyezve", "success");
        return true;
      } else {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[Push] Subscription failed:', response.status, error);
        showToast(error.error || "Hiba történt a feliratkozás során", "error");
        return false;
      }
    } catch (error) {
      console.error("Error subscribing to push:", error);
      showToast("Hiba történt a feliratkozás során", "error");
      return false;
    }
  }, [publicKey, permission, requestPermission, showToast, checkSubscriptionStatus]);

  // Push subscription törlése
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!("serviceWorker" in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Subscription törlése a backend-en
        const response = await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        if (response.ok) {
          // Subscription törlése a böngészőből
          await subscription.unsubscribe();
          // Frissítjük a subscription státuszt
          await checkSubscriptionStatus();
          showToast("Push értesítések letiltva", "success");
          return true;
        } else {
          showToast("Hiba történt a leiratkozás során", "error");
          return false;
        }
      }
    } catch (error) {
      console.error("Error unsubscribing from push:", error);
      showToast("Hiba történt a leiratkozás során", "error");
      return false;
    }

    return false;
  }, [showToast, checkSubscriptionStatus]);

  // Helper: URL base64 to Uint8Array
  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Helper: ArrayBuffer to base64
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  return {
    isSupported,
    permission,
    isSubscribed,
    publicKey,
    publicKeyError,
    requestPermission,
    subscribe,
    unsubscribe,
  };
}

// Export as hook (backward compatibility)
export const PushNotificationManager = usePushNotificationManager;
