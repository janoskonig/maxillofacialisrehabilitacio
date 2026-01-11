'use client';

import { useState, useEffect } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { MessageCircle, Send, Clock, Mail, Users } from 'lucide-react';
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
  recipientId: string | null;
  groupId?: string | null;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
  otherDoctorId: string | null;
  otherDoctorName: string;
  groupName?: string | null;
  groupParticipantCount?: number | null;
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
      // Orvos-beteg üzenetek - növelt limit, hogy biztosan legyen 3 különböző küldő
      const patientResponse = await fetch('/api/messages/all?limit=15', {
        credentials: 'include',
      });

      if (patientResponse.ok) {
        const patientData = await patientResponse.json();
        const messages = patientData.messages || [];
        setRecentPatientMessages(messages);
        // Csak azokat számoljuk, amiket az orvos még nem olvasott (betegtől érkező üzenetek)
        const unread = messages.filter((m: PatientMessage) => m.senderType === 'patient' && !m.readAt).length;
        setPatientUnreadCount(unread);
      }

      // Orvos-orvos üzenetek - növelt limit, hogy biztosan legyen 3 különböző küldő
      const doctorResponse = await fetch('/api/doctor-messages/recent?limit=15', {
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

  const handleMessageClick = (message: { type: 'doctor' | 'patient'; id: string }) => {
    // Navigálás az üzenetoldalra a megfelelő fülre
    if (message.type === 'doctor') {
      router.push('/messages?tab=doctor-doctor');
    } else {
      router.push('/messages?tab=doctor-patient');
    }
    setIsModalOpen(false);
  };

  // Üzenet preview készítése (fix karakterig utána '...')
  const getMessagePreview = (message: string, maxLength: number = 50): string => {
    if (!message) return '';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  };

  // Összevont lista létrehozása és csoportosítás küldő szerint
  const getTop3UniqueMessages = () => {
    // 1. Összevont lista létrehozása
    const allMessages: Array<{
      id: string;
      type: 'doctor' | 'patient';
      senderId: string | null;
      senderName: string | null;
      readAt: Date | null;
      createdAt: Date;
      message: string;
      isGroup: boolean;
      originalMessage: PatientMessage | DoctorMessage;
    }> = [
      ...recentDoctorMessages.map(m => ({
        id: m.id,
        type: 'doctor' as const,
        senderId: m.groupId || m.otherDoctorId,
        senderName: m.groupId ? (m.groupName || `Csoportos beszélgetés`) : m.otherDoctorName,
        readAt: m.readAt,
        createdAt: m.createdAt,
        message: m.message,
        isGroup: !!m.groupId,
        originalMessage: m,
      })),
      ...recentPatientMessages.map(m => ({
        id: m.id,
        type: 'patient' as const,
        senderId: m.patientId,
        senderName: m.patientName,
        readAt: m.readAt,
        createdAt: m.createdAt,
        message: m.message,
        isGroup: false,
        originalMessage: m,
      })),
    ];

    // 2. Rendezés dátumszerint (legfrissebb előre)
    allMessages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 3. Csoportosítás küldő szerint (csak a legfrissebb üzenet)
    // Group chat-eknél a groupId-t használjuk, egyéni beszélgetéseknél a senderId-t
    const uniqueSenders = new Map<string, typeof allMessages[0]>();
    allMessages.forEach(msg => {
      const key = msg.senderId || `group-${msg.id}`;
      if (!uniqueSenders.has(key) || new Date(msg.createdAt) > new Date(uniqueSenders.get(key)!.createdAt)) {
        uniqueSenders.set(key, msg);
      }
    });

    // 4. Első 3 küldő
    return Array.from(uniqueSenders.values()).slice(0, 3);
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
          {(patientUnreadCount > 0 || doctorUnreadCount > 0) && (
            <div className="flex items-center justify-end">
              <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                {patientUnreadCount + doctorUnreadCount} olvasatlan
              </span>
            </div>
          )}

          {/* Recent Messages - Minimalistább megjelenés */}
          {loading ? (
            <div className="text-center py-2 text-gray-500 text-xs">Betöltés...</div>
          ) : (
            <div className="border-t pt-3">
              {(() => {
                const top3Messages = getTop3UniqueMessages();
                return top3Messages.length > 0 ? (
                  <div className="space-y-1.5">
                    {top3Messages.map((message) => {
                      // Olvasatlan üzenet: csak akkor, ha az orvos még nem olvasta
                      // Beteg üzeneteknél: csak akkor olvasatlan, ha az orvos még nem olvasta
                      // Orvos üzeneteknél: csak akkor olvasatlan, ha a címzett vagyunk és még nem olvastuk
                      const isUnread = !message.readAt && (
                        message.type === 'patient' || 
                        (message.type === 'doctor' && (message.originalMessage as DoctorMessage).recipientId !== null)
                      );
                      
                      return (
                        <button
                          key={message.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMessageClick(message);
                          }}
                          className={`w-full text-left p-2 rounded border text-xs transition-colors ${
                            isUnread
                              ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                              : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {isUnread && (
                                <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></span>
                              )}
                              <span className="font-medium text-gray-900 truncate">
                                {message.senderName || (message.type === 'patient' ? 'Név nélküli beteg' : (message.isGroup ? 'Csoportos beszélgetés' : 'Ismeretlen orvos'))}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-gray-400 flex-shrink-0">
                              <Clock className="w-3 h-3" />
                              <span className="text-xs">
                                {format(new Date(message.createdAt), 'MM.dd', { locale: hu })}
                              </span>
                            </div>
                          </div>
                          {/* Üzenet preview */}
                          <div className="text-xs text-gray-600 truncate">
                            {getMessagePreview(message.message, 50)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-1 text-gray-400 text-xs">Nincsenek üzenetek</div>
                );
              })()}
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


