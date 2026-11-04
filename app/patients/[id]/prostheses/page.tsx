import { redirect } from 'next/navigation';

export default function PatientProsthesesPage({params,searchParams}:{params:{id:string};searchParams:{appointmentId?:string;episodeId?:string}}) {
  const query=new URLSearchParams({view:'prostheses'});
  if(searchParams.episodeId)query.set('episodeId',searchParams.episodeId);
  if(searchParams.appointmentId)query.set('appointmentId',searchParams.appointmentId);
  redirect(`/patients/${params.id}/stages?${query}#fogpotlasok`);
}
