import { describe, it, expect } from 'vitest';
import {
  parseReplyToMessageId,
  buildQuotedMessagePreviewText,
  isDoctorReplyTargetInScope,
  isPatientReplyTargetInScope,
  isReplyToMessageIdShape,
  buildQuotedMessagePreview,
  derivePatientLaneDoctorId,
  canPatientReplySenderSeeTarget,
  ReplyTargetNotFoundError,
  QUOTED_MESSAGE_PREVIEW_MAX,
} from '@/lib/message-reply';

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';
const VALID_UUID_C = '33333333-3333-4333-8333-333333333333';
const VALID_UUID_GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('parseReplyToMessageId', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseReplyToMessageId(null)).toBeNull();
    expect(parseReplyToMessageId(undefined)).toBeNull();
    expect(parseReplyToMessageId('')).toBeNull();
    expect(parseReplyToMessageId('   ')).toBeNull();
  });

  it('returns trimmed UUID for valid input', () => {
    expect(parseReplyToMessageId(`  ${VALID_UUID_A}  `)).toBe(VALID_UUID_A);
  });

  it('throws on non-string input', () => {
    expect(() => parseReplyToMessageId(123 as unknown as string)).toThrow(
      /formátuma érvénytelen/i,
    );
    expect(() => parseReplyToMessageId({} as unknown as string)).toThrow();
  });

  it('throws on malformed UUID', () => {
    expect(() => parseReplyToMessageId('not-a-uuid')).toThrow(/replyToMessageId/);
    expect(() => parseReplyToMessageId('11111111-1111-1111-1111')).toThrow();
  });
});

describe('buildQuotedMessagePreviewText', () => {
  it('returns empty string for nullish input', () => {
    expect(buildQuotedMessagePreviewText(null)).toBe('');
    expect(buildQuotedMessagePreviewText(undefined)).toBe('');
  });

  it('collapses whitespace and newlines', () => {
    expect(buildQuotedMessagePreviewText('  hello\nworld   \t!  ')).toBe('hello world !');
  });

  it('keeps short text untouched', () => {
    expect(buildQuotedMessagePreviewText('rövid')).toBe('rövid');
  });

  it('truncates above the limit with ellipsis', () => {
    const long = 'a'.repeat(QUOTED_MESSAGE_PREVIEW_MAX + 50);
    const out = buildQuotedMessagePreviewText(long);
    expect(out.length).toBe(QUOTED_MESSAGE_PREVIEW_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('respects custom max', () => {
    expect(buildQuotedMessagePreviewText('abcdefghij', 5)).toBe('abcd…');
  });

  it('coerces non-string input via String()', () => {
    expect(buildQuotedMessagePreviewText(42 as unknown as string)).toBe('42');
  });
});

describe('isDoctorReplyTargetInScope — group', () => {
  it('accepts target in the same group', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: VALID_UUID_GROUP, senderId: VALID_UUID_A, recipientId: null },
        { kind: 'group', groupId: VALID_UUID_GROUP },
      ),
    ).toBe(true);
  });

  it('rejects target in a different group', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: VALID_UUID_B, senderId: VALID_UUID_A, recipientId: null },
        { kind: 'group', groupId: VALID_UUID_GROUP },
      ),
    ).toBe(false);
  });

  it('rejects a 1:1 target when group scope is requested', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: null, senderId: VALID_UUID_A, recipientId: VALID_UUID_B },
        { kind: 'group', groupId: VALID_UUID_GROUP },
      ),
    ).toBe(false);
  });
});

describe('isDoctorReplyTargetInScope — 1:1', () => {
  const scope = {
    kind: 'direct' as const,
    userAId: VALID_UUID_A,
    userBId: VALID_UUID_B,
  };

  it('accepts target A→B', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: null, senderId: VALID_UUID_A, recipientId: VALID_UUID_B },
        scope,
      ),
    ).toBe(true);
  });

  it('accepts target B→A (order independent)', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: null, senderId: VALID_UUID_B, recipientId: VALID_UUID_A },
        scope,
      ),
    ).toBe(true);
  });

  it('rejects target involving a third user', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: null, senderId: VALID_UUID_A, recipientId: VALID_UUID_C },
        scope,
      ),
    ).toBe(false);
  });

  it('rejects a group target when 1:1 scope is requested', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: VALID_UUID_GROUP, senderId: VALID_UUID_A, recipientId: null },
        scope,
      ),
    ).toBe(false);
  });

  it('rejects target with null recipient (corrupt/group-leak)', () => {
    expect(
      isDoctorReplyTargetInScope(
        { groupId: null, senderId: VALID_UUID_A, recipientId: null },
        scope,
      ),
    ).toBe(false);
  });
});

describe('isPatientReplyTargetInScope', () => {
  it('accepts same patient_id', () => {
    expect(
      isPatientReplyTargetInScope({ patientId: VALID_UUID_A }, { patientId: VALID_UUID_A }),
    ).toBe(true);
  });
  it('rejects other patient_id', () => {
    expect(
      isPatientReplyTargetInScope({ patientId: VALID_UUID_A }, { patientId: VALID_UUID_B }),
    ).toBe(false);
  });
});

describe('isReplyToMessageIdShape', () => {
  it('is true for valid UUID', () => {
    expect(isReplyToMessageIdShape(VALID_UUID_A)).toBe(true);
  });
  it('is false for non-string / invalid', () => {
    expect(isReplyToMessageIdShape(null)).toBe(false);
    expect(isReplyToMessageIdShape(undefined)).toBe(false);
    expect(isReplyToMessageIdShape(42)).toBe(false);
    expect(isReplyToMessageIdShape('foo')).toBe(false);
  });
});

describe('buildQuotedMessagePreview', () => {
  it('builds DTO from DB-shaped input', () => {
    const created = new Date('2026-05-26T12:00:00Z');
    const preview = buildQuotedMessagePreview({
      id: VALID_UUID_A,
      channel: 'doctor',
      senderId: VALID_UUID_B,
      senderName: 'Dr. Teszt',
      message: '  Hosszú\nüzenet sortöréssel  ',
      createdAt: created,
    });
    expect(preview).toEqual({
      id: VALID_UUID_A,
      channel: 'doctor',
      senderId: VALID_UUID_B,
      senderName: 'Dr. Teszt',
      message: 'Hosszú üzenet sortöréssel',
      createdAt: created,
      deleted: false,
    });
  });

  it('coerces ISO string createdAt to Date', () => {
    const preview = buildQuotedMessagePreview({
      id: VALID_UUID_A,
      channel: 'patient',
      senderId: VALID_UUID_B,
      senderName: null,
      message: 'hi',
      createdAt: '2026-05-26T12:00:00.000Z',
    });
    expect(preview.createdAt).toBeInstanceOf(Date);
    expect(preview.createdAt.toISOString()).toBe('2026-05-26T12:00:00.000Z');
  });

  it('blanks message when deleted=true', () => {
    const preview = buildQuotedMessagePreview({
      id: VALID_UUID_A,
      channel: 'doctor',
      senderId: VALID_UUID_B,
      senderName: 'Dr. X',
      message: 'eredeti szöveg',
      createdAt: new Date(),
      deleted: true,
    });
    expect(preview.message).toBe('');
    expect(preview.deleted).toBe(true);
  });
});

describe('derivePatientLaneDoctorId', () => {
  it('uses recipient_doctor_id for patient-authored rows', () => {
    expect(
      derivePatientLaneDoctorId({
        patientId: VALID_UUID_A,
        senderType: 'patient',
        senderId: VALID_UUID_A,
        recipientDoctorId: VALID_UUID_B,
      }),
    ).toBe(VALID_UUID_B);
  });
  it('returns null for legacy patient rows (recipient_doctor_id IS NULL)', () => {
    expect(
      derivePatientLaneDoctorId({
        patientId: VALID_UUID_A,
        senderType: 'patient',
        senderId: VALID_UUID_A,
        recipientDoctorId: null,
      }),
    ).toBeNull();
  });
  it('uses sender_id for doctor-authored rows', () => {
    expect(
      derivePatientLaneDoctorId({
        patientId: VALID_UUID_A,
        senderType: 'doctor',
        senderId: VALID_UUID_C,
        recipientDoctorId: null,
      }),
    ).toBe(VALID_UUID_C);
  });
});

describe('canPatientReplySenderSeeTarget', () => {
  // Sender oldali "lát-e a parent-re?" check a 0.3 reply gate-hez.
  // Pontosan azt tükrözi, amit a `getPatientMessages` GET-en megengedne.
  const patientId = VALID_UUID_A;
  const doctorX = VALID_UUID_B;
  const doctorY = VALID_UUID_C;

  // ---- Same patient_id előkapu ----
  it('rejects targets from a different patient', () => {
    const wrongPatient = { ...someParentPatientToDoctor(doctorX), patientId: VALID_UUID_GROUP };
    expect(
      canPatientReplySenderSeeTarget(
        wrongPatient,
        { kind: 'doctor', doctorId: doctorX, isAdmin: false, isTreating: true },
        patientId,
      ),
    ).toBe(false);
  });

  // ---- Doctor sender ----
  describe('doctor sender (non-admin)', () => {
    it('accepts own previously-sent doctor message', () => {
      const target = someParentDoctorAuthored(doctorX);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'doctor', doctorId: doctorX, isAdmin: false, isTreating: true },
          patientId,
        ),
      ).toBe(true);
    });

    it('accepts patient → me lane', () => {
      const target = someParentPatientToDoctor(doctorX);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'doctor', doctorId: doctorX, isAdmin: false, isTreating: true },
          patientId,
        ),
      ).toBe(true);
    });

    it('rejects patient → other doctor (cross-lane)', () => {
      const target = someParentPatientToDoctor(doctorY);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'doctor', doctorId: doctorX, isAdmin: false, isTreating: true },
          patientId,
        ),
      ).toBe(false);
    });

    it('rejects another doctor’s doctor-authored parent (cross-lane)', () => {
      const target = someParentDoctorAuthored(doctorY);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'doctor', doctorId: doctorX, isAdmin: false, isTreating: true },
          patientId,
        ),
      ).toBe(false);
    });

    it('accepts legacy null-lane patient parent if treating', () => {
      const target = someParentPatientLegacyNull();
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'doctor', doctorId: doctorX, isAdmin: false, isTreating: true },
          patientId,
        ),
      ).toBe(true);
    });

    it('rejects legacy null-lane patient parent if NOT treating', () => {
      const target = someParentPatientLegacyNull();
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'doctor', doctorId: doctorX, isAdmin: false, isTreating: false },
          patientId,
        ),
      ).toBe(false);
    });
  });

  // ---- Admin doctor sender ----
  describe('doctor sender (admin)', () => {
    it('accepts any parent in the same patient (even cross-lane)', () => {
      const target = someParentPatientToDoctor(doctorY);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'doctor', doctorId: doctorX, isAdmin: true, isTreating: false },
          patientId,
        ),
      ).toBe(true);
    });
    it('rejects parent from a different patient even for admin', () => {
      const wrong = { ...someParentDoctorAuthored(doctorY), patientId: VALID_UUID_GROUP };
      expect(
        canPatientReplySenderSeeTarget(
          wrong,
          { kind: 'doctor', doctorId: doctorX, isAdmin: true, isTreating: false },
          patientId,
        ),
      ).toBe(false);
    });
  });

  // ---- Patient sender ----
  describe('patient sender', () => {
    it('accepts parent in the same lane (patient → doctorX)', () => {
      const target = someParentPatientToDoctor(doctorX);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'patient', patientId, laneDoctorId: doctorX },
          patientId,
        ),
      ).toBe(true);
    });
    it('accepts parent in the same lane (doctorX → patient)', () => {
      const target = someParentDoctorAuthored(doctorX);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'patient', patientId, laneDoctorId: doctorX },
          patientId,
        ),
      ).toBe(true);
    });
    it('rejects parent in another doctor’s lane', () => {
      const target = someParentDoctorAuthored(doctorY);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'patient', patientId, laneDoctorId: doctorX },
          patientId,
        ),
      ).toBe(false);
    });
    it('accepts legacy null-lane parent only when patient lane is null', () => {
      const target = someParentPatientLegacyNull();
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'patient', patientId, laneDoctorId: null },
          patientId,
        ),
      ).toBe(true);
      expect(
        canPatientReplySenderSeeTarget(
          target,
          { kind: 'patient', patientId, laneDoctorId: doctorX },
          patientId,
        ),
      ).toBe(false);
    });
  });

  // ---- Helpers ----
  function someParentDoctorAuthored(doctorId: string) {
    return {
      patientId,
      senderType: 'doctor' as const,
      senderId: doctorId,
      recipientDoctorId: null,
    };
  }
  function someParentPatientToDoctor(doctorId: string) {
    return {
      patientId,
      senderType: 'patient' as const,
      senderId: patientId,
      recipientDoctorId: doctorId,
    };
  }
  function someParentPatientLegacyNull() {
    return {
      patientId,
      senderType: 'patient' as const,
      senderId: patientId,
      recipientDoctorId: null,
    };
  }
});

describe('ReplyTargetNotFoundError', () => {
  it('has the expected name and default message', () => {
    const err = new ReplyTargetNotFoundError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ReplyTargetNotFoundError');
    expect(err.message).toMatch(/válasz cél üzenet/i);
  });

  it('carries HTTP status 404 + code for handleApiError', () => {
    // Szerződés a `lib/api-error-handler` felé: a 0.2 route handler
    // erre épít, amikor cross-thread replyre 404-et akar visszaadni.
    const err = new ReplyTargetNotFoundError();
    expect(err.status).toBe(404);
    expect(err.code).toBe('REPLY_TARGET_NOT_FOUND');
  });
});
