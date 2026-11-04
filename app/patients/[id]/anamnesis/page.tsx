'use client';

import { AppShell } from '@/components/layout/AppShell';
import { PatientEpisodeWorkspace } from '@/components/episode-overview/PatientEpisodeWorkspace';

export default function PatientAnamnesisPage({params,searchParams}:{params:{id:string};searchParams:{episodeId?:string}}){
  return <AppShell title="Anamnézis és vizsgálat" backTo={`/patients/${params.id}/view`} maxWidth="xl">
    <PatientEpisodeWorkspace key={params.id} patientId={params.id} initialEpisodeId={searchParams.episodeId} section="anamnesis"/>
  </AppShell>;
}
