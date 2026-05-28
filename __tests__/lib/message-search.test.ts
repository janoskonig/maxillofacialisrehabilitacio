import { describe, it, expect } from 'vitest';
import {
  normalizeSearchQuery,
  MessageSearchError,
  parsePatientSearchFilters,
  parseDoctorSearchFilters,
} from '@/lib/messaging/search';

describe('message-search', () => {
  describe('normalizeSearchQuery', () => {
    it('trims and accepts valid query', () => {
      expect(normalizeSearchQuery('  kontroll  ')).toBe('kontroll');
    });

    it('rejects empty query', () => {
      expect(() => normalizeSearchQuery('')).toThrow(MessageSearchError);
      try {
        normalizeSearchQuery('x');
      } catch (e) {
        expect((e as MessageSearchError).code).toBe('QUERY_TOO_SHORT');
      }
    });

    it('rejects overly long query', () => {
      expect(() => normalizeSearchQuery('a'.repeat(201))).toThrow(MessageSearchError);
    });
  });

  describe('parsePatientSearchFilters', () => {
    it('parses minimal query', () => {
      const sp = new URLSearchParams({ q: 'dokumentum' });
      const f = parsePatientSearchFilters(sp);
      expect(f.q).toBe('dokumentum');
      expect(f.patientId).toBeUndefined();
    });

    it('requires both entity filters', () => {
      const sp = new URLSearchParams({
        q: 'teszt',
        entityType: 'document',
      });
      expect(() => parsePatientSearchFilters(sp)).toThrow(MessageSearchError);
    });

    it('parses entity filter pair', () => {
      const docId = '550e8400-e29b-41d4-a716-446655440000';
      const sp = new URLSearchParams({
        q: 'teszt',
        entityType: 'document',
        entityId: docId,
        hasAttachment: 'true',
      });
      const f = parsePatientSearchFilters(sp);
      expect(f.entityType).toBe('document');
      expect(f.entityId).toBe(docId);
      expect(f.hasAttachment).toBe(true);
    });
  });

  describe('parseDoctorSearchFilters', () => {
    it('parses recipient scope', () => {
      const rid = '550e8400-e29b-41d4-a716-446655440001';
      const sp = new URLSearchParams({ q: 'meeting', recipientId: rid });
      const f = parseDoctorSearchFilters(sp);
      expect(f.recipientId).toBe(rid);
    });
  });
});
