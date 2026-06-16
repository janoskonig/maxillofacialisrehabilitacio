'use client';

import { Clock, MapPin, Edit2, AlertCircle, RotateCcw, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { getAppointmentTypeChip, APPOINTMENT_TYPE_OPTIONS } from '@/lib/appointment-constants';
import { getAppointmentStatusDisplay } from '@/lib/appointment-status-display';
import { Badge } from '@/components/ui/Badge';
import type { AppointmentOutcomesController, OutcomeAppointment } from '@/hooks/useAppointmentOutcomes';

interface Props {
  appointment: OutcomeAppointment;
  c: AppointmentOutcomesController;
}

/**
 * Egyetlen mai időpont sora: típus-chip, beteg, lépés-kontextus, státusz-badge,
 * outcome-gombok, inline edit/retry form és rebook-banner. Prezentációs komponens —
 * az állapotot és handlereket a useAppointmentOutcomes controller adja.
 */
export function AppointmentOutcomeRow({ appointment, c }: Props) {
  const startTime = new Date(appointment.startTime);
  const isUpcoming = startTime > new Date();
  const display = getAppointmentStatusDisplay(appointment.appointmentStatus, appointment.isLate);
  const showStatusBadge = display.key !== 'pending';
  const isEditing = c.editingId === appointment.id;
  const isRetrying = c.retryingId === appointment.id;
  const chip = getAppointmentTypeChip(appointment.appointmentType, appointment.typeLabel);
  const isPlanStep = !!(appointment.episodeId && appointment.stepCode);
  const showRebook = !!appointment.rebookNeeded;
  const StatusIcon = display.Icon;

  return (
    <div
      className={`px-3 py-2.5 rounded-lg border transition-all duration-200 animate-fade-in ${
        showRebook
          ? 'border-amber-300/70 bg-amber-50/60 dark:border-amber-700/50 dark:bg-amber-950/30'
          : isUpcoming
          ? 'border-medical-primary/30 bg-gradient-to-br from-medical-primary/5 to-medical-accent/5'
          : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/60'
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <div className={`p-1 rounded-md ${isUpcoming ? 'bg-medical-primary/10' : 'bg-gray-200 dark:bg-gray-700'}`}>
              <Clock className={`w-3.5 h-3.5 flex-shrink-0 ${isUpcoming ? 'text-medical-primary' : 'text-gray-500 dark:text-gray-400'}`} />
            </div>
            <span className="font-bold text-sm text-gray-900 dark:text-gray-100 tabular-nums">
              {format(startTime, 'HH:mm', { locale: hu })}
            </span>
            {chip && (
              <span
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${chip.className}`}
                title="Időpont típusa"
              >
                <span aria-hidden>{chip.emoji}</span>
                <span className="truncate max-w-[160px]">{chip.label}</span>
              </span>
            )}
            {!isUpcoming && <span className="badge badge-gray text-[10px] leading-tight py-0 px-1.5">(már elmúlt)</span>}
          </div>

          <div
            onClick={(e) => c.openPatient(appointment.patientId, e)}
            className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate leading-snug cursor-pointer hover:text-medical-primary transition-colors"
            title="Beteg megtekintése"
          >
            {appointment.patientName || 'Névtelen beteg'}
          </div>

          {isPlanStep && appointment.stepLabel && (
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug mt-0.5">
              Lépés: <span className="font-medium text-gray-800 dark:text-gray-200">{appointment.stepLabel}</span>
              {appointment.attemptNumber && appointment.attemptNumber > 1 && <span> · {appointment.attemptNumber}. próba</span>}
            </div>
          )}
          {appointment.dentistName && (
            <div className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-snug mt-0.5">{appointment.dentistName}</div>
          )}
          {appointment.teremszam && (
            <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span>{appointment.teremszam}. terem</span>
            </div>
          )}

          {!isEditing && !isRetrying && showStatusBadge && (
            <div className="mt-1.5">
              <Badge tone={display.tone} className="text-xs py-0.5">
                {StatusIcon && <StatusIcon className="w-3 h-3 mr-0.5" />}
                <span>{display.label}</span>
              </Badge>
            </div>
          )}

          {/* Outcome gombok */}
          {!isEditing && !isRetrying && !appointment.appointmentStatus && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <button
                onClick={() => c.quickStatus(appointment.id, 'completed')}
                className="text-[11px] px-2 py-1 bg-medical-success/10 text-medical-success border border-medical-success/20 rounded-md hover:bg-medical-success/20 transition-all duration-200 font-medium"
                title="Sikeresen teljesült (megjegyzéssel)"
              >
                ✓ Teljesült
              </button>
              {isPlanStep && (
                <button
                  onClick={() => c.startRetry(appointment)}
                  className="text-[11px] px-2 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-300 border border-amber-500/20 rounded-md hover:bg-amber-500/20 transition-all duration-200 font-medium"
                  title="Sikertelen próba – a lépést újra kell foglalni"
                >
                  ↻ Sikertelen – újra kell
                </button>
              )}
              <button
                onClick={() => c.quickStatus(appointment.id, 'no_show')}
                className="text-[11px] px-2 py-1 bg-medical-error/10 text-medical-error border border-medical-error/20 rounded-md hover:bg-medical-error/20 transition-all duration-200 font-medium"
                title="Nem jelent meg"
              >
                ✗ Nem jelent meg
              </button>
            </div>
          )}

          {!isEditing && !isRetrying && appointment.completionNotes && (
            <div className="text-xs text-gray-700 dark:text-gray-300 mt-1.5 px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-800 leading-snug">
              {appointment.completionNotes}
            </div>
          )}

          {/* Rebook-banner */}
          {!isEditing && !isRetrying && showRebook && (
            <div className="mt-2 pt-2 border-t border-dashed border-amber-400/50 flex items-center gap-2">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Újrafoglalás szükséges
              </span>
              <button
                onClick={(e) => c.rebook(appointment, e)}
                className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-md bg-medical-primary text-white hover:bg-medical-primary/90 transition-all duration-200 inline-flex items-center gap-1"
                title="Új időpont foglalása ehhez a lépéshez"
              >
                Újrafoglalás <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Retry (sikertelen) inline form */}
          {isRetrying && (
            <div className="mt-3 space-y-2 pt-2 border-t border-amber-300/60">
              <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5" /> Sikertelen próba — a lépés visszanyílik újrafoglalásra
              </div>
              <div>
                <label className="form-label text-xs">
                  Indok <span className="text-medical-error">*</span>
                </label>
                <textarea
                  value={c.retryReason}
                  onChange={(e) => c.setRetryReason(e.target.value)}
                  className="form-input text-xs"
                  rows={2}
                  placeholder="pl. rossz illeszkedés, új lenyomat kell…"
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={c.cancelRetry} className="btn-secondary text-xs px-3 py-1.5" disabled={c.retrySaving}>
                  Mégse
                </button>
                <button onClick={() => c.saveRetry(appointment.id)} className="btn-primary text-xs px-3 py-1.5" disabled={c.retrySaving}>
                  {c.retrySaving ? 'Mentés…' : 'Mentés → újrafoglalás'}
                </button>
              </div>
            </div>
          )}

          {/* Edit form */}
          {isEditing && (
            <div className="mt-3 space-y-2 pt-2 border-t border-gray-200 dark:border-gray-800">
              <div>
                <label className="form-label text-xs">Típus</label>
                <select
                  value={c.statusForm.appointmentType}
                  onChange={(e) => c.setStatusForm({ ...c.statusForm, appointmentType: e.target.value })}
                  className="form-input text-xs"
                >
                  <option value="">Nincs megadva</option>
                  {APPOINTMENT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label text-xs">Címke (szabad szöveg)</label>
                <input
                  type="text"
                  value={c.statusForm.typeLabel}
                  onChange={(e) => c.setStatusForm({ ...c.statusForm, typeLabel: e.target.value })}
                  className="form-input text-xs"
                  maxLength={120}
                  placeholder="pl. implantátum kontroll 6h"
                />
              </div>
              <div>
                <label className="form-label text-xs">Státusz</label>
                <select
                  value={c.statusForm.appointmentStatus || ''}
                  onChange={(e) => {
                    const value = e.target.value || null;
                    c.setStatusForm({
                      ...c.statusForm,
                      appointmentStatus: value as any,
                      completionNotes: value === 'completed' ? c.statusForm.completionNotes : '',
                    });
                  }}
                  className="form-input text-xs"
                >
                  <option value="">Nincs státusz (normál időpont)</option>
                  <option value="cancelled_by_doctor">Lemondta az orvos</option>
                  <option value="cancelled_by_patient">Lemondta a beteg</option>
                  <option value="completed">Sikeresen teljesült</option>
                  <option value="no_show">Nem jelent meg</option>
                </select>
              </div>
              {c.statusForm.appointmentStatus && (
                <div>
                  <label className="form-label text-xs">
                    Megjegyzés {c.statusForm.appointmentStatus === 'completed' && <span className="text-medical-error">*</span>}
                  </label>
                  <textarea
                    value={c.statusForm.completionNotes}
                    onChange={(e) => c.setStatusForm({ ...c.statusForm, completionNotes: e.target.value })}
                    className="form-input text-xs"
                    rows={2}
                    placeholder="Rövid leírás arról, hogy mi történt..."
                  />
                </div>
              )}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={c.statusForm.isLate}
                    onChange={(e) => c.setStatusForm({ ...c.statusForm, isLate: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                  />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Késett a beteg</span>
                </label>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={c.cancelEdit} className="btn-secondary text-xs px-3 py-1.5">Mégse</button>
                <button onClick={() => c.saveStatus(appointment.id)} className="btn-primary text-xs px-3 py-1.5">Mentés</button>
              </div>
            </div>
          )}
        </div>

        {!isEditing && !isRetrying && (
          <button
            onClick={() => c.startEdit(appointment)}
            className="flex-shrink-0 p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-all duration-200 -mr-0.5"
            title="Státusz / típus szerkesztése"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
