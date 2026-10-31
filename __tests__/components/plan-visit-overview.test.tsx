import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PlanVisitOverview } from '@/components/visit-plan/PlanVisitOverview';
import type { EpisodeStep, VisitGroup } from '@/components/visit-plan/visit-plan-types';

afterEach(cleanup);

function group(id: string, status: EpisodeStep['status'] = 'pending', appointmentStatus?: string | null): VisitGroup {
  const step: EpisodeStep = {
    id: `phase-${id}`, episodeId: 'ep', stepCode: id, pathwayOrderIndex: 0,
    pool: 'work', durationMinutes: 30, defaultDaysOffset: 7, status,
    appointmentId: appointmentStatus !== undefined ? `appointment-${id}` : null,
    createdAt: '', completedAt: null, sourceEpisodePathwayId: null, seq: 0,
    visitId: id, jaw: 'felso', teeth: [],
  };
  return {
    visit: { id, seq: 0, label: id, daysOffset: 7, plannedDurationMinutes: null,
      appointmentId: step.appointmentId, appointmentStart: step.appointmentId ? '2026-11-02T09:00:00Z' : null,
      appointmentEnd: null, appointmentStatus: appointmentStatus ?? null },
    phases: [step], primaries: [step],
  };
}

function overview(groups: VisitGroup[], extras: Partial<React.ComponentProps<typeof PlanVisitOverview>> = {}) {
  return render(<PlanVisitOverview groups={groups} unassignedCount={0} unattachedCount={0}
    projectionByPhaseId={new Map()} getStepLabel={(step) => step.stepCode}
    renderBooking={() => null} onEdit={vi.fn()} {...extras} />);
}

describe('Everyday visit overview', () => {
  it('highlights the first unfinished visit in plan order, keeping finished visits collapsed', () => {
    overview([group('Konzultáció', 'completed', 'completed'), group('Lenyomat'), group('Próba', 'scheduled', null)]);
    expect(screen.getByText('Következő alkalom').closest('li')).toHaveTextContent('Lenyomat');
    expect(screen.getByText('Konzultáció').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Időpont lefoglalva').closest('li')).toHaveTextContent('Próba');
  });

  it.each(['cancelled', 'no_show'])('does not present a %s appointment as secured', (status) => {
    overview([group('Lenyomat', 'scheduled', status)]);
    expect(screen.queryByText('Időpont lefoglalva')).not.toBeInTheDocument();
    expect(screen.getByText('Nincs lefoglalt időpont')).toBeInTheDocument();
  });

  it('retains the booking action and provides direct access to appointment status', () => {
    const book = vi.fn();
    const manage = vi.fn();
    overview([group('Próba', 'scheduled', null)], {
      renderBooking: (g) => <button onClick={() => book(g.visit.id)}>Módosítás</button>,
      onManageAppointments: manage,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítás' }));
    expect(book).toHaveBeenCalledWith('Próba');
    fireEvent.click(screen.getByRole('button', { name: 'Státusz' }));
    expect(manage).toHaveBeenCalledWith('appointment-Próba');
  });

  it('keeps extra visits and data needing assignment accessible without expanding the default list', () => {
    const edit = vi.fn();
    overview(Array.from({ length: 6 }, (_, i) => group(`Vizit ${i + 1}`)), { unassignedCount: 2, unattachedCount: 1, onEdit: edit });
    expect(screen.getByText('Vizit 5').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('További tervezett alkalmak (2)')).toBeInTheDocument();
    expect(screen.getByText('2 kezelés még nincs alkalomhoz rendelve.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hozzárendelés a tervben' }));
    expect(edit).toHaveBeenCalledOnce();
    expect(within(screen.getByTestId('plan-visit-overview')).getAllByRole('listitem')).toHaveLength(6);
  });
});
