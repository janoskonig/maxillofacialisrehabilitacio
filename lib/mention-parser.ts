import { getDbPool } from './db';

/**
 * Extract patient mentions from message text
 * Mentions are in format: @vezeteknev+keresztnev (e.g., @kovacs+janos)
 * Returns array of patient IDs
 */
export async function extractPatientMentions(messageText: string): Promise<string[]> {
  // Regex to match @mentions: @word+word (e.g., @kovacs+janos)
  const mentionRegex = /@([a-z0-9+]+)/gi;
  const mentionFormats = new Set<string>();
  
  let match;
  while ((match = mentionRegex.exec(messageText)) !== null) {
    const mentionFormat = match[0].toLowerCase(); // @kovacs+janos
    mentionFormats.add(mentionFormat);
  }

  if (mentionFormats.size === 0) {
    return [];
  }

  // Find patient IDs for each mention format
  const pool = getDbPool();
  const patientIds: string[] = [];

  for (const mentionFormat of Array.from(mentionFormats)) {
    // Remove @ symbol
    const mentionWithoutAt = mentionFormat.substring(1); // kovacs+janos
    
    // The mention format matches the format used in the API: lowercase, normalized, + separated
    // We need to find patients by matching their normalized mention format
    // Get all patients and match by mentionFormat
    const result = await pool.query(
      `SELECT id, nev FROM patients WHERE nev IS NOT NULL AND TRIM(nev) != ''`
    );

    for (const row of result.rows) {
      const nev = row.nev.trim();
      // Generate mention format the same way as the API does
      const patientMentionFormat = nev
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/\s+/g, '+') // Replace spaces with +
        .replace(/[^a-z0-9+]/g, ''); // Only letters, numbers and +
      
      const fullMentionFormat = `@${patientMentionFormat}`;
      
      if (fullMentionFormat === mentionFormat) {
        const patientId = row.id;
        if (!patientIds.includes(patientId)) {
          patientIds.push(patientId);
        }
        break; // Found match, no need to continue
      }
    }
  }

  return patientIds;
}

/**
 * Get mention format from patient name
 * Converts "Kovács János" to "@kovacs+janos"
 */
export function getMentionFormatFromName(name: string): string {
  if (!name) return '';
  
  // Normalize: lowercase, remove accents, split by space
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .trim();
  
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    const vezeteknev = parts[0];
    const keresztnev = parts[parts.length - 1];
    return `@${vezeteknev}+${keresztnev}`;
  }
  
  return '';
}

