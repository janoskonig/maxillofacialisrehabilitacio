import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifySocketAuth, SocketAuthPayload } from './socket-auth';

let io: SocketIOServer | null = null;

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

    // Join patient room if applicable
    if (auth.userType === 'patient' && auth.patientId) {
      const room = `patient:${auth.patientId}`;
      socket.join(room);
      console.log(`[Socket] Patient ${auth.patientId} joined room: ${room}`);
    }

    // Handle join-room event (for doctors joining patient rooms)
    socket.on('join-room', async (data: { patientId: string }) => {
      if (!data.patientId) {
        return;
      }

      // Verify access (doctors need to have access to the patient)
      if (auth.userType === 'doctor') {
        // TODO: Verify doctor has access to this patient
        // For now, allow all authenticated doctors
        const room = `patient:${data.patientId}`;
        socket.join(room);
        console.log(`[Socket] Doctor ${auth.userId} joined room: ${room}`);
      }
    });

    // Handle leave-room event
    socket.on('leave-room', (data: { patientId: string }) => {
      if (data.patientId) {
        const room = `patient:${data.patientId}`;
        socket.leave(room);
        console.log(`[Socket] User ${auth.userId} left room: ${room}`);
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
