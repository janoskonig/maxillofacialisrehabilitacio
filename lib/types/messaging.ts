export interface DoctorMessage {
  id: string;
  senderId: string;
  recipientId: string | null;
  groupId?: string | null;
  senderEmail: string;
  senderName: string | null;
  recipientName?: string | null;
  groupName?: string | null;
  groupParticipantCount?: number;
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
  pending?: boolean;
  mentionedPatientIds?: string[];
  readBy?: Array<{
    userId: string;
    userName: string | null;
    readAt: Date;
  }>;
}

export interface DoctorConversation {
  doctorId: string;
  doctorName: string;
  doctorEmail: string;
  lastMessage: DoctorMessage | null;
  unreadCount: number;
  type?: 'individual' | 'group';
  groupId?: string;
  groupName?: string | null;
  participantCount?: number;
}

export interface DoctorMessageGroup {
  id: string;
  name: string | null;
  createdBy: string;
  createdAt: Date;
  participantCount?: number;
}

export interface DoctorGroupParticipant {
  userId: string;
  userName: string;
  userEmail: string;
  joinedAt: Date;
}

export interface DoctorGroupConversation {
  groupId: string;
  groupName: string | null;
  participants: DoctorGroupParticipant[];
  lastMessage: DoctorMessage | null;
  unreadCount: number;
  participantCount: number;
}

export interface PatientMention {
  id: string;
  nev: string;
  mentionFormat: string;
}
