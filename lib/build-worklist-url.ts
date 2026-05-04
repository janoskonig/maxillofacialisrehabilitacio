/** Build worklist deep link URL (client-safe, no server imports). */
export function buildWorklistUrl(episodeId: string, stepCode: string, pool: string): string {
  const params = new URLSearchParams();
  params.set('tab', 'worklist');
  params.set('episodeId', episodeId);
  params.set('stepCode', stepCode);
  params.set('pool', pool);
  return `/?${params.toString()}`;
}
