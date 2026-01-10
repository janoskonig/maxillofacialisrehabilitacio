'use client';

import { useState, useEffect } from 'react';
import { MessageCircle, Users, Clock, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { DoctorMessage } from '@/lib/types';
import { MessageTextRenderer } from './MessageTextRenderer';

interface DoctorMessagesForPatientProps {
  patientId: string;
  patientName?: string | null;
}

export function DoctorMessagesForPatient({ patientId, patientName }: DoctorMessagesForPatientProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<DoctorMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMessages();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchMessages, 30000);
    return () => clearInterval(interval);
  }, [patientId]);

  const fetchMessages = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/doctor-messages/by-patient/${patientId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 403) {
          setError('Nincs jogosultsága az üzenetek megtekintéséhez');
          return;
        }
        throw new Error('Hiba az üzenetek betöltésekor');
      }

      const data = await response.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Hiba az üzenetek betöltésekor:', err);
      setError('Hiba történt az üzenetek betöltésekor');
    } finally {
      setLoading(false);
    }
  };

  const handleViewMessages = () => {
    router.push('/messages?tab=doctor-doctor');
  };

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-500">Betöltés...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50">
        <div className="text-center py-4">
          <p className="text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">Konzílium</h3>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleViewMessages}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            Összes megtekintése
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages List */}
      <div className="mt-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>Még nincsenek orvos-orvos üzenetek ebben a betegben</p>
            <p className="text-sm mt-1 text-gray-400">
              Az orvosok közötti üzenetek, amelyekben erre a betegre hivatkoznak (@mention), itt jelennek meg.
            </p>
          </div>
        ) : (
          messages.slice(0, 5).map((message) => {
            const isFromCurrentUser = false; // We don't track current user here, but could if needed

            return (
              <div
                key={message.id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={handleViewMessages}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-gray-900">
                        {message.senderName || message.senderEmail}
                      </span>
                      {message.recipientId && (
                        <>
                          <span className="text-gray-400">→</span>
                          <span className="text-sm text-gray-600">
                            {message.recipientId ? 'Orvos' : ''}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-sm text-gray-700 mb-2">
                      <MessageTextRenderer text={message.message} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      <span>
                        {format(new Date(message.createdAt), 'yyyy. MM. dd. HH:mm', { locale: hu })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {messages.length > 5 && (
        <div className="mt-4 pt-4 border-t">
          <button
            onClick={handleViewMessages}
            className="w-full btn-secondary flex items-center justify-center gap-2"
          >
            További {messages.length - 5} üzenet megtekintése
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

