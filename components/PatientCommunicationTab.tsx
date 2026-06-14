'use client';

import { useState } from 'react';
import { MessageCircle, Users, ClipboardList, Phone } from 'lucide-react';
import { PatientMessages } from '@/components/PatientMessages';
import { DoctorMessagesForPatient } from '@/components/DoctorMessagesForPatient';
import { PatientNextConsiliumSessionCard } from '@/components/PatientNextConsiliumSessionCard';
import { CommunicationLog } from '@/components/CommunicationLog';

interface PatientCommunicationTabProps {
  patientId: string;
  patientName: string | null;
  patientEmail: string | null;
  userRole: string | null;
}

type SubTab = 'beteg' | 'orvos' | 'konzilium' | 'naplo';

/**
 * „Kommunikáció” fül — egy helyre gyűjti a korábban három külön fülre szétszórt
 * kommunikációs felületeket: beteg-üzenet, orvos-orvos üzenet, konzílium, hívásnapló.
 */
export function PatientCommunicationTab({
  patientId,
  patientName,
  patientEmail,
  userRole,
}: PatientCommunicationTabProps) {
  const isTechnikus = userRole === 'technikus';

  const subTabs: Array<{ id: SubTab; label: string; icon: React.ReactNode }> = [
    ...(patientEmail
      ? [{ id: 'beteg' as SubTab, label: 'Beteg-üzenet', icon: <MessageCircle className="w-4 h-4" /> }]
      : []),
    { id: 'orvos', label: 'Orvos-orvos', icon: <Users className="w-4 h-4" /> },
    ...(!isTechnikus
      ? [{ id: 'konzilium' as SubTab, label: 'Konzílium', icon: <ClipboardList className="w-4 h-4" /> }]
      : []),
    { id: 'naplo', label: 'Hívásnapló', icon: <Phone className="w-4 h-4" /> },
  ];

  const [active, setActive] = useState<SubTab>(subTabs[0]?.id ?? 'orvos');

  return (
    <div className="space-y-4">
      {/* Al-fül navigáció */}
      <div className="flex gap-1 flex-wrap">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active === t.id
                ? 'bg-medical-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Al-fül tartalom */}
      <div>
        {active === 'beteg' && patientEmail && (
          <PatientMessages patientId={patientId} patientName={patientName} />
        )}
        {active === 'orvos' && (
          <DoctorMessagesForPatient patientId={patientId} patientName={patientName} />
        )}
        {active === 'konzilium' && !isTechnikus && (
          <PatientNextConsiliumSessionCard patientId={patientId} />
        )}
        {active === 'naplo' && (
          <CommunicationLog patientId={patientId} patientName={patientName} />
        )}
      </div>
    </div>
  );
}
