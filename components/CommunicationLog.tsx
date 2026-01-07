'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, Phone, User, Mail, Plus, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';

type CommunicationType = 'message' | 'phone' | 'in_person' | 'other';
type CommunicationDirection = 'doctor_to_patient' | 'patient_to_doctor';

interface CommunicationLog {
  id: string;
  patientId: string;
  doctorId: string | null;
  communicationType: CommunicationType;
  direction: CommunicationDirection;
  subject: string | null;
  content: string;
  metadata: Record<string, any> | null;
  createdAt: Date;
  createdBy: string | null;
}

interface CommunicationLogProps {
  patientId: string;
  patientName?: string | null;
}

const communicationTypeLabels: Record<CommunicationType, string> = {
  message: 'Üzenet',
  phone: 'Telefonhívás',
  in_person: 'Személyes találkozó',
  other: 'Egyéb',
};

const directionLabels: Record<CommunicationDirection, string> = {
  doctor_to_patient: 'Orvos → Beteg',
  patient_to_doctor: 'Beteg → Orvos',
};

export function CommunicationLog({ patientId, patientName }: CommunicationLogProps) {
  const { showToast } = useToast();
  const [logs, setLogs] = useState<CommunicationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<CommunicationType | 'all'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formData, setFormData] = useState({
    communicationType: 'phone' as CommunicationType,
    direction: 'doctor_to_patient' as CommunicationDirection,
    subject: '',
    content: '',
  });

  useEffect(() => {
    fetchLogs();
  }, [patientId, filterType]);

  const fetchLogs = async () => {
    try {
      const url = `/api/communication-logs?patientId=${patientId}${
        filterType !== 'all' ? `&communicationType=${filterType}` : ''
      }`;
      const response = await fetch(url, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az érintkezési napló betöltésekor');
      }

      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error('Hiba az érintkezési napló betöltésekor:', error);
      showToast('Hiba történt az érintkezési napló betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLog = async () => {
    if (!formData.content.trim()) {
      showToast('Kérjük, adja meg a tartalmat', 'error');
      return;
    }

    try {
      setAdding(true);
      const response = await fetch('/api/communication-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          patientId,
          communicationType: formData.communicationType,
          direction: formData.direction,
          subject: formData.subject.trim() || null,
          content: formData.content.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Hiba az érintkezési bejegyzés létrehozásakor');
      }

      const data = await response.json();
      setLogs([data.log, ...logs]);
      setFormData({
        communicationType: 'phone',
        direction: 'doctor_to_patient',
        subject: '',
        content: '',
      });
      setShowAddForm(false);
      showToast('Érintkezési bejegyzés sikeresen létrehozva', 'success');
    } catch (error: any) {
      console.error('Hiba az érintkezési bejegyzés létrehozásakor:', error);
      showToast(error.message || 'Hiba történt az érintkezési bejegyzés létrehozásakor', 'error');
    } finally {
      setAdding(false);
    }
  };

  const getIcon = (type: CommunicationType) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="w-4 h-4" />;
      case 'phone':
        return <Phone className="w-4 h-4" />;
      case 'in_person':
        return <User className="w-4 h-4" />;
      default:
        return <Mail className="w-4 h-4" />;
    }
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            Érintkezési napló {patientName && `- ${patientName}`}
          </h3>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Új bejegyzés
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-500" />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as CommunicationType | 'all')}
          className="form-input"
        >
          <option value="all">Összes típus</option>
          {Object.entries(communicationTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {showAddForm && (
        <div className="border-t pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Típus</label>
              <select
                value={formData.communicationType}
                onChange={(e) =>
                  setFormData({ ...formData, communicationType: e.target.value as CommunicationType })
                }
                className="form-input"
              >
                {Object.entries(communicationTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Irány</label>
              <select
                value={formData.direction}
                onChange={(e) =>
                  setFormData({ ...formData, direction: e.target.value as CommunicationDirection })
                }
                className="form-input"
              >
                {Object.entries(directionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Tárgy (opcionális)</label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              className="form-input"
              placeholder="Bejegyzés tárgya..."
            />
          </div>
          <div>
            <label className="form-label">Tartalom</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="form-input"
              rows={4}
              placeholder="Érintkezés részletei..."
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddLog}
              disabled={adding || !formData.content.trim()}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Hozzáadás...' : 'Hozzáadás'}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setFormData({
                  communicationType: 'phone',
                  direction: 'doctor_to_patient',
                  subject: '',
                  content: '',
                });
              }}
              className="btn-secondary"
            >
              Mégse
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>Még nincsenek érintkezési bejegyzések</p>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="border rounded-lg p-4 bg-white border-l-4 border-l-purple-500"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getIcon(log.communicationType)}
                  <span className="font-semibold text-gray-900">
                    {communicationTypeLabels[log.communicationType]}
                  </span>
                  <span className="text-sm text-gray-500">
                    ({directionLabels[log.direction]})
                  </span>
                </div>
                <div className="text-sm text-gray-500">
                  {format(new Date(log.createdAt), 'yyyy. MM. dd. HH:mm', { locale: hu })}
                </div>
              </div>
              {log.subject && (
                <div className="mb-2">
                  <span className="text-sm font-medium text-gray-700">Tárgy: </span>
                  <span className="text-sm text-gray-900">{log.subject}</span>
                </div>
              )}
              <div className="text-gray-700 whitespace-pre-wrap">{log.content}</div>
              {log.createdBy && (
                <div className="mt-2 text-xs text-gray-500">
                  Létrehozta: {log.createdBy}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

