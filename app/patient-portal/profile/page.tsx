'use client';

import { PortalLayout } from '@/components/patient-portal/PortalLayout';
import { PatientProfileView } from '@/components/patient-portal/PatientProfileView';

export default function PatientPortalProfilePage() {
  return (
    <PortalLayout>
      <PatientProfileView />
    </PortalLayout>
  );
}


