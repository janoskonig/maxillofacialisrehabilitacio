import { expect, it } from 'vitest';
import { groupSchedulingRequests } from '@/lib/aftercare/scheduling-groups';
import type { SchedulingRequest } from '@/lib/aftercare/model';

const request: SchedulingRequest = { id: 'one', patientId: 'patient', patientName: 'Test', episodeId: 'episode',
  prosthesisLabels: 'Felső', prosthesisIds: ['upper'], source: 'delivery_review', requestedOn: '2026-07-31', dueOn: '2026-10-31',
  intervalDays: null, nextAction: 'routine_review', appointmentId: null, appointmentStart: null, appointmentStatus: null,
  delayReason: 'none', version: 1, slotSecured: false, completed: false };

it('shows one coordinator row for the same return covering upper and lower prostheses without losing individual request identities', () => {
  const groups = groupSchedulingRequests([request, { ...request, id: 'two', prosthesisLabels: 'Alsó', prosthesisIds: ['lower'] }]);
  expect(groups).toHaveLength(1);
  expect(groups[0].prosthesisIds).toEqual(['upper', 'lower']);
  expect(groups[0].members.map((r) => r.id)).toEqual(['one', 'two']);
  expect(request.prosthesisIds).toEqual(['upper']);
});
it('keeps different dates, secured slots and delay reasons separate', () => {
  expect(groupSchedulingRequests([request,
    { ...request, id: 'two', dueOn: '2026-11-01' },
    { ...request, id: 'three', appointmentId: 'booked', slotSecured: true },
    { ...request, id: 'four', delayReason: 'laboratory' },
  ])).toHaveLength(4);
});
