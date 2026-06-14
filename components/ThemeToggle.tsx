'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';

type ThemeChoice = 'light' | 'dark' | 'system';

const ORDER: ThemeChoice[] = ['light', 'dark', 'system'];

const META: Record<ThemeChoice, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: 'Világos' },
  dark: { icon: Moon, label: 'Sötét' },
  system: { icon: Monitor, label: 'Rendszer' },
};

/**
 * Téma-váltó: világos → sötét → rendszer körkörösen. A választás localStorage-ba
 * kerül (next-themes). A `variant="sidebar"` az oldalsáv láblécébe illeszkedik,
 * a `variant="icon"` egy kompakt ikongomb (pl. fejléc/mobil).
 */
export function ThemeToggle({ variant = 'sidebar' }: { variant?: 'sidebar' | 'icon' }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // A téma csak kliensen ismert — hydration-eltérés elkerülésére várjuk meg a mountot.
  useEffect(() => setMounted(true), []);

  const current = (mounted ? (theme as ThemeChoice) : 'system') ?? 'system';
  const safe: ThemeChoice = ORDER.includes(current) ? current : 'system';
  const { icon: Icon, label } = META[safe];

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(safe) + 1) % ORDER.length];
    setTheme(next);
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={cycle}
        aria-label={`Téma: ${label} (kattints a váltáshoz)`}
        title={`Téma: ${label}`}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
      >
        {/* mount előtt is renderelünk egy semleges ikont, hogy ne ugráljon a layout */}
        <Icon className="w-5 h-5" suppressHydrationWarning />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Téma: ${label} (kattints a váltáshoz)`}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
    >
      <Icon className="w-5 h-5 flex-shrink-0" suppressHydrationWarning />
      <span className="flex-1 min-w-0 truncate text-left" suppressHydrationWarning>
        Téma: {label}
      </span>
    </button>
  );
}
