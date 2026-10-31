import { redirect } from 'next/navigation';

/** Preserve bookmarked visit links while keeping all daily work in the treatment workspace. */
export default function PatientAftercarePage({ params, searchParams }: {
  params: { id: string };
  searchParams: { appointmentId?: string; episodeId?: string };
}) {
  const query = new URLSearchParams({ view: 'aftercare' });
  if (searchParams.episodeId) query.set('episodeId', searchParams.episodeId);
  if (searchParams.appointmentId) query.set('appointmentId', searchParams.appointmentId);
  redirect(`/patients/${params.id}/stages?${query}#gondozas`);
}
