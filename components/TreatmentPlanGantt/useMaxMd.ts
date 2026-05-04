import { useSyncExternalStore } from 'react';

/** md: 768px — mobil vs desktop (bottom sheet vs popover). */
export function useMaxMd() {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {};
      const mq = window.matchMedia('(max-width: 767px)');
      mq.addEventListener('change', onStoreChange);
      return () => mq.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia('(max-width: 767px)').matches,
    () => false
  );
}
