import { formatDateTime } from '@/lib/dateUtils';
export function appointmentDateLabel(a:{startTime:string;timePrecision?:string|null;occurredOn?:string|null}) {
  return a.timePrecision==='day'?`${a.occurredOn} · pontos idő nem ismert`:formatDateTime(a.startTime);
}
