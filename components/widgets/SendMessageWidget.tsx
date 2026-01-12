'use client';

import { useState, useEffect } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { MessageCircle } from 'lucide-react';
import { SendMessageModal } from '../SendMessageModal';
import { useRouter } from 'next/navigation';

interface PatientMessage {
  senderType: 'doctor' | 'patient';
  readAt: Date | null;
}

export function SendMessageWidget() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [patientUnreadCount, setPatientUnreadCount] = useState(0);
  const [doctorUnreadCount, setDoctorUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUnreadCount();
    // Frissítés 30 másodpercenként
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchUnreadCount = async () => {
    try {
      // Orvos-beteg üzenetek - csak olvasatlanok száma
      const patientResponse = await fetch('/api/messages/all?unreadOnly=true', {
        credentials: 'include',
      });

      if (patientResponse.ok) {
        const patientData = await patientResponse.json();
        const messages = patientData.messages || [];
        // Csak azokat számoljuk, amiket az orvos még nem olvasott (betegtől érkező üzenetek)
        const unread = messages.filter((m: PatientMessage) => m.senderType === 'patient' && !m.readAt).length;
        setPatientUnreadCount(unread);
      }

      // Orvos-orvos üzenetek - csak olvasatlanok száma
      const doctorResponse = await fetch('/api/doctor-messages/recent?limit=1', {
        credentials: 'include',
      });

      if (doctorResponse.ok) {
        const doctorData = await doctorResponse.json();
        setDoctorUnreadCount(doctorData.unreadCount || 0);
      }
    } catch (error) {
      console.error('Hiba az olvasatlan üzenetek számának lekérdezésekor:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalUnreadCount = patientUnreadCount + doctorUnreadCount;

  return (
    <>
      <DashboardWidget
        title="Üzenetek"
        icon={<MessageCircle className="w-5 h-5" />}
        className="cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => router.push('/messages')}
      >
        <div className="flex items-center justify-center py-4">
          {loading ? (
            <div className="text-center text-gray-500 text-sm">Betöltés...</div>
          ) : totalUnreadCount > 0 ? (
            <div className="text-center">
              <div className="text-lg font-semibold text-red-600 mb-1">
                {totalUnreadCount} olvasatlan üzenet
              </div>
              <div className="text-xs text-gray-500">
                Kattintson az üzenetek megtekintéséhez
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-lg font-semibold text-green-600 mb-1">
                Nincs olvasatlan üzenet
              </div>
              <div className="text-xs text-gray-500">
                Minden üzenet elolvasva
              </div>
            </div>
          )}
        </div>
      </DashboardWidget>

      <SendMessageModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          fetchUnreadCount(); // Frissítés az üzenet küldése után
        }}
      />
    </>
  );
}


