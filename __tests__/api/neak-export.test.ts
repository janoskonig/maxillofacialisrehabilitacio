// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import PizZip from 'pizzip';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), download: vi.fn(), dental: vi.fn(), markdown: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock('@/lib/auth-server', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth-server')>(),
  requireAuth: vi.fn(async () => ({ userId: 'u1', role: 'admin', email: 'test@example.com' })),
}));
vi.mock('@/lib/legal/patient-data-access-log', () => ({ maybeLogPatientAccess: vi.fn() }));
vi.mock('@/lib/ftp-client', () => ({ downloadFile: mocks.download }));
vi.mock('@/lib/pdf/generateDentalStatusPDF', () => ({ generateDentalStatusPDF: mocks.dental }));
vi.mock('@/lib/pdf/markdown-to-pdf', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/pdf/markdown-to-pdf')>(), markdownToPDF: mocks.markdown,
}));
vi.mock('@/lib/pdf/equity-request', () => ({ generateEquityRequestPDF: vi.fn(async () => Buffer.from('dental form')) }));
vi.mock('@/lib/pdf/equity-request-patient', () => ({
  generatePatientDataEquityPDF: vi.fn(async () => ({ pdf: Buffer.from('patient form'), missingFields: ['anyja neve'] })),
}));
vi.mock('@/lib/pdf/treatment-plan', () => ({ generateTreatmentPlanPDF: vi.fn(async () => Buffer.from('treatment plan pdf')) }));

import { GET } from '@/app/api/patients/[id]/export-neak/route';
import { clinicalTemplate } from '@/lib/episode-clinical/model';

const patient = {
  id: 'p1', nev: 'Teszt Elek', nem: 'férfi', szuletesiDatum: '1980-01-01', taj: '123456789',
  kezelesreErkezesIndoka: 'rehabilitáció', diagnozis: 'teszt', meglevoFogak: ['11'],
  radioterapia: false, chemoterapia: false,
};
const op = { id: 'd1', filename: 'op.jpg', tags: [' OP '], fileSize: '10', filePath: '/patients/p1/op.jpg' };
let currentPatient: typeof patient;
let documents: Array<Record<string, unknown>>;

const request = (dryRun = false) => GET(
  new NextRequest(`http://localhost/api/patients/p1/export-neak${dryRun ? '?dryRun=1' : ''}`),
  { params: { id: 'p1' } },
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ENABLE_NEAK_EXPORT', 'true');
  currentPatient = { ...patient };
  documents = [{ ...op }];
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO clinical_document_packages')) return {rows:[{id:'preserved-package'}]};
    if (sql.includes('FROM patients_full')) return { rows: [currentPatient] };
    if (sql.includes('FROM lab_quote_requests')) return { rows: [] };
    if (sql.includes('FROM patient_documents')) return { rows: documents };
    if (sql.includes('FROM treatment_types')) return { rows: [{ code: 'complete', label: 'Teljes lemezes fogpótlás' }] };
    if (sql.includes('to_regclass')) return { rows: [{ hasToothTreatments: true, hasToothCatalog: true, hasEpisodes: true, hasEpisodeTreatmentPlan: true, hasJawTreatmentPlans: true }] };
    if (sql.includes('FROM tooth_treatments')) return { rows: [{ id: 't1', toothNumber: 16, treatmentCode: 'tomes', labelHu: 'Tömés', status: 'pending', notes: 'Okkluzális felszín' }] };
    if (sql.includes('FROM patient_episodes')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  mocks.download.mockResolvedValue(Buffer.from('image data'));
  mocks.dental.mockResolvedValue(Buffer.from('dental status'));
  mocks.markdown.mockResolvedValue(Buffer.from('summary'));
});
afterEach(() => vi.unstubAllEnvs());

describe('NEAK export endpoint', () => {
  it('uses the chosen episode observation instead of current chart fields and tooth status',async()=>{
    const episodeId=crypto.randomUUID(),reviewId=crypto.randomUUID();
    const content=clinicalTemplate({nev:null,nem:'ferfi',diagnozis:'Régi diagnózis'},'traumás sérülés');
    const original=mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('FROM episode_clinical_reviews r')?{rows:[{id:reviewId,episodeId,version:1,effectiveOn:'2026-01-01',recordedAt:'2026-11-01',content}]}:original(sql,...args));
    const response=await GET(new NextRequest(`http://localhost/api/patients/p1/export-neak?dryRun=1&episodeId=${episodeId}&clinicalReviewId=${reviewId}`),{params:{id:'p1'}});
    const body=await response.json();expect(response.status).toBe(200);expect(body.clinicalReview.id).toBe(reviewId);expect(body.missingFields).toContainEqual({key:'nev',label:'Név'});expect(body.dentalContent.rows.some((r:{explicit:boolean})=>r.explicit)).toBe(false);
    expect(mocks.query.mock.calls.some(([sql,params])=>sql.includes('tt.episode_id=$2')&&params[1]===episodeId)).toBe(true);
  });
  it('does not replace an unreviewed episode with today\'s chart during export',async()=>{
    const original=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('FROM episode_clinical_reviews r')?{rows:[]}:original(sql,...args));
    const response=await GET(new NextRequest(`http://localhost/api/patients/p1/export-neak?episodeId=${crypto.randomUUID()}`),{params:{id:'p1'}});
    expect(response.status).toBe(409);expect((await response.json()).code).toBe('EPISODE_CLINICAL_REVIEW_REQUIRED');expect(mocks.download).not.toHaveBeenCalled();
  });
  it('honors the feature flag', async () => {
    vi.stubEnv('ENABLE_NEAK_EXPORT', 'false');
    expect((await request()).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('previews missing data without generating or downloading files', async () => {
    currentPatient.nev = '';
    const response = await request(true);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.isReady).toBe(false);
    expect(body.missingFields).toContainEqual({ key: 'nev', label: 'Név' });
    expect(mocks.markdown).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('rechecks requirements at download time', async () => {
    currentPatient.nev = '';
    const response = await request();
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('EXPORT_NOT_READY');
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('rejects a known size violation before generation and download', async () => {
    documents[0].fileSize = 51 * 1024 * 1024;
    const response = await request();
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('FILE_TOO_LARGE');
    expect(mocks.markdown).not.toHaveBeenCalled();
  });
  it('fails if a dental PDF cannot be generated', async () => {
    mocks.dental.mockRejectedValueOnce(new Error('PDF generation failed'));
    expect((await request()).status).toBe(500);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('fails if a selected attachment is unavailable or empty', async () => {
    mocks.download.mockRejectedValueOnce(new Error('FTP unavailable'));
    let response = await request();
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('DOCUMENT_DOWNLOAD_FAILED');
    mocks.download.mockResolvedValueOnce(Buffer.alloc(0));
    response = await request();
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('DOCUMENT_EMPTY');
  });
  it('fails if a selected attachment has no storage path', async () => {
    delete documents[0].filePath;
    const response = await request();
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('DOCUMENT_UNAVAILABLE');
  });
  it('checks actual downloaded size, even if metadata underestimates it', async () => {
    mocks.download.mockResolvedValueOnce(Buffer.alloc(51 * 1024 * 1024));
    const response = await request();
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('FILE_TOO_LARGE');
  });
  it('produces a readable ZIP with every selected attachment and an accurate README', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    // The repository's minimal PizZip declaration only exposes construction/generation.
    const zip = new PizZip(Buffer.from(await response.arrayBuffer())) as PizZip & {
      file(name: string): { asText(): string } | null;
    };
    expect(zip.file('documents/d1_op.jpg')?.asText()).toBe('image data');
    const readme = zip.file('README.txt')?.asText();
    expect(readme).toContain('documents/d1_op.jpg');
    expect(readme).toContain('1 dokumentum');
    expect(readme).toContain('anyja neve');
    expect(zip.file('treatment_plan.pdf')?.asText()).toBe('treatment plan pdf');
    expect(zip.file('treatment_plan.txt')?.asText()).toContain('16. fog: Tömés');
    expect(zip.file('treatment_plan.txt')?.asText()).toContain('Okkluzális felszín');
    const historyMarkdown = mocks.markdown.mock.calls[1][0];
    expect(historyMarkdown).toContain('RT: Nem');
    expect(historyMarkdown).toContain('CT: Nem');
  });
  it('previews the same dental and treatment content used in the documents', async () => {
    const response = await request(true);
    const body = await response.json();
    expect(body.treatmentContent.sections.flatMap((section: { lines: string[] }) => section.lines).join('\n')).toContain('16. fog: Tömés');
    expect(body.dentalContent.rows).toHaveLength(32);
    expect(body.generatedFiles).toContain('treatment_plan.pdf');
  });
});
