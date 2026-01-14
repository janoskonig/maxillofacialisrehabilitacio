/**
 * Validation utilities for security and data integrity
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a valid UUID
 */
export function isValidUUID(uuid: string | null | undefined): boolean {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }
  return UUID_REGEX.test(uuid.trim());
}

/**
 * Validates and sanitizes a UUID, throws error if invalid
 */
export function validateUUID(uuid: string | null | undefined, fieldName: string = 'ID'): string {
  if (!uuid || typeof uuid !== 'string') {
    throw new Error(`${fieldName} kötelező`);
  }
  const trimmed = uuid.trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw new Error(`Érvénytelen ${fieldName} formátum`);
  }
  return trimmed;
}

/**
 * Validates limit parameter (must be positive integer, max 1000)
 */
export function validateLimit(limit: number | null | undefined): number | undefined {
  if (limit === null || limit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Limit értéke pozitív egész szám kell legyen');
  }
  if (limit > 1000) {
    throw new Error('Limit értéke maximum 1000 lehet');
  }
  return limit;
}

/**
 * Validates offset parameter (must be non-negative integer)
 */
export function validateOffset(offset: number | null | undefined): number | undefined {
  if (offset === null || offset === undefined) {
    return undefined;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('Offset értéke nem negatív egész szám kell legyen');
  }
  return offset;
}

/**
 * Validates message text (max 10000 characters)
 */
export function validateMessageText(message: string | null | undefined, maxLength: number = 10000): string {
  if (!message || typeof message !== 'string') {
    throw new Error('Üzenet tartalma kötelező');
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new Error('Üzenet tartalma nem lehet üres');
  }
  if (trimmed.length > maxLength) {
    throw new Error(`Üzenet tartalma maximum ${maxLength} karakter lehet`);
  }
  return trimmed;
}

/**
 * Validates subject text (max 500 characters)
 */
export function validateSubject(subject: string | null | undefined, maxLength: number = 500): string | null {
  if (!subject || typeof subject !== 'string') {
    return null;
  }
  const trimmed = subject.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`Tárgy maximum ${maxLength} karakter lehet`);
  }
  return trimmed;
}
