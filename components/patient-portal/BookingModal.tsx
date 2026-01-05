'use client';

import { X, Calendar, Clock, MapPin, User } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

interface TimeSlot {
  id: string;
  startTime: string;
  cim: string | null;
  teremszam: string | null;
  dentistName: string | null;
  dentistEmail: string | null;
}

interface BookingModalProps {
  timeSlot: TimeSlot;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function BookingModal({ timeSlot, onConfirm, onCancel, loading = false }: BookingModalProps) {
  const startTime = new Date(timeSlot.startTime);
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const displayCim = timeSlot.cim || DEFAULT_CIM;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">Időpont foglalása</h2>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-gray-600">
            Kérjük, erősítse meg, hogy le szeretné foglalni ezt az időpontot:
          </p>

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

            {timeSlot.dentistName && (
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-medical-primary mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-500">Orvos</div>
                  <div className="text-base font-semibold text-gray-900">
                    {timeSlot.dentistName}
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
                  {timeSlot.teremszam && ` • ${timeSlot.teremszam}. terem`}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              Az időpont foglalása után email értesítést kap az orvos és Ön is (ha van email címe).
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary flex-1"
          >
            Mégse
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Foglalás...</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4" />
                <span>Foglalás megerősítése</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

