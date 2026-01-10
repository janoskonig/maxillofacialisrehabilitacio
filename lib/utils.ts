/**
 * Monogram generálása névből
 * Visszaadja a vezetéknév első betűjét és a keresztnév első betűjét
 */
export function getMonogram(name: string | null | undefined): string {
  if (!name) return '?';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  
  const firstInitial = parts[0][0]?.toUpperCase() || '';
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : '';
  
  return (firstInitial + lastInitial) || '?';
}

/**
 * Vezetéknév kinyerése teljes névből
 */
export function getLastName(name: string | null | undefined): string {
  if (!name) return '';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  
  return parts[parts.length - 1] || '';
}


