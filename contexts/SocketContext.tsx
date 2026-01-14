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

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let newSocket: Socket | null = null;
    let checkInterval: NodeJS.Timeout | null = null;
    
    const initializeSocket = async () => {
      // Csak akkor próbálunk csatlakozni, ha van bejelentkezett felhasználó
      const user = await getCurrentUser();
      if (!user) {
        return null;
      }

      // Ha már van kapcsolat, ne hozzunk létre újat
      if (newSocket && newSocket.connected) {
        return newSocket;
      }

      // Initialize socket connection
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
      
      // Socket.io client automatically handles ws:// or wss:// based on http/https
      const socket = io(baseUrl, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true,
        autoConnect: true,
      });

      socket.on('connect', () => {
        setIsConnected(true);
        // Töröljük az ellenőrzési intervallumot, ha sikeresen csatlakoztunk
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
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

    // Próbáljuk meg inicializálni azonnal
    initializeSocket().then(socket => {
      if (socket) {
        newSocket = socket;
        setSocket(socket);
      } else {
        // Ha nincs bejelentkezett felhasználó, ellenőrizzük periodikusan
        checkInterval = setInterval(async () => {
          const socket = await initializeSocket();
          if (socket) {
            newSocket = socket;
            setSocket(socket);
            if (checkInterval) {
              clearInterval(checkInterval);
              checkInterval = null;
            }
          }
        }, 2000); // 2 másodpercenként ellenőrizzük
      }
    });

    // Cleanup on unmount
    return () => {
      if (checkInterval) {
        clearInterval(checkInterval);
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
