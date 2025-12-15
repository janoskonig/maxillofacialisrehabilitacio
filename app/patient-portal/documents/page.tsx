'use client';

import { PortalLayout } from '@/components/patient-portal/PortalLayout';
import { PatientDocumentsList } from '@/components/patient-portal/PatientDocumentsList';

export default function PatientPortalDocumentsPage() {
  return (
    <PortalLayout>
      <PatientDocumentsList />
    </PortalLayout>
  );
}








