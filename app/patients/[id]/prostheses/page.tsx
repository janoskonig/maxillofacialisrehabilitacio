'use client';
import Link from 'next/link';
import { episodeOverviewHref } from '@/lib/episode-overview';
import { AppShell } from '@/components/layout/AppShell';
import { PatientTabsNav } from '@/components/PatientTabsNav';
import { ProsthesisLifecycle } from '@/components/prosthesis-lifecycle/ProsthesisLifecycle';
export default function PatientProsthesesPage({params,searchParams}:{params:{id:string};searchParams:{appointmentId?:string;episodeId?:string}}) {
  return <AppShell title="Fogpótlások és gondozás" maxWidth="full"><PatientTabsNav patientId={params.id} activeTab="aftercare" episodeId={searchParams.episodeId}/>{searchParams.episodeId&&<Link className="mb-4 inline-block text-sm underline" href={episodeOverviewHref(params.id,searchParams.episodeId)}>Vissza a kiválasztott epizódhoz és tervéhez</Link>}<ProsthesisLifecycle patientId={params.id} initialAppointmentId={searchParams.appointmentId}/></AppShell>;
}
