import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getDbPool: () => ({ query: queryMock }),
}));

vi.mock('@/lib/auth-server', () => ({
  verifyAuth: vi.fn(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.name = 'HttpError';
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/api-error-handler', () => ({
  handleApiError: vi.fn((error: any, msg: string, correlationId?: string) => {
    const status = error?.status || 500;
    const res = NextResponse.json({ error: error?.message || msg }, { status });
    if (correlationId) res.headers.set('x-correlation-id', correlationId);
    return res;
  }),
}));

vi.mock('@/lib/legal/patient-data-access-log', () => ({
  maybeLogPatientAccess: vi.fn(),
}));

vi.mock('@/lib/activity', () => ({
  logActivityWithAuth: vi.fn(async () => undefined),
  logActivity: vi.fn(async () => undefined),
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 29, resetAt: Date.now() + 60_000 })),
  buildRateLimitedResponse: vi.fn(() => ({ body: { error: 'rate' }, retryAfterSeconds: 60 })),
}));

const uploadChatAttachmentMock = vi.fn(
  async (_buffer: Buffer, _filename: string) => '/patients/_chat-attachments/chat_u1_2026-01-01_x.jpg',
);
const downloadChatAttachmentMock = vi.fn(async (_filePath: string) => Buffer.from('jpegbytes'));

vi.mock('@/lib/ftp-client', () => ({
  isFtpConfigured: () => true,
  getMaxFileSize: () => 10 * 1024 * 1024,
  generateDocumentFilename: () => 'chat_u1_2026-01-01_x.jpg',
  uploadChatAttachment: (...args: unknown[]) => uploadChatAttachmentMock(...(args as [Buffer, string])),
  downloadChatAttachment: (...args: unknown[]) => downloadChatAttachmentMock(...(args as [string])),
}));

import { POST } from '@/app/api/doctor-messages/attachments/route';
import { GET as GET_META } from '@/app/api/doctor-messages/attachments/[attachmentId]/route';
import { GET as GET_FILE } from '@/app/api/doctor-messages/attachments/[attachmentId]/file/route';
import { requireAuth } from '@/lib/auth-server';

const ATT_ID = '11111111-2222-4333-8444-555555555555';
const uploader = { userId: 'u1', email: 'u1@clinic.hu', role: 'fogpótlástanász' as const };
const recipient = { userId: 'u2', email: 'u2@clinic.hu', role: 'fogpótlástanász' as const };
const stranger = { userId: 'u3', email: 'u3@clinic.hu', role: 'fogpótlástanász' as const };

function attachmentRow(extra: Record<string, unknown> = {}) {
  return {
    id: ATT_ID,
    uploaded_by: 'u1',
    message_id: 'm1',
    filename: 'chat_u1_2026-01-01_x.jpg',
    file_path: '/patients/_chat-attachments/chat_u1_2026-01-01_x.jpg',
    file_size: '9',
    mime_type: 'image/jpeg',
    created_at: '2026-01-01T10:00:00.000Z',
    sender_id: 'u1',
    recipient_id: 'u2',
    group_id: null,
    ...extra,
  };
}

function multipartRequest(file: File | null) {
  const fd = new FormData();
  if (file) fd.append('file', file);
  return new NextRequest('http://localhost/api/doctor-messages/attachments', {
    method: 'POST',
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/doctor-messages/attachments', () => {
  it('400 when no file is sent', async () => {
    vi.mocked(requireAuth).mockResolvedValue(uploader);
    const res = await POST(multipartRequest(null));
    expect(res.status).toBe(400);
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
  });

  it('400 for a non-image file and does not touch FTP', async () => {
    vi.mocked(requireAuth).mockResolvedValue(uploader);
    const file = new File([new Uint8Array([1, 2, 3])], 'lelet.pdf', { type: 'application/pdf' });
    const res = await POST(multipartRequest(file));
    expect(res.status).toBe(400);
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('201 for an image: uploads to FTP and inserts the metadata row', async () => {
    vi.mocked(requireAuth).mockResolvedValue(uploader);
    queryMock.mockResolvedValueOnce({ rows: [attachmentRow()] });
    const file = new File([new Uint8Array([255, 216, 255])], 'IMG_0001.jpg', { type: 'image/jpeg' });
    const res = await POST(multipartRequest(file));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attachment.id).toBe(ATT_ID);
    expect(body.attachment.mimeType).toBe('image/jpeg');
    expect(body.attachment.filePath).toBeUndefined();
    expect(uploadChatAttachmentMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('INSERT INTO doctor_message_attachments');
    expect(params[0]).toBe('u1');
    expect(params[4]).toBe('image/jpeg');
  });
});

describe('GET /api/doctor-messages/attachments/[id]/file', () => {
  const makeReq = (qs = '') =>
    new NextRequest(`http://localhost/api/doctor-messages/attachments/${ATT_ID}/file${qs}`);

  it('400 for an invalid id', async () => {
    vi.mocked(requireAuth).mockResolvedValue(uploader);
    const res = await GET_FILE(
      new NextRequest('http://localhost/api/doctor-messages/attachments/x/file'),
      { params: { attachmentId: 'x' } },
    );
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('404 for a user who is not part of the conversation', async () => {
    vi.mocked(requireAuth).mockResolvedValue(stranger);
    queryMock.mockResolvedValueOnce({ rows: [attachmentRow()] });
    const res = await GET_FILE(makeReq(), { params: { attachmentId: ATT_ID } });
    expect(res.status).toBe(404);
    expect(downloadChatAttachmentMock).not.toHaveBeenCalled();
  });

  it('404 for an unsent attachment when the viewer is not the uploader', async () => {
    vi.mocked(requireAuth).mockResolvedValue(recipient);
    queryMock.mockResolvedValueOnce({
      rows: [attachmentRow({ message_id: null, sender_id: null, recipient_id: null })],
    });
    const res = await GET_FILE(makeReq(), { params: { attachmentId: ATT_ID } });
    expect(res.status).toBe(404);
  });

  it('200 inline for the 1:1 recipient', async () => {
    vi.mocked(requireAuth).mockResolvedValue(recipient);
    queryMock.mockResolvedValueOnce({ rows: [attachmentRow()] });
    const res = await GET_FILE(makeReq(), { params: { attachmentId: ATT_ID } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(downloadChatAttachmentMock).toHaveBeenCalledWith(
      '/patients/_chat-attachments/chat_u1_2026-01-01_x.jpg',
    );
  });

  it('200 as download with ?download=true for the uploader', async () => {
    vi.mocked(requireAuth).mockResolvedValue(uploader);
    queryMock.mockResolvedValueOnce({ rows: [attachmentRow()] });
    const res = await GET_FILE(makeReq('?download=true'), { params: { attachmentId: ATT_ID } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('checks group membership for group messages', async () => {
    vi.mocked(requireAuth).mockResolvedValue(stranger);
    queryMock
      .mockResolvedValueOnce({ rows: [attachmentRow({ recipient_id: null, group_id: 'g1' })] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await GET_FILE(makeReq(), { params: { attachmentId: ATT_ID } });
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain('doctor_message_group_participants');
    expect(params).toEqual(['g1', 'u3']);
  });
});

describe('GET /api/doctor-messages/attachments/[id]', () => {
  it('returns public metadata without the file path', async () => {
    vi.mocked(requireAuth).mockResolvedValue(recipient);
    queryMock.mockResolvedValueOnce({ rows: [attachmentRow()] });
    const res = await GET_META(
      new NextRequest(`http://localhost/api/doctor-messages/attachments/${ATT_ID}`),
      { params: { attachmentId: ATT_ID } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachment).toMatchObject({ id: ATT_ID, filename: 'chat_u1_2026-01-01_x.jpg', fileSize: 9 });
    expect(body.attachment.filePath).toBeUndefined();
  });
});
