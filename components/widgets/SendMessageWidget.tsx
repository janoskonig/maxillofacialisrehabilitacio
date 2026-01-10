'use client';

import { useState, useEffect } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { MessageCircle, Send, Plus, Clock, Mail, Users } from 'lucide-react';
import { SendMessageModal } from '../SendMessageModal';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

interface PatientMessage {
  id: string;
  patientId: string;
  patientName: string | null;
  patientTaj: string | null;
  senderType: 'doctor' | 'patient';
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

interface DoctorMessage {
  id: string;
  senderId: string;
  recipientId: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
  otherDoctorId: string;
  otherDoctorName: string;
}

export function SendMessageWidget() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [recentPatientMessages, setRecentPatientMessages] = useState<PatientMessage[]>([]);
  const [recentDoctorMessages, setRecentDoctorMessages] = useState<DoctorMessage[]>([]);
  const [patientUnreadCount, setPatientUnreadCount] = useState(0);
  const [doctorUnreadCount, setDoctorUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentMessages();
    // Frissítés 30 másodpercenként
    const interval = setInterval(fetchRecentMessages, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchRecentMessages = async () => {
    try {
      // Orvos-beteg üzenetek
      const patientResponse = await fetch('/api/messages/all?limit=5', {
        credentials: 'include',
      });

      if (patientResponse.ok) {
        const patientData = await patientResponse.json();
        const messages = patientData.messages || [];
        setRecentPatientMessages(messages);
        const unread = messages.filter((m: PatientMessage) => !m.readAt).length;
        setPatientUnreadCount(unread);
      }

      // Orvos-orvos üzenetek
      const doctorResponse = await fetch('/api/doctor-messages/recent?limit=5', {
        credentials: 'include',
      });

      if (doctorResponse.ok) {
        const doctorData = await doctorResponse.json();
        const messages = doctorData.messages || [];
        setRecentDoctorMessages(messages);
        setDoctorUnreadCount(doctorData.unreadCount || 0);
      }
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePatientMessageClick = (message: PatientMessage) => {
    // Navigálás az üzenetoldalra orvos-beteg fülre
    router.push('/messages?tab=doctor-patient');
    setIsModalOpen(false);
  };

  const handleDoctorMessageClick = (message: DoctorMessage) => {
    // Navigálás az üzenetoldalra orvos-orvos fülre
    router.push('/messages?tab=doctor-doctor');
    setIsModalOpen(false);
  };

  return (
    <>
      <DashboardWidget
        title="Üzenetek"
        icon={<MessageCircle className="w-5 h-5" />}
        className="cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => router.push('/messages')}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Üzenet küldése és megtekintése
            </p>
            {(patientUnreadCount > 0 || doctorUnreadCount > 0) && (
              <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                {patientUnreadCount + doctorUnreadCount} olvasatlan
              </span>
            )}
          </div>
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsModalOpen(true);
            }}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Új üzenet
          </button>

          {/* Recent Messages */}
          {loading ? (
            <div className="text-center py-2 text-gray-500 text-xs">Betöltés...</div>
          ) : (
            <div className="space-y-3 border-t pt-3">
              {/* Orvos-orvos üzenetek */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-gray-500" />
                    <div className="text-xs font-semibold text-gray-700">Orvos-orvos üzenetek</div>
                  </div>
                  {doctorUnreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                      {doctorUnreadCount}
                    </span>
                  )}
                </div>
                {recentDoctorMessages.length > 0 ? (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {recentDoctorMessages.slice(0, 3).map((message) => (
                      <button
                        key={message.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDoctorMessageClick(message);
                        }}
                        className={`w-full text-left p-1.5 rounded border text-xs transition-colors ${
                          !message.readAt
                            ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {message.otherDoctorName}
                            </div>
                            <div className="text-gray-500 truncate mt-0.5">
                              {message.message.substring(0, 40)}
                              {message.message.length > 40 ? '...' : ''}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {!message.readAt && (
                              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                            )}
                            <div className="flex items-center gap-1 text-gray-400">
                              <Clock className="w-3 h-3" />
                              <span className="text-xs">
                                {format(new Date(message.createdAt), 'MM.dd', { locale: hu })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-1 text-gray-400 text-xs">Nincsenek üzenetek</div>
                )}
              </div>

              {/* Orvos-beteg üzenetek */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <MessageCircle className="w-3 h-3 text-gray-500" />
                    <div className="text-xs font-semibold text-gray-700">Orvos-beteg üzenetek</div>
                  </div>
                  {patientUnreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                      {patientUnreadCount}
                    </span>
                  )}
                </div>
                {recentPatientMessages.length > 0 ? (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {recentPatientMessages.slice(0, 3).map((message) => (
                      <button
                        key={message.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePatientMessageClick(message);
                        }}
                        className={`w-full text-left p-1.5 rounded border text-xs transition-colors ${
                          !message.readAt
                            ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {message.patientName || 'Név nélküli beteg'}
                            </div>
                            <div className="text-gray-500 truncate mt-0.5">
                              {message.message.substring(0, 40)}
                              {message.message.length > 40 ? '...' : ''}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {!message.readAt && (
                              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                            )}
                            <div className="flex items-center gap-1 text-gray-400">
                              <Clock className="w-3 h-3" />
                              <span className="text-xs">
                                {format(new Date(message.createdAt), 'MM.dd', { locale: hu })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-1 text-gray-400 text-xs">Nincsenek üzenetek</div>
                )}
              </div>
            </div>
          )}
        </div>
      </DashboardWidget>

      <SendMessageModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          fetchRecentMessages(); // Frissítés az üzenet küldése után
        }}
      />
    </>
  );
}


