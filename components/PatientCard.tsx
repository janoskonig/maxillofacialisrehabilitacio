'use client';

import { Patient } from '@/lib/types';
import { Phone, Mail, Calendar, Eye, Pencil, Trash2, Image, Camera, CheckCircle2, XCircle, Clock, Clock as ClockIcon, History, MessageCircle } from 'lucide-react';
import { formatDateForDisplay, calculateAge } from '@/lib/dateUtils';
import { useRouter } from 'next/navigation';

interface AppointmentInfo {
  id: string;
  startTime: string;
  dentistEmail: string | null;
  dentistName?: string | null;
  appointmentStatus?: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
  isLate?: boolean;
}

interface PatientCardProps {
  patient: Patient;
  appointment?: AppointmentInfo;
  opDocumentCount?: number;
  fotoDocumentCount?: number;
  onView: (patient: Patient) => void;
  onEdit?: (patient: Patient) => void;
  onDelete?: (patient: Patient) => void;
  onViewOP?: (patient: Patient) => void;
  onViewFoto?: (patient: Patient) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  userRole?: 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';
}

export function PatientCard({
  patient,
  appointment,
  opDocumentCount = 0,
  fotoDocumentCount = 0,
  onView,
  onEdit,
  onDelete,
  onViewOP,
  onViewFoto,
  canEdit = false,
  canDelete = false,
  userRole,
}: PatientCardProps) {
  const router = useRouter();

  const handleHistoryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/patients/${patient.id}/history`);
  };

  const handleMessagesClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/patients/${patient.id}`);
  };

  const getStatusInfo = (status?: AppointmentInfo['appointmentStatus'], isLate?: boolean) => {
    if (isLate) {
      return { label: 'Késett', color: 'text-orange-600', bgColor: 'bg-orange-50', icon: ClockIcon };
    }
    switch (status) {
      case 'cancelled_by_doctor':
        return { label: 'Lemondva (orvos)', color: 'text-red-600', bgColor: 'bg-red-50', icon: XCircle };
      case 'cancelled_by_patient':
        return { label: 'Lemondva (beteg)', color: 'text-orange-600', bgColor: 'bg-orange-50', icon: XCircle };
      case 'completed':
        return { label: 'Teljesült', color: 'text-green-600', bgColor: 'bg-green-50', icon: CheckCircle2 };
      case 'no_show':
        return { label: 'Nem jelent meg', color: 'text-red-700', bgColor: 'bg-red-100', icon: XCircle };
      default:
        return null;
    }
  };

  const statusInfo = appointment ? getStatusInfo(appointment.appointmentStatus, appointment.isLate) : null;
  const StatusIcon = statusInfo?.icon;

  return (
    <div className="card card-interactive space-y-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 truncate">
            {patient.nev || 'Név nélküli beteg'}
          </h3>
          {patient.taj && (
            <p className="text-sm text-gray-600 mt-0.5">TAJ: {patient.taj}</p>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2">
          {patient.id && (
            <>
              <button
                onClick={handleMessagesClick}
                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                title="Üzenetek és érintkezési napló"
              >
                <MessageCircle className="w-4 h-4" />
              </button>
              <button
                onClick={handleHistoryClick}
                className="p-1.5 text-purple-600 hover:bg-purple-50 rounded"
                title="Életút megtekintése"
              >
                <History className="w-4 h-4" />
              </button>
            </>
          )}
          {opDocumentCount > 0 && (
            <button
              onClick={() => onViewOP?.(patient)}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
              title={`${opDocumentCount} OP dokumentum`}
            >
              <Image className="w-4 h-4" />
            </button>
          )}
          {fotoDocumentCount > 0 && (
            <button
              onClick={() => onViewFoto?.(patient)}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
              title={`${fotoDocumentCount} Foto dokumentum`}
            >
              <Camera className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-1.5">
        {patient.telefonszam && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Phone className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{patient.telefonszam}</span>
          </div>
        )}
        {patient.email && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Mail className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{patient.email}</span>
          </div>
        )}
      </div>

      {/* Appointment Info */}
      {appointment && (
        <div className={`${statusInfo?.bgColor || 'bg-gray-50'} rounded-lg p-3 border border-gray-200/50`}>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-600" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {new Date(appointment.startTime).toLocaleString('hu-HU', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              {appointment.dentistName && (
                <p className="text-xs text-gray-600 mt-0.5">{appointment.dentistName}</p>
              )}
              {statusInfo && (
                <div className="flex items-center gap-1 mt-1">
                  {StatusIcon && <StatusIcon className={`w-3.5 h-3.5 ${statusInfo.color}`} />}
                  <span className={`text-xs ${statusInfo.color} font-medium`}>
                    {statusInfo.label}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Additional Info */}
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
        {patient.kezeleoorvos && (
          <div>
            <span className="font-medium">Orvos: </span>
            <span className="truncate block">{patient.kezeleoorvos}</span>
          </div>
        )}
        {patient.createdAt && (
          <div>
            <span className="font-medium">Létrehozva: </span>
            <span>{formatDateForDisplay(patient.createdAt)}</span>
            {patient.createdBy ? (
              <span className="text-gray-500 ml-1">({patient.createdBy.split('@')[0]})</span>
            ) : (
              <span className="text-gray-500 ml-1">(A beteg regisztrált)</span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
        <button
          onClick={() => onView(patient)}
          className="flex-1 btn-secondary flex items-center justify-center gap-2 text-sm py-2"
        >
          <Eye className="w-4 h-4" />
          <span>Megtekintés</span>
        </button>
        {canEdit && (
          <button
            onClick={() => onEdit?.(patient)}
            className="flex-1 btn-secondary flex items-center justify-center gap-2 text-sm py-2"
          >
            <Pencil className="w-4 h-4" />
            <span>Szerkesztés</span>
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => onDelete?.(patient)}
            className="p-2 text-medical-error hover:bg-medical-error/10 rounded-lg transition-all duration-200"
            title="Törlés"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

