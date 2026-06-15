'use client';

/**
 * Avatar — csatorna-független monogram/kép avatar a messaging felületekhez.
 *
 * A `PatientListAvatar` általánosítása: monogram-kinyerés, opcionális portré-kép
 * fallbackkal, determinisztikus szín a névből (sötét módban is olvasható
 * palettából), opcionális csoport-ikon és jelenlét-pötty (presence).
 */

import { useState } from 'react';
import { Users } from 'lucide-react';

interface AvatarPalette {
  bg: string;
  text: string;
}

/** Sötét/világos módban egyaránt olvasható, márka-közeli paletta. */
const PALETTE: AvatarPalette[] = [
  { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-700 dark:text-blue-200' },
  { bg: 'bg-teal-100 dark:bg-teal-900/50', text: 'text-teal-700 dark:text-teal-200' },
  { bg: 'bg-violet-100 dark:bg-violet-900/50', text: 'text-violet-700 dark:text-violet-200' },
  { bg: 'bg-pink-100 dark:bg-pink-900/50', text: 'text-pink-700 dark:text-pink-200' },
  { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-700 dark:text-amber-200' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-700 dark:text-emerald-200' },
  { bg: 'bg-cyan-100 dark:bg-cyan-900/50', text: 'text-cyan-700 dark:text-cyan-200' },
];

export function avatarMonogram(name?: string | null): string {
  if (!name || !name.trim()) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n.charAt(0))
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

function paletteFor(seed: string): AvatarPalette {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export type PresenceState = 'online' | 'offline';

interface AvatarProps {
  /** Megjelenített név — ebből készül a monogram és (seed hiányában) a szín. */
  name?: string | null;
  /** Stabil azonosító a szín determinisztikusságához (alapból a `name`). */
  seed?: string;
  /** Tailwind méret-osztály, pl. `h-9 w-9`. */
  sizeClass?: string;
  /** Monogram betűméret-osztály. */
  textClass?: string;
  /** Csoport-beszélgetés: a monogram helyett csoport-ikon. */
  group?: boolean;
  /** Portré URL — ha betölt, felülírja a monogramot. */
  imageUrl?: string | null;
  /** Jelenlét-pötty: `online` → zöld pötty a jobb alsó sarokban. `undefined` → nincs pötty. */
  presence?: PresenceState;
  /**
   * A jelenlét-pötty kerete a háttérrel egyezzen — alapból a felület fehér/sötét
   * háttere. Felülírható, ahol a sor háttere más (pl. aktív/kiemelt sor).
   */
  ringClass?: string;
  className?: string;
}

export function Avatar({
  name,
  seed,
  sizeClass = 'h-9 w-9',
  textClass = 'text-xs',
  group = false,
  imageUrl,
  presence,
  ringClass = 'ring-white dark:ring-gray-900',
  className = '',
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(imageUrl && !imgFailed);
  const palette = group
    ? { bg: 'bg-violet-100 dark:bg-violet-900/50', text: 'text-violet-700 dark:text-violet-200' }
    : paletteFor(seed || name || '?');

  return (
    <div className={`relative flex-shrink-0 ${sizeClass} ${className}`}>
      <div className={`${sizeClass} rounded-full overflow-hidden flex items-center justify-center ${palette.bg}`}>
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl as string}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : group ? (
          <Users className={`w-1/2 h-1/2 ${palette.text}`} aria-hidden="true" />
        ) : (
          <span className={`font-semibold ${textClass} ${palette.text}`}>{avatarMonogram(name)}</span>
        )}
      </div>
      {presence === 'online' && (
        <span
          className={`absolute bottom-0 right-0 block w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ${ringClass}`}
          aria-label="elérhető"
          role="img"
        />
      )}
    </div>
  );
}
