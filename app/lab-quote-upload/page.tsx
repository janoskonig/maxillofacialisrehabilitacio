import type { Metadata } from 'next';
import LabQuoteUploadForm from './upload-form';

export const metadata: Metadata = {
  title: 'Elkészült dokumentumok feltöltése – MaxRehab',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function LabQuoteUploadPage() {
  return <LabQuoteUploadForm />;
}
