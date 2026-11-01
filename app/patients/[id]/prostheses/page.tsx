'use client';
import { AppShell } from '@/components/layout/AppShell';
import { PatientTabsNav } from '@/components/PatientTabsNav';
import { ProsthesisLifecycle } from '@/components/prosthesis-lifecycle/ProsthesisLifecycle';
export default function PatientProsthesesPage({params,searchParams}:{params:{id:string};searchParams:{appointmentId?:string}}) {
  return <AppShell title="Fogpótlások és gondozás" maxWidth="full"><PatientTabsNav patientId={params.id} activeTab="aftercare"/><ProsthesisLifecycle patientId={params.id} initialAppointmentId={searchParams.appointmentId}/></AppShell>;
}
