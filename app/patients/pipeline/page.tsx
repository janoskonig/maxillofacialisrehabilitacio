'use client';

import dynamic from 'next/dynamic';
import { AppShell } from '@/components/layout/AppShell';

const TabSkeleton = () => (
  <div className="card flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary" />
    <span className="ml-3 text-body-sm">Betöltés...</span>
  </div>
);

const PatientPipelineBoard = dynamic(
  () => import('@/components/PatientPipelineBoard').then((m) => ({ default: m.PatientPipelineBoard })),
  { ssr: false, loading: TabSkeleton }
);

export default function PatientPipelinePage() {
  return (
    <AppShell title="Beteg előkészítés" backTo="/" maxWidth="full">
      <PatientPipelineBoard />
    </AppShell>
  );
}
