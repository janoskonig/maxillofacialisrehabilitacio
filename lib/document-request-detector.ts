/**
 * Detects document requests in message text
 * Supports command syntax: /request @vezeteknev+keresztnev tag="OP"
 */

export interface DocumentRequestInfo {
  isDocumentRequest: boolean;
  tag?: string; // 'op', 'foto', 'zarojelentes', 'ambulans lap', or undefined
  patientMention?: string; // @mention format if found
  patientName?: string; // Patient name from text if found
}

// Valid document tags (normalized)
const VALID_TAGS = ['op', 'foto', 'zarojelentes', 'ambulans lap', 'egyeb'];

/**
 * Normalize tag value to internal format
 */
function normalizeTag(tagValue: string): string | undefined {
  const trimmed = tagValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();

  // Direct match (built-in document types)
  if (VALID_TAGS.includes(normalized)) {
    return normalized;
  }

  // Map common variations
  const tagMap: Record<string, string> = {
    'op': 'op',
    'panorámaröntgen': 'op',
    'panorama': 'op',
    'röntgen': 'op',
    'orthopantomogram': 'op',
    'foto': 'foto',
    'portré': 'foto',
    'portre': 'foto',
    'önarckép': 'foto',
    'arcfotó': 'foto',
    'szájfotó': 'foto',
    'selfie': 'foto',
    'zárójelentés': 'zarojelentes',
    'záró jelentés': 'zarojelentes',
    'ambuláns lap': 'ambulans lap',
    'ambuláns': 'ambulans lap',
    'ambulanslap': 'ambulans lap',
    'ambulans': 'ambulans lap',
    'egyeb': 'egyeb',
    'általános': 'egyeb',
    'altalanos': 'egyeb',
  };

  const mapped = tagMap[normalized];
  if (mapped) {
    return mapped;
  }

  // Egyéb, rendszerben használt címkék (patient_documents.tags) — eredeti írásmód megmarad
  return trimmed;
}

/**
 * Parse /request command syntax
 * Format: /request @vezeteknev+keresztnev tag="OP"
 */
function parseRequestCommand(text: string): DocumentRequestInfo | null {
  // Check if text starts with /request
  const requestMatch = text.match(/^\/request\s+(.+)$/i);
  if (!requestMatch) {
    return null;
  }
  
  const commandBody = requestMatch[1].trim();
  
  // Extract mention: @vezeteknev+keresztnev
  const mentionMatch = commandBody.match(/@([a-z0-9+]+)/i);
  const patientMention = mentionMatch ? `@${mentionMatch[1]}` : undefined;
  
  // Extract tag: tag="ambulans lap", tag='OP', or tag=OP
  const tagQuoted =
    commandBody.match(/tag\s*=\s*"([^"]+)"/i) ||
    commandBody.match(/tag\s*=\s*'([^']+)'/i);
  const tagBare = commandBody.match(/tag\s*=\s*([^\s"']+)/i);
  const tagMatch = tagQuoted || tagBare;
  if (!tagMatch) {
    return null;
  }

  const tagValue = tagMatch[1];
  const normalizedTag = normalizeTag(tagValue);

  if (!normalizedTag) {
    return null;
  }

  return {
    isDocumentRequest: true,
    tag: normalizedTag,
    patientMention: patientMention,
    patientName: undefined, // Not extracted from command syntax
  };
}

/**
 * Detect document request in message text
 * Supports command syntax: /request @vezeteknev+keresztnev tag="OP"
 */
export function detectDocumentRequest(text: string): DocumentRequestInfo {
  // Only the first line may contain the /request command; subsequent lines can be a human note.
  // This keeps document request detection stable even when the message contains extra text.
  const firstLine = (text || '').split(/\r?\n/)[0] || '';

  // First try to parse as /request command (first line only)
  const commandResult = parseRequestCommand(firstLine);
  if (commandResult) {
    return commandResult;
  }
  
  // If not a command, return no request detected
  return {
    isDocumentRequest: false,
  };
}
