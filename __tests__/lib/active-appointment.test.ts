import { describe, it, expect } from 'vitest';
import {
  isAppointmentActive,
  isAppointmentUnsuccessful,
  isAppointmentVisible,
  SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT,
  SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT,
  buildStepIdentitySql,
} from '@/lib/active-appointment';

describe('isAppointmentActive', () => {
  it('treats null/undefined as active (no status set yet → still pending)', () => {
    expect(isAppointmentActive(null)).toBe(true);
    expect(isAppointmentActive(undefined)).toBe(true);
  });

  it('treats completed and pending-like statuses as active', () => {
    expect(isAppointmentActive('completed')).toBe(true);
    expect(isAppointmentActive('confirmed')).toBe(true);
    expect(isAppointmentActive('in_progress')).toBe(true);
  });

  it('keeps no_show ACTIVE (matches the unique-index predicate)', () => {
    // The plan deliberately keeps no_show "active" in this layer so the
    // worklist guard matches `idx_appointments_unique_pending_step` semantics.
    // No-show requires an explicit cancel before re-booking the slot.
    expect(isAppointmentActive('no_show')).toBe(true);
  });

  it('treats cancelled statuses as inactive', () => {
    expect(isAppointmentActive('cancelled_by_doctor')).toBe(false);
    expect(isAppointmentActive('cancelled_by_patient')).toBe(false);
  });

  it('treats unsuccessful as inactive — releases the step for a new attempt (migration 029)', () => {
    // The visit happened but the clinical goal was not achieved (e.g. bad
    // impression). The booking guards must allow a fresh `attempt_number + 1`
    // appointment for the same `(episode_id, step_code)`. The time slot stays
    // consumed (handled separately via `available_time_slots.state`).
    expect(isAppointmentActive('unsuccessful')).toBe(false);
  });
});

describe('isAppointmentVisible', () => {
  it('drops no_show in addition to cancellations', () => {
    expect(isAppointmentVisible('no_show')).toBe(false);
    expect(isAppointmentVisible('cancelled_by_doctor')).toBe(false);
    expect(isAppointmentVisible('cancelled_by_patient')).toBe(false);
  });

  it('drops unsuccessful from "future visible" listings (it is past attempt history)', () => {
    expect(isAppointmentVisible('unsuccessful')).toBe(false);
  });

  it('keeps null/completed/etc visible', () => {
    expect(isAppointmentVisible(null)).toBe(true);
    expect(isAppointmentVisible('completed')).toBe(true);
    expect(isAppointmentVisible('confirmed')).toBe(true);
  });
});

describe('isAppointmentUnsuccessful', () => {
  it('returns true only for the literal "unsuccessful" status', () => {
    expect(isAppointmentUnsuccessful('unsuccessful')).toBe(true);
    expect(isAppointmentUnsuccessful('completed')).toBe(false);
    expect(isAppointmentUnsuccessful('no_show')).toBe(false);
    expect(isAppointmentUnsuccessful(null)).toBe(false);
    expect(isAppointmentUnsuccessful(undefined)).toBe(false);
  });
});

describe('canonical SQL fragments', () => {
  it('ACTIVE fragment includes cancelled + unsuccessful but excludes no_show', () => {
    expect(SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT).toContain('cancelled_by_doctor');
    expect(SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT).toContain('cancelled_by_patient');
    expect(SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT).toContain("'unsuccessful'");
    expect(SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT).not.toContain("'no_show'");
  });

  it('VISIBLE fragment includes no_show + unsuccessful in the hidden list', () => {
    expect(SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT).toContain("'no_show'");
    expect(SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT).toContain("'unsuccessful'");
    expect(SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT).toContain('cancelled_by_doctor');
    expect(SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT).toContain('cancelled_by_patient');
  });
});

describe('buildStepIdentitySql', () => {
  it('legacy mode (no work_phase_id column) joins via step_code only', () => {
    const sql = buildStepIdentitySql(false);
    const join = sql.joinEpisodeWorkPhaseSql('ewp');
    expect(join).toContain('ewp.episode_id = a.episode_id');
    expect(join).toContain('ewp.work_phase_code = a.step_code');
    expect(join).not.toContain('a.work_phase_id');
  });

  it('canonical mode (work_phase_id present) uses ID first, falls back to step_code', () => {
    const sql = buildStepIdentitySql(true);
    const join = sql.joinEpisodeWorkPhaseSql('ewp');
    expect(join).toContain('ewp.id = a.work_phase_id');
    expect(join).toContain('ewp.work_phase_code = a.step_code');
    expect(join).toContain('a.work_phase_id IS NULL');
  });
});
