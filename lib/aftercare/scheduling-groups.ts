import type { SchedulingRequest } from './model';

export interface SchedulingGroup extends SchedulingRequest {
  members: SchedulingRequest[];
}

/** One row/booking for requests that can share the same patient's return visit. */
export function groupSchedulingRequests(requests: SchedulingRequest[]): SchedulingGroup[] {
  const groups = new Map<string, SchedulingGroup>();
  for (const request of requests) {
    const key = JSON.stringify([request.patientId, request.dueOn, request.source, request.nextAction,
      request.appointmentId, request.appointmentStatus, request.delayReason]);
    const group = groups.get(key);
    if (group) {
      group.members.push(request);
      group.prosthesisIds = Array.from(new Set([...group.prosthesisIds, ...request.prosthesisIds]));
      group.prosthesisLabels = Array.from(new Set(group.members.map((m) => m.prosthesisLabels))).join(', ');
    } else groups.set(key, { ...request, prosthesisIds: [...request.prosthesisIds], members: [request] });
  }
  return Array.from(groups.values());
}
