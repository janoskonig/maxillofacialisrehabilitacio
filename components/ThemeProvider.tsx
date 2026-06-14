'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Téma-szolgáltató: a felhasználó választása (világos/sötét/rendszer) localStorage-ba
 * mentve, alapból a rendszer beállítását (prefers-color-scheme) követi. A `class`
 * attribútum a <html>-re kerül, így a Tailwind `dark:` variánsok és a globals.css
 * komponens-réteg automatikusan vált. Az SSR/hydration villogást a next-themes
 * a <html suppressHydrationWarning>-gal és egy beékelt scripttel kezeli.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
