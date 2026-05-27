/**
 * Üzenetcsatorna azonosítója. A reply-célok mindig saját csatornájukra
 * mutatnak (lásd 041_message_replies migráció), így a cross-channel
 * idézés modell-szinten nem megengedett.
 */
export type MessageChannel = 'patient' | 'doctor';

/** Szerveroldali kézbesítési állapot (042 migráció, Fázis 1.2+). */
export type ServerDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Egy idézett (válaszolt) üzenet előnézete a buborékban / API válaszban.
 *
 * NEM tartalmazza a teljes eredeti üzenetet (csak rövid preview-t), mert:
 *  - a buborékban úgyis csak ~2 sort jelenítünk meg,
 *  - ha az eredeti törölve van, csak a metaadat marad (deleted = true).
 *
 * A `message` mező a `buildQuotedMessagePreviewText` által csonkolt szöveg.
 * A `channel` segít a kliensnek eldönteni, hogy melyik csatornán scrolloljon
 * az eredetihez (Fázis 0.5/0.6 integráció során használjuk).
 */
export interface QuotedMessagePreview {
  id: string;
  channel: MessageChannel;
  senderId: string;
  senderName: string | null;
  message: string;
  createdAt: Date;
  deleted?: boolean;
}

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
  /** 041_message_replies óta: ha válasz, az eredeti doctor_messages.id. */
  replyToMessageId?: string | null;
  /**
   * 041_message_replies óta: szerver által összeállított preview az
   * eredeti üzenetről, hogy a buborék külön roundtrip nélkül rendezhető
   * legyen. Csak akkor jön ki a DB-ből, ha `replyToMessageId` van és a
   * megtekintő látja az eredetit (jogosultság ellenőrzés Fázis 0.2-ben).
   */
  quotedMessage?: QuotedMessagePreview | null;
  /** Fázis 1.1: közvetlen válaszok száma (reply_to_message_id = ez az id). */
  replyCount?: number;
  /** Fázis 1.2: szerveroldali kézbesítési állapot (042 migráció). */
  deliveryStatus?: ServerDeliveryStatus;
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
