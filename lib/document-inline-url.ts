/** MIME vagy fájlnév alapján képes / PDF előnézet. */
export function isDocumentPreviewable(
  mimeType: string | null | undefined,
  filename: string,
): boolean {
  if (mimeType?.startsWith('image/')) return true;
  if (mimeType === 'application/pdf' || mimeType === 'application/x-pdf') return true;
  const lower = filename.toLowerCase();
  return lower.endsWith('.pdf') || /\.(jpe?g|png|gif|webp|bmp|svg)$/.test(lower);
}

export function isPdfDocument(
  mimeType: string | null | undefined,
  filename: string,
): boolean {
  if (mimeType === 'application/pdf' || mimeType === 'application/x-pdf') return true;
  return filename.toLowerCase().endsWith('.pdf');
}

export function getPatientDocumentInlineUrl(
  documentId: string,
  patientId: string,
): string {
  return `/api/patients/${patientId}/documents/${documentId}?inline=true`;
}

export function getPortalDocumentInlineUrl(documentId: string): string {
  return `/api/patient-portal/documents/${documentId}/download?inline=true`;
}
