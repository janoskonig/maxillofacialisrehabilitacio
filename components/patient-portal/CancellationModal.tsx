'use client';

import { useState } from 'react';
import { X, Calendar, Clock, MapPin, User, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

interface Appointment {
  id: string;
  startTime: string;
  cim: string | null;
  teremszam: string | null;
  dentistName: string | null;
  dentistEmail: string | null;
}

interface CancellationModalProps {
  appointment: Appointment;
  onConfirm: (cancellationReason: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function CancellationModal({ appointment, onConfirm, onCancel, loading = false }: CancellationModalProps) {
  const [cancellationReason, setCancellationReason] = useState('');
  const [error, setError] = useState('');

  const startTime = new Date(appointment.startTime);
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = appointment.cim || DEFAULT_CIM;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate cancellation reason
    if (!cancellationReason.trim()) {
      setError('A lemondás indokának megadása kötelező');
      return;
    }

    if (cancellationReason.trim().length < 10) {
      setError('A lemondás indokának legalább 10 karakter hosszúnak kell lennie');
      return;
    }

    setError('');
    onConfirm(cancellationReason.trim());
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">Időpont lemondása</h2>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-800">
                Biztosan le szeretné mondani ezt az időpontot? A lemondás után az időpont újra elérhetővé válik más páciensek számára.
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-medical-primary mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-500">Dátum és idő</div>
                  <div className="text-base font-semibold text-gray-900">
                    {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                  </div>
                </div>
              </div>

              {appointment.dentistName && (
                <div className="flex items-start gap-3">
                  <User className="w-5 h-5 text-medical-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-gray-500">Orvos</div>
                    <div className="text-base font-semibold text-gray-900">
                      {appointment.dentistName}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-medical-primary mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-500">Helyszín</div>
                  <div className="text-base font-semibold text-gray-900">
                    {displayCim}
                    {appointment.teremszam && ` • ${appointment.teremszam}. terem`}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="cancellation-reason" className="block text-sm font-medium text-gray-700 mb-2">
                Lemondás indoka <span className="text-red-600">*</span>
              </label>
              <textarea
                id="cancellation-reason"
                value={cancellationReason}
                onChange={(e) => {
                  setCancellationReason(e.target.value);
                  setError('');
                }}
                className={`form-input w-full ${error ? 'border-red-500' : ''}`}
                placeholder="Kérjük, adja meg a lemondás indokát (minimum 10 karakter)..."
                rows={4}
                disabled={loading}
                required
              />
              {error && (
                <p className="mt-1 text-sm text-red-600">{error}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Minimum 10 karakter szükséges
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                A lemondás után email értesítést kap az orvos és az adminisztráció.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 p-6 border-t bg-gray-50">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="btn-secondary flex-1"
            >
              Mégse
            </button>
            <button
              type="submit"
              disabled={loading || !cancellationReason.trim() || cancellationReason.trim().length < 10}
              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Lemondás...</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span>Lemondás megerősítése</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

