import { getDbPool } from './db';

/**
 * Extract patient mentions from message text
 * Mentions are in format: @vezeteknev+keresztnev (e.g., @kovacs+janos)
 * Returns array of patient IDs
 */
/**
 * Normalize patient name to mention format
 * This must match exactly the format used in the API
 */
function normalizeToMentionFormat(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, '+') // Replace spaces with +
    .replace(/[^a-z0-9+]/g, '') // Only letters, numbers and +
    .trim();
}

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

  // Get all patients once
  const allPatientsResult = await pool.query(
    `SELECT id, nev FROM patients WHERE nev IS NOT NULL AND TRIM(nev) != ''`
  );

  // Create a map of normalized mention format -> patient IDs
  // This allows us to handle multiple patients with the same normalized name
  const mentionFormatToPatientIds = new Map<string, string[]>();
  
  for (const row of allPatientsResult.rows) {
    const nev = row.nev.trim();
    const normalizedMention = normalizeToMentionFormat(nev);
    const fullMentionFormat = `@${normalizedMention}`;
    
    if (!mentionFormatToPatientIds.has(fullMentionFormat)) {
      mentionFormatToPatientIds.set(fullMentionFormat, []);
    }
    mentionFormatToPatientIds.get(fullMentionFormat)!.push(row.id);
  }

  // Match mention formats from message to patient IDs
  for (const mentionFormat of Array.from(mentionFormats)) {
    const matchingPatientIds = mentionFormatToPatientIds.get(mentionFormat);
    
    if (matchingPatientIds && matchingPatientIds.length > 0) {
      // Add all matching patient IDs (in case multiple patients have the same normalized name)
      for (const patientId of matchingPatientIds) {
        if (!patientIds.includes(patientId)) {
          patientIds.push(patientId);
        }
      }
    } else {
      // Log if mention format not found (for debugging)
      const mentionWithoutAt = mentionFormat.substring(1);
      console.warn('[extractPatientMentions] Patient not found for mention format:', {
        mentionFormat,
        mentionWithoutAt,
        totalPatients: allPatientsResult.rows.length,
        sampleNormalizedMentions: Array.from(mentionFormatToPatientIds.keys()).slice(0, 10),
        sampleNames: allPatientsResult.rows.slice(0, 5).map((r: any) => ({
          name: r.nev,
          normalized: normalizeToMentionFormat(r.nev),
          fullFormat: `@${normalizeToMentionFormat(r.nev)}`
        }))
      });
    }
  }

  console.log('[extractPatientMentions] Extracted patient IDs:', {
    mentionFormats: Array.from(mentionFormats),
    patientIds,
    messagePreview: messageText.substring(0, 100)
  });

  return patientIds;
}

/**
 * Get mention format from patient name
 * Converts "Kovács János" to "@kovacs+janos"
 * Must match the format used in extractPatientMentions and API
 */
export function getMentionFormatFromName(name: string): string {
  if (!name) return '';
  
  // Use the same normalization function
  const mentionFormat = normalizeToMentionFormat(name);
  
  return mentionFormat ? `@${mentionFormat}` : '';
}

