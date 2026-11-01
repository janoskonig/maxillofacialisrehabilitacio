'use client';
import { AppShell } from '@/components/layout/AppShell';
import { PatientEpisodeWorkspace } from '@/components/episode-overview/PatientEpisodeWorkspace';
export default function PatientEpisodesPage({params,searchParams}:{params:{id:string};searchParams:{episodeId?:string;edit?:string;new?:string}}){
  return <AppShell title="Epizód és terv" backTo={`/patients/${params.id}/view`} maxWidth="xl"><PatientEpisodeWorkspace key={params.id} patientId={params.id} initialEpisodeId={searchParams.episodeId} initiallyEditing={searchParams.edit==='1'} initiallyCreating={searchParams.new==='1'}/></AppShell>;
}
