'use client';

import { useState, useEffect } from 'react';

/**
 * Detects if the device supports touch
 * Returns false on SSR (client-only detection)
 */
export function useTouchDevice(): boolean {
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    setIsTouchDevice(
      'ontouchstart' in window || navigator.maxTouchPoints > 0
    );
  }, []);

  return isTouchDevice;
}
