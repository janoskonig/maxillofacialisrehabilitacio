/**
 * Betegportál „kényelmi mód”: betűméret- és érintésicél-skálázás.
 *
 * A skála a <html> elem font-size-át emeli (globals.css:
 * .portal-scale-nagy / .portal-scale-extra), így minden rem-alapú méret —
 * szöveg, gomb-padding, érintési célok — arányosan nő. A beállítás a
 * patients.portal_display_scale oszlopban él (eszközök között követi a
 * beteget), localStorage-ben cache-elve a villanásmentes betöltéshez.
 */

export const PORTAL_DISPLAY_SCALES = ['normal', 'nagy', 'extra'] as const;
export type PortalDisplayScale = (typeof PORTAL_DISPLAY_SCALES)[number];

export const PORTAL_SCALE_LABELS: Record<PortalDisplayScale, string> = {
  normal: 'Normál',
  nagy: 'Nagy',
  extra: 'Extra nagy',
};

/** A fejléc „Aa” gombja ebben a sorrendben lépteti a fokozatokat. */
export const NEXT_PORTAL_SCALE: Record<PortalDisplayScale, PortalDisplayScale> = {
  normal: 'nagy',
  nagy: 'extra',
  extra: 'normal',
};

export const PORTAL_SCALE_STORAGE_KEY = 'portal-display-scale';

/** Ablakon belüli szinkron a fejléc „Aa” gomb és a Profil-kártya között. */
export const PORTAL_SCALE_EVENT = 'portal-display-scale-change';

/**
 * Fokozatváltás egy helyen: html-osztály + localStorage + szerver-mentés +
 * esemény a többi komponensnek. Mindkét vezérlő (fejléc, Profil) ezt hívja.
 */
export function setPortalScale(scale: PortalDisplayScale): void {
  applyPortalScaleToHtml(scale);
  try {
    window.localStorage.setItem(PORTAL_SCALE_STORAGE_KEY, scale);
  } catch {}
  window.dispatchEvent(new CustomEvent<PortalDisplayScale>(PORTAL_SCALE_EVENT, { detail: scale }));
  fetch('/api/patient-portal/display-scale', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scale }),
  }).catch(() => {});
}

export function isPortalDisplayScale(value: unknown): value is PortalDisplayScale {
  return typeof value === 'string' && (PORTAL_DISPLAY_SCALES as readonly string[]).includes(value);
}

/** A <html>-re teendő osztály; normál fokozatnál nincs osztály. */
export function portalScaleHtmlClass(scale: PortalDisplayScale): string | null {
  if (scale === 'nagy') return 'portal-scale-nagy';
  if (scale === 'extra') return 'portal-scale-extra';
  return null;
}

const ALL_SCALE_CLASSES = ['portal-scale-nagy', 'portal-scale-extra'];

/** Felteszi a megfelelő skála-osztályt a <html>-re (a többit leszedi). */
export function applyPortalScaleToHtml(scale: PortalDisplayScale): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.remove(...ALL_SCALE_CLASSES);
  const cls = portalScaleHtmlClass(scale);
  if (cls) html.classList.add(cls);
}

/** Portál elhagyásakor minden skála-osztály lekerül. */
export function clearPortalScaleFromHtml(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.remove(...ALL_SCALE_CLASSES);
}
