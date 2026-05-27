import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifySocketAuth, SocketAuthPayload } from './socket-auth';
import { getDbPool } from './db';
import { hasEverTreatedPatient } from './patient-doctor-access';

let io: SocketIOServer | null = null;

/**
 * Slice 0.7 — szoba elnevezések:
 *   patient:{patientId}        beteg ↔ orvos szál
 *   user:{userId}              egyetlen felhasználó (orvos vagy beteg) — 1:1 routing
 *   doctor-group:{groupId}     orvos csoport
 *
 * Az ACL ellenőrzés a `join-room` eseten történik. A `user:{userId}` szobába
 * a connect handler auto-joinol, így a kliensnek nem kell külön kérnie.
 */

/**
 * Initialize Socket.io server
 */
export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  if (io) {
    return io;
  }

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_BASE_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const cookies: Record<string, string> = {};
      
      // Parse cookies from handshake
      if (socket.handshake.headers.cookie) {
        socket.handshake.headers.cookie.split(';').forEach((cookie) => {
          const parts = cookie.trim().split('=');
          if (parts.length === 2) {
            cookies[parts[0]] = decodeURIComponent(parts[1]);
          }
        });
      }

      const auth = await verifySocketAuth(cookies);
      
      if (!auth) {
        return next(new Error('Authentication failed'));
      }

      // Store auth data in socket
      socket.data.auth = auth;
      next();
    } catch (error) {
      console.error('Socket auth middleware error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    const auth = socket.data.auth as SocketAuthPayload;
    console.log(`[Socket] User connected: ${auth.userType} ${auth.userId}`);

    // Auto-join per-user room — 1:1 cél (orvos → orvos new-doctor-message,
    // 1:1 doctor-message-read a feladónak).
    const userRoom = `user:${auth.userId}`;
    socket.join(userRoom);

    // Join patient room if applicable (sajat szal)
    if (auth.userType === 'patient' && auth.patientId) {
      const room = `patient:${auth.patientId}`;
      socket.join(room);
      console.log(`[Socket] Patient ${auth.patientId} joined room: ${room}`);
    }

    // Handle join-room event — Slice 0.7 ACL ellenőrzéssel.
    socket.on('join-room', async (data: { patientId?: string; groupId?: string }) => {
      if (data.patientId) {
        // Doctor: csak ha valaha kezelte ezt a beteget (vagy admin).
        if (auth.userType !== 'doctor') {
          console.warn(`[Socket] join-room patient rejected: ${auth.userType} not allowed`);
          return;
        }
        try {
          const allowed = auth.role === 'admin'
            || (await hasEverTreatedPatient(auth.userId, data.patientId));
          if (!allowed) {
            console.warn(`[Socket] ACL deny: doctor ${auth.userId} → patient:${data.patientId}`);
            return;
          }
          const room = `patient:${data.patientId}`;
          socket.join(room);
          console.log(`[Socket] Doctor ${auth.userId} joined room: ${room}`);
        } catch (err) {
          console.error(`[Socket] join-room patient ACL error:`, err);
        }
      } else if (data.groupId) {
        // Doctor: csak ha tényleg résztvevő a csoportban.
        if (auth.userType !== 'doctor') return;
        try {
          // A groupId érkezhet bare uuid-ként vagy `doctor-group:<uuid>` prefixszel.
          const rawId = data.groupId.startsWith('doctor-group:')
            ? data.groupId.slice('doctor-group:'.length)
            : data.groupId;
          const pool = getDbPool();
          const result = await pool.query(
            `SELECT 1 FROM doctor_message_group_participants
              WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
            [rawId, auth.userId],
          );
          if (result.rows.length === 0) {
            console.warn(`[Socket] ACL deny: doctor ${auth.userId} → doctor-group:${rawId}`);
            return;
          }
          const room = `doctor-group:${rawId}`;
          socket.join(room);
          console.log(`[Socket] Doctor ${auth.userId} joined group room: ${room}`);
        } catch (err) {
          console.error(`[Socket] join-room group ACL error:`, err);
        }
      }
    });

    // Handle leave-room event
    socket.on('leave-room', (data: { patientId?: string; groupId?: string }) => {
      if (data.patientId) {
        const room = `patient:${data.patientId}`;
        socket.leave(room);
        console.log(`[Socket] User ${auth.userId} left room: ${room}`);
      } else if (data.groupId) {
        const room = data.groupId;
        socket.leave(room);
        console.log(`[Socket] User ${auth.userId} left group room: ${room}`);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${auth.userType} ${auth.userId}`);
    });
  });

  return io;
}

/**
 * Get Socket.io instance
 */
export function getSocketIO(): SocketIOServer | null {
  return io;
}

/**
 * Emit new message event to patient room
 * Safe to call from API routes - will silently fail if Socket.io not initialized
 * Note: In Next.js, API routes may run in separate processes, so Socket.io might not be available
 */
export function emitNewMessage(patientId: string, message: any): void {
  // Try to get the Socket.io instance
  const socketIO = getSocketIO();
  
  if (!socketIO) {
    // Socket.io not initialized - this can happen if API routes run in separate processes
    // This is expected in some Next.js configurations, so we silently skip
    // The message will still be saved to the database, just no real-time update
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Socket] Socket.io not initialized - skipping real-time update (this is normal in some Next.js setups)');
    }
    return;
  }

  const room = `patient:${patientId}`;
  socketIO.to(room).emit('new-message', {
    message,
    patientId,
  });

  console.log(`[Socket] Emitted new-message to room: ${room}`);
}

/**
 * Emit message read event
 * Safe to call from API routes - will silently fail if Socket.io not initialized
 */
export function emitMessageRead(patientId: string, messageId: string): void {
  // Try to get the Socket.io instance
  const socketIO = getSocketIO();
  
  if (!socketIO) {
    // Socket.io not initialized yet (e.g., in development with separate API routes)
    // This is expected in some Next.js configurations, so we silently skip
    return;
  }

  const room = `patient:${patientId}`;
  socketIO.to(room).emit('message-read', {
    messageId,
    patientId,
  });

  console.log(`[Socket] Emitted message-read to room: ${room}`);
}

/**
 * Emit doctor message read event (for group chats)
 * Safe to call from API routes - will silently fail if Socket.io not initialized
 */
export function emitDoctorMessageRead(groupId: string, messageId: string, userId: string, userName: string | null): void {
  const socketIO = getSocketIO();
  
  if (!socketIO) {
    return;
  }

  const room = `doctor-group:${groupId}`;
  socketIO.to(room).emit('doctor-message-read', {
    messageId,
    groupId,
    userId,
    userName,
  });

  console.log(`[Socket] Emitted doctor-message-read to room: ${room}`);
}

/**
 * Slice 0.7 — új orvos üzenet realtime kézbesítés.
 *
 *  - `recipientUserIds`: kik kapják a 1:1 esetén (általában csak a címzett);
 *    csoportnál üres tömb is OK, akkor csak a group szobába megy.
 *  - `groupId`: ha csoport, ide is emit megy.
 *
 * A `user:{id}` szobát minden kliens automatikusan csatlakozik connect-kor,
 * így a 1:1 routing nem igényel client-oldali subscribe-ot.
 */
export function emitNewDoctorMessage(opts: {
  recipientUserIds: string[];
  groupId: string | null;
  message: unknown;
}): void {
  const socketIO = getSocketIO();
  if (!socketIO) return;

  const { recipientUserIds, groupId, message } = opts;
  const payload = { message, groupId };

  if (groupId) {
    const room = `doctor-group:${groupId}`;
    socketIO.to(room).emit('new-doctor-message', payload);
    console.log(`[Socket] Emitted new-doctor-message to ${room}`);
    return;
  }

  // 1:1 — minden címzettnek a saját szobájába.
  for (const recipientId of recipientUserIds) {
    const room = `user:${recipientId}`;
    socketIO.to(room).emit('new-doctor-message', payload);
    console.log(`[Socket] Emitted new-doctor-message to ${room}`);
  }
}

/**
 * Slice 0.7 — orvos üzenet 1:1 olvasott esemény: a feladónak küldjük,
 * hogy az ő UI-jában frissüljön a pipa-status. A group eset továbbra is
 * az `emitDoctorMessageRead`-en megy.
 */
export function emitDoctorMessageReadDirect(opts: {
  senderUserId: string;
  recipientUserId: string;
  messageId: string;
}): void {
  const socketIO = getSocketIO();
  if (!socketIO) return;

  const { senderUserId, recipientUserId, messageId } = opts;
  // Az eredeti feladó kapja a read jelzést.
  const room = `user:${senderUserId}`;
  socketIO.to(room).emit('doctor-message-read', {
    messageId,
    groupId: null,
    userId: recipientUserId,
    userName: null,
  });
  console.log(`[Socket] Emitted doctor-message-read (1:1) to ${room}`);
}
