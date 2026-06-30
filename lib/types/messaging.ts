/**
 * Üzenetcsatorna azonosítója. A reply-célok mindig saját csatornájukra
 * mutatnak (lásd 041_message_replies migráció), így a cross-channel
 * idézés modell-szinten nem megengedett.
 */
export type MessageChannel = 'patient' | 'doctor';

/** Szerveroldali kézbesítési állapot (042 migráció, Fázis 1.2+). */
export type ServerDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/** Fázis 2 — Socket.io `message-delivery-status` esemény payload. */
export interface MessageDeliveryStatusEvent {
  messageId: string;
  deliveryStatus: 'delivered' | 'read';
  channel: MessageChannel;
  /** Beteg csatornán a szál azonosítója (kliens szűréshez). */
  patientId?: string;
  /** Orvos csatornán csoport esetén (kliens szűréshez). */
  groupId?: string | null;
}

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

/**
 * Egy feloldatlan, kétértelmű beteg-említés egy elküldött üzeneten (064 migráció).
 * A `matchedText` a szövegben felismert rész ("Kovács János"); a `candidates` a
 * szóba jövő, azonos nevű betegek (hidratált név + TAJ a választóhoz). Feloldáskor
 * a kiválasztott beteg bekerül a `mentionedPatientIds`-be, a bejegyzés pedig törlődik.
 */
export interface UnresolvedPatientMention {
  matchedText: string;
  candidates: Array<{ id: string; nev: string; taj?: string | null }>;
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
  /** Az említett betegek neve (id + nev), hogy a renderer lekérés nélkül linkelhessen. */
  mentionedPatients?: Array<{ id: string; nev: string; taj?: string | null }>;
  /**
   * 064: feloldatlan, kétértelmű beteg-említések (több azonos nevű beteg). Az
   * elküldött üzeneten utólag is feloldhatók — ki melyik beteg.
   */
  unresolvedMentions?: UnresolvedPatientMention[];
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
  /** Fázis 2.1: strukturált entitás-linkek. */
  contextLinks?: MessageContextLink[];
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

/** Fázis 2.0 — message_context_links.entity_type */
export type MessageContextEntityType =
  | 'patient'
  | 'episode'
  | 'work_phase'
  | 'appointment'
  | 'document'
  | 'consilium_session'
  | 'task';

export interface MessageContextLinkPreview {
  label: string;
  subtitle?: string | null;
  href?: string | null;
}

export interface MessageContextLink {
  id: string;
  channel: MessageChannel;
  messageId: string;
  entityType: MessageContextEntityType;
  entityId: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string | null;
  preview?: MessageContextLinkPreview | null;
}

/** message_audit_events.event_type — context link és egyéb üzenet-mutációk */
export type MessageAuditEventType =
  | 'context_link_added'
  | 'context_link_removed'
  | 'created'
  | 'edited'
  | 'deleted'
  | 'restored'
  | 'pinned'
  | 'unpinned'
  | 'attachment_added'
  | 'attachment_removed';

/** Fázis 2.2 — FTS keresés találat (snippet + rank). */
export interface MessageSearchHit {
  id: string;
  channel: MessageChannel;
  patientId?: string;
  patientName?: string | null;
  senderType?: 'doctor' | 'patient';
  senderId: string;
  /** Beteg csatorna: címzett orvos (lane), beteg által küldött üzenetnél. */
  recipientDoctorId?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
  recipientId?: string | null;
  groupId?: string | null;
  subject: string | null;
  message: string;
  snippet: string;
  rank: number;
  createdAt: Date;
  replyToMessageId?: string | null;
}

export interface MessageSearchResult {
  hits: MessageSearchHit[];
  total: number;
  limit: number;
  offset: number;
}
