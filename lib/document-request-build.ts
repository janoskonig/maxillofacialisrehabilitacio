import { getMentionFormatFromName } from '@/lib/mention-parser';

/** Built-in típusok: parancsban használt token (detektor / feltöltés egyeztetés) */
const TAG_TO_TOKEN: Record<string, string> = {
  op: 'OP',
  foto: 'foto',
  zarojelentes: 'zarojelentes',
  'ambulans lap': 'ambulans lap',
  egyeb: 'egyeb',
  '': 'egyeb',
};

function tokenForCommand(documentTag: string): string {
  const raw = (documentTag || 'egyeb').trim() || 'egyeb';
  const lower = raw.toLowerCase();
  const mapped = TAG_TO_TOKEN[lower] ?? TAG_TO_TOKEN[raw];
  if (mapped !== undefined) {
    return mapped;
  }
  // Rendszer címkék: idézőjelben, belső " → '
  return raw.replace(/"/g, "'");
}

export function buildDocumentRequestCommandMessage(patientDisplayName: string, documentTag: string): string {
  const mention = getMentionFormatFromName(patientDisplayName || 'beteg');
  const token = tokenForCommand(documentTag);
  return `/request ${mention} tag="${token}"`;
}
