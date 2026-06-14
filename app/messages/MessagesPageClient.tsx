'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { DoctorMessages } from '@/components/DoctorMessages';
import { PatientMessagesList } from '@/components/PatientMessagesList';
import { MessageCircle, Users } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { MessageSearchProvider } from '@/contexts/MessageSearchContext';
import { MessageSearchButton } from '@/components/messaging/MessageSearchButton';

export default function MessagesPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'doctor-doctor' | 'doctor-patient'>('doctor-doctor');
  const [doctorDoctorUnreadCount, setDoctorDoctorUnreadCount] = useState(0);
  const [doctorPatientUnreadCount, setDoctorPatientUnreadCount] = useState(0);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }

        setAuthorized(true);
      } catch (error) {
        console.error('Auth check error:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'doctor-patient' || tab === 'doctor-doctor') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!authorized) return;

    const fetchUnreadCounts = async () => {
      try {
        const doctorResponse = await fetch('/api/doctor-messages/unread-count', {
          credentials: 'include',
        });
        if (doctorResponse.ok) {
          const doctorData = await doctorResponse.json();
          setDoctorDoctorUnreadCount(doctorData.count || 0);
        }

        const patientResponse = await fetch('/api/messages/all?unreadOnly=true', {
          credentials: 'include',
        });
        if (patientResponse.ok) {
          const patientData = await patientResponse.json();
          const messages = patientData.messages || [];
          const unread = messages.filter((m: { senderType?: string; readAt?: unknown }) => m.senderType === 'patient' && !m.readAt).length;
          setDoctorPatientUnreadCount(unread);
        }
      } catch (error) {
        console.error('Hiba az olvasatlan üzenetek számának lekérdezésekor:', error);
      }
    };

    fetchUnreadCounts();
    const interval = setInterval(fetchUnreadCounts, 30_000);
    return () => clearInterval(interval);
  }, [authorized]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Betöltés...</div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <AppShell
      title="Üzenetek"
      backTo="/"
      maxWidth="xl"
      actions={<MessageSearchButton channel={activeTab === 'doctor-doctor' ? 'doctor' : 'patient'} />}
    >
      <MessageSearchProvider
        preferredChannel={activeTab === 'doctor-doctor' ? 'doctor' : 'patient'}
      >
        <div className="mb-4 border-b border-gray-200 overflow-x-auto scrollbar-hide">
          <nav className="flex gap-1 min-w-max" aria-label="Üzenetek fülök">
            <button
              onClick={() => setActiveTab('doctor-doctor')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'doctor-doctor'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <Users className="w-4 h-4" />
              Orvos-orvos
              {doctorDoctorUnreadCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                  {doctorDoctorUnreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('doctor-patient')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'doctor-patient'
                  ? 'text-medical-primary border-medical-primary'
                  : 'text-gray-700 hover:text-medical-primary border-transparent hover:border-medical-primary'
              }`}
            >
              <MessageCircle className="w-4 h-4" />
              Orvos-beteg
              {doctorPatientUnreadCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                  {doctorPatientUnreadCount}
                </span>
              )}
            </button>
          </nav>
        </div>

        <div>
          {activeTab === 'doctor-doctor' && (
            <DoctorMessages key="doctor-doctor" />
          )}
          {activeTab === 'doctor-patient' && (
            <PatientMessagesList key="doctor-patient" />
          )}
        </div>
      </MessageSearchProvider>
    </AppShell>
  );
}
