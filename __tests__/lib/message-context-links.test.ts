import { describe, it, expect } from 'vitest';
import {
  parseContextEntityType,
  parseContextEntityId,
  MessageContextError,
} from '@/lib/messaging/context-links';

describe('message-context-links parsers', () => {
  it('accepts valid entity types', () => {
    expect(parseContextEntityType('document')).toBe('document');
    expect(parseContextEntityType('patient')).toBe('patient');
  });

  it('rejects invalid entity type', () => {
    expect(() => parseContextEntityType('unknown')).toThrow(MessageContextError);
    try {
      parseContextEntityType('foo');
    } catch (e) {
      expect((e as MessageContextError).status).toBe(400);
      expect((e as MessageContextError).code).toBe('INVALID_ENTITY_TYPE');
    }
  });

  it('parses valid entity id', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(parseContextEntityId(id)).toBe(id);
  });

  it('rejects invalid entity id', () => {
    expect(() => parseContextEntityId('not-a-uuid')).toThrow(MessageContextError);
  });
});
