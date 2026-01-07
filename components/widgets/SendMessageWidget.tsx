'use client';

import { useState, useEffect } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { MessageCircle, Send, Plus, Clock, Mail } from 'lucide-react';
import { SendMessageModal } from '../SendMessageModal';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

interface Message {
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

export function SendMessageWidget() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentMessages();
    // Frissítés 30 másodpercenként
    const interval = setInterval(fetchRecentMessages, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchRecentMessages = async () => {
    try {
      const response = await fetch('/api/messages/all?limit=5', {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          return; // Nincs jogosultság, nem mutatjuk
        }
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      const messages = data.messages || [];
      setRecentMessages(messages);
      
      // Olvasatlan üzenetek száma
      const unread = messages.filter((m: Message) => !m.readAt).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Hiba az üzenetek betöltésekor:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMessageClick = (message: Message) => {
    // Navigálás a beteg részletek oldalra, ahol látható az érintkezési napló
    router.push(`/patients/${message.patientId}`);
    setIsModalOpen(false);
  };

  return (
    <>
      <DashboardWidget
        title="Üzenetek"
        icon={<MessageCircle className="w-5 h-5" />}
        className="cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => setIsModalOpen(true)}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Üzenet küldése és megtekintése
            </p>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                {unreadCount} olvasatlan
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
          ) : recentMessages.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto border-t pt-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">Legutóbbi üzenetek:</div>
              {recentMessages.map((message) => (
                <button
                  key={message.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMessageClick(message);
                  }}
                  className={`w-full text-left p-2 rounded border text-xs transition-colors ${
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
                      {message.subject && (
                        <div className="text-gray-600 truncate mt-0.5">{message.subject}</div>
                      )}
                      <div className="text-gray-500 truncate mt-0.5">
                        {message.message.substring(0, 50)}
                        {message.message.length > 50 ? '...' : ''}
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
            <div className="text-center py-2 text-gray-500 text-xs border-t pt-3">
              Még nincsenek üzenetek
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


