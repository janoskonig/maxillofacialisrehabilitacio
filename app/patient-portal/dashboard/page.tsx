'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PortalDashboard } from '@/components/patient-portal/PortalDashboard';
import { PortalLayout } from '@/components/patient-portal/PortalLayout';
import { useToast } from '@/contexts/ToastContext';

export default function PatientPortalDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  useEffect(() => {
    const verified = searchParams.get('verified');
    if (verified === 'true') {
      showToast('Email cím sikeresen megerősítve!', 'success');
    }
  }, [searchParams, showToast]);

  return (
    <PortalLayout>
      <PortalDashboard />
    </PortalLayout>
  );
}




