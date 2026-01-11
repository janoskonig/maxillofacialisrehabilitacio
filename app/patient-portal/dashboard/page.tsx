'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { PortalDashboard } from '@/components/patient-portal/PortalDashboard';
import { PortalLayout } from '@/components/patient-portal/PortalLayout';
import { useToast } from '@/contexts/ToastContext';

export default function PatientPortalDashboardPage() {
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  useEffect(() => {
    const verified = searchParams.get('verified');
    if (verified === 'true') {
      showToast('Email cím sikeresen megerősítve!', 'success');
    }

    const impersonated = searchParams.get('impersonated');
    if (impersonated === 'true') {
      showToast('Beteg nézetben vagy bejelentkezve', 'info');
    }
  }, [searchParams, showToast]);

  return (
    <PortalLayout>
      <PortalDashboard />
    </PortalLayout>
  );
}
