'use client';

import { useState } from 'react';
import { X, Calendar, Clock, MapPin, User, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useModalA11y } from '@/hooks/useModalA11y';

/**
 * Strukturált lemondási okok: a betegnek egy koppintás (nem 10+ karakter
 * gépelés), a klinikának pedig elemezhető kategória. A szerver felé a
 * kategória + opcionális részletezés összefűzve megy (az API változatlan).
 */
const CANCELLATION_REASONS = [
  'Betegség miatt nem tudok menni',
  'Utazás vagy egyéb akadályoztatás',
  'Másik időpontot szeretnék kérni',
  'Egyéb ok',
] as const;

const OTHER_REASON = 'Egyéb ok';

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
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');
  const modalRef = useModalA11y({ onClose: loading ? undefined : onCancel });

  const startTime = new Date(appointment.startTime);
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = appointment.cim || DEFAULT_CIM;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedReason) {
      setError('Kérjük, válassza ki a lemondás okát');
      return;
    }
    if (selectedReason === OTHER_REASON && detail.trim().length === 0) {
      setError('Egyéb oknál kérjük, írja le röviden az indokot');
      return;
    }

    setError('');
    const reason = detail.trim() ? `${selectedReason} — ${detail.trim()}` : selectedReason;
    onConfirm(reason);
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancellation-modal-title"
    >
      <div ref={modalRef} tabIndex={-1} className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full shadow-xl outline-none max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 id="cancellation-modal-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">Időpont lemondása</h2>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-300 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-800 dark:text-red-300">
                Biztosan le szeretné mondani ezt az időpontot? A lemondás után az időpont újra elérhetővé válik más páciensek számára.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-medical-primary mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Dátum és idő</div>
                  <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                  </div>
                </div>
              </div>

              {appointment.dentistName && (
                <div className="flex items-start gap-3">
                  <User className="w-5 h-5 text-medical-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Orvos</div>
                    <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {appointment.dentistName}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-medical-primary mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Helyszín</div>
                  <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {displayCim}
                    {appointment.teremszam && ` • ${appointment.teremszam}. terem`}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Lemondás oka <span className="text-red-600 dark:text-red-300">*</span>
              </p>
              <div role="radiogroup" aria-label="Lemondás oka" className="flex flex-col gap-2">
                {CANCELLATION_REASONS.map(reason => (
                  <button
                    key={reason}
                    type="button"
                    role="radio"
                    aria-checked={selectedReason === reason}
                    onClick={() => {
                      setSelectedReason(reason);
                      setError('');
                    }}
                    disabled={loading}
                    className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium border transition-colors ${
                      selectedReason === reason
                        ? 'border-medical-primary bg-medical-primary/5 ring-1 ring-medical-primary text-gray-900 dark:text-gray-100'
                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-medical-primary/60'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <label htmlFor="cancellation-detail" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mt-3 mb-1">
                Részletezés{' '}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  {selectedReason === OTHER_REASON ? '(kötelező)' : '(nem kötelező)'}
                </span>
              </label>
              <textarea
                id="cancellation-detail"
                value={detail}
                onChange={(e) => {
                  setDetail(e.target.value);
                  setError('');
                }}
                className={`form-input w-full ${error ? 'border-red-500' : ''}`}
                placeholder="Ha szeretné, itt részletezheti..."
                rows={2}
                disabled={loading}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'cancellation-error' : undefined}
              />
              {error && (
                <p id="cancellation-error" className="mt-1 text-sm text-red-600 dark:text-red-300">{error}</p>
              )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                A lemondás után email értesítést kap az orvos és az adminisztráció.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 p-6 border-t bg-gray-50 dark:bg-gray-800/60">
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
              disabled={loading || !selectedReason || (selectedReason === OTHER_REASON && detail.trim().length === 0)}
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

