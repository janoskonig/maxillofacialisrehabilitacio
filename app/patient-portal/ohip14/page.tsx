'use client';

import { PortalLayout } from '@/components/patient-portal/PortalLayout';
import { PatientOHIP14View } from '@/components/patient-portal/PatientOHIP14View';

export default function PatientPortalOHIP14Page() {
  return (
    <PortalLayout>
      <PatientOHIP14View />
    </PortalLayout>
  );
}
