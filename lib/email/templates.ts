/**
 * Format date for email notifications
 * Uses Europe/Budapest timezone consistently to avoid timezone issues
 * Returns formatted date in format: YYYY. MM. DD. HH:mm:ss
 */
export function formatDateForEmail(date: Date): string {
  const formatter = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const hours = parts.find(p => p.type === 'hour')?.value || '';
  const minutes = parts.find(p => p.type === 'minute')?.value || '';
  const seconds = parts.find(p => p.type === 'second')?.value || '';
  
  return `${year}. ${month}. ${day}. ${hours}:${minutes}:${seconds}`;
}

/**
 * Format date for email notifications (without seconds)
 * Uses Europe/Budapest timezone consistently
 * Returns formatted date in format: YYYY. MM. DD. HH:mm
 */
export function formatDateForEmailShort(date: Date): string {
  const formatter = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const hours = parts.find(p => p.type === 'hour')?.value || '';
  const minutes = parts.find(p => p.type === 'minute')?.value || '';
  
  return `${year}. ${month}. ${day}. ${hours}:${minutes}`;
}

/**
 * Get base URL for email links
 * Priority: 1. NEXT_PUBLIC_BASE_URL env var, 2. Request origin (dev), 3. Production URL
 */
export function getBaseUrlForEmail(request?: { headers?: { get: (name: string) => string | null }; nextUrl?: { origin: string } }): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  
  if (envBaseUrl) {
    return envBaseUrl;
  }
  
  if (process.env.NODE_ENV === 'development' && request) {
    const origin = request.headers?.get('origin') || request.nextUrl?.origin;
    if (origin) {
      return origin;
    }
  }
  
  return 'https://rehabilitacios-protetika.hu';
}
