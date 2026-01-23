'use client';

import { useState, useEffect } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * SSR-safe breakpoint hook
 * Returns "desktop" on SSR (stable markup), then updates on client after hydration
 * 
 * Breakpoints:
 * - mobile: < 768px
 * - tablet: 768px - 1023px
 * - desktop: >= 1024px
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop');

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const tabletQuery = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');

    const updateBreakpoint = () => {
      if (mobileQuery.matches) {
        setBreakpoint('mobile');
      } else if (tabletQuery.matches) {
        setBreakpoint('tablet');
      } else {
        setBreakpoint('desktop');
      }
    };

    // Set initial value
    updateBreakpoint();

    // Add listeners
    const handleMobileChange = () => updateBreakpoint();
    const handleTabletChange = () => updateBreakpoint();

    // Modern browsers
    if (mobileQuery.addEventListener) {
      mobileQuery.addEventListener('change', handleMobileChange);
      tabletQuery.addEventListener('change', handleTabletChange);
    } else {
      // Fallback for older browsers
      mobileQuery.addListener(handleMobileChange);
      tabletQuery.addListener(handleTabletChange);
    }

    // Cleanup
    return () => {
      if (mobileQuery.removeEventListener) {
        mobileQuery.removeEventListener('change', handleMobileChange);
        tabletQuery.removeEventListener('change', handleTabletChange);
      } else {
        mobileQuery.removeListener(handleMobileChange);
        tabletQuery.removeListener(handleTabletChange);
      }
    };
  }, []);

  return breakpoint;
}
