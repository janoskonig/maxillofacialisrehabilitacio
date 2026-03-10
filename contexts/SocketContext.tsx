'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { getCurrentUser } from '@/lib/auth';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinRoom: (patientId: string) => void;
  leaveRoom: (patientId: string) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  joinRoom: () => {},
  leaveRoom: () => {},
});

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/privacy', '/privacy-hu', '/terms', '/terms-hu'];

function isPublicPath(): boolean {
  if (typeof window === 'undefined') return false;
  return PUBLIC_PATHS.some(p => window.location.pathname === p || window.location.pathname.startsWith(p + '/'));
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (isPublicPath()) return;

    let newSocket: Socket | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;
    let cancelled = false;
    
    const initializeSocket = async () => {
      const user = await getCurrentUser();
      if (!user) {
        return null;
      }

      if (newSocket && newSocket.connected) {
        return newSocket;
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
      
      const socket = io(baseUrl, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true,
        autoConnect: true,
      });

      socket.on('connect', () => {
        setIsConnected(true);
      });

      socket.on('disconnect', () => {
        setIsConnected(false);
      });

      socket.on('connect_error', (error) => {
        console.error('[Socket Client] Connection error:', error);
        setIsConnected(false);
      });

      return socket;
    };

    const scheduleRetry = (attempt: number) => {
      if (cancelled) return;
      const delay = Math.min(10_000 * Math.pow(2, attempt), 60_000);
      retryTimeout = setTimeout(async () => {
        if (cancelled) return;
        const socket = await initializeSocket();
        if (socket) {
          newSocket = socket;
          setSocket(socket);
        } else {
          scheduleRetry(attempt + 1);
        }
      }, delay);
    };

    initializeSocket().then(socket => {
      if (cancelled) {
        socket?.close();
        return;
      }
      if (socket) {
        newSocket = socket;
        setSocket(socket);
      } else {
        scheduleRetry(0);
      }
    });

    return () => {
      cancelled = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (newSocket) {
        newSocket.close();
      }
    };
  }, []);

  const joinRoom = useCallback((patientId: string) => {
    if (socket && isConnected) {
      socket.emit('join-room', { patientId });
    }
  }, [socket, isConnected]);

  const leaveRoom = useCallback((patientId: string) => {
    if (socket && isConnected) {
      socket.emit('leave-room', { patientId });
    }
  }, [socket, isConnected]);

  return (
    <SocketContext.Provider value={{ socket, isConnected, joinRoom, leaveRoom }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
}
