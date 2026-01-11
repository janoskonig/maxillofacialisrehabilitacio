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
const VALID_TAGS = ['op', 'foto', 'zarojelentes', 'ambulans lap'];

/**
 * Normalize tag value to internal format
 */
function normalizeTag(tagValue: string): string | undefined {
  const normalized = tagValue.toLowerCase().trim();
  
  // Direct match
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
    'önarckép': 'foto',
    'arcfotó': 'foto',
    'szájfotó': 'foto',
    'selfie': 'foto',
    'zárójelentés': 'zarojelentes',
    'záró jelentés': 'zarojelentes',
    'ambuláns lap': 'ambulans lap',
    'ambuláns': 'ambulans lap',
  };
  
  return tagMap[normalized] || undefined;
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
  
  // Extract tag: tag="OP" or tag='OP' or tag=OP
  const tagMatch = commandBody.match(/tag\s*=\s*["']?([^"'\s]+)["']?/i);
  if (!tagMatch) {
    // Invalid command - missing tag
    return null;
  }
  
  const tagValue = tagMatch[1];
  const normalizedTag = normalizeTag(tagValue);
  
  if (!normalizedTag) {
    // Invalid tag value
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
  // First try to parse as /request command
  const commandResult = parseRequestCommand(text);
  if (commandResult) {
    return commandResult;
  }
  
  // If not a command, return no request detected
  return {
    isDocumentRequest: false,
  };
}
