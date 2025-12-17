'use client';

import { useState, useEffect } from 'react';
import { X, Menu, CalendarDays, Settings, LogOut, Shield, Home, Users, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import { useFeedback } from '@/components/FeedbackContext';
import { getStoredErrors } from '@/lib/errorLogger';

interface MobileMenuProps {
  currentPath?: string;
}

export function MobileMenu({ currentPath }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hasStoredErrors, setHasStoredErrors] = useState(false);
  const router = useRouter();
  const { openModal } = useFeedback();

  useEffect(() => {
    const loadUser = async () => {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    };
    loadUser();
    
    // Check for stored errors
    const errors = getStoredErrors();
    setHasStoredErrors(errors.length > 0);
  }, []);

  const handleLogout = () => {
    setIsOpen(false);
    logout();
    router.push('/login');
  };

  const handleNavigate = (path: string) => {
    setIsOpen(false);
    router.push(path);
  };

  if (!user) {
    return null;
  }

  return (
    <>
      {/* Hamburger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="md:hidden p-2 rounded-md text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-medical-primary"
        aria-label="Menü megnyitása"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Overlay */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 md:hidden"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Menu Drawer */}
          <div
            className={`fixed top-0 left-0 h-full w-80 bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
              isOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-bold text-gray-900">Menü</h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-md text-gray-700 hover:bg-gray-100"
                  aria-label="Menü bezárása"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* User Info */}
              <div className="p-4 border-b bg-gray-50">
                <p className="text-sm font-medium text-gray-900">{user.email}</p>
                <p className="text-xs text-gray-500 mt-1 capitalize">{user.role}</p>
              </div>

              {/* Menu Items */}
              <nav className="flex-1 overflow-y-auto">
                <div className="p-2">
                  <button
                    onClick={() => handleNavigate('/')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      currentPath === '/' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Home className="w-5 h-5" />
                    <span className="font-medium">Főoldal</span>
                  </button>

                  <button
                    onClick={() => handleNavigate('/calendar')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      currentPath === '/calendar' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <CalendarDays className="w-5 h-5" />
                    <span className="font-medium">Naptár</span>
                  </button>

                  {(user.role === 'fogpótlástanász' || user.role === 'admin') && (
                    <button
                      onClick={() => handleNavigate('/time-slots')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                        currentPath === '/time-slots' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <CalendarDays className="w-5 h-5" />
                      <span className="font-medium">Időpontok kezelése</span>
                    </button>
                  )}

                  {user.role === 'admin' && (
                    <button
                      onClick={() => handleNavigate('/admin')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                        currentPath === '/admin' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <Shield className="w-5 h-5" />
                      <span className="font-medium">Admin</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleNavigate('/settings')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      currentPath === '/settings' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Settings className="w-5 h-5" />
                    <span className="font-medium">Beállítások</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsOpen(false);
                      openModal();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 hover:bg-gray-100 transition-colors relative"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span className="font-medium">Visszajelzés</span>
                    {hasStoredErrors && (
                      <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        !
                      </span>
                    )}
                  </button>
                </div>
              </nav>

              {/* Footer */}
              <div className="p-4 border-t">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-red-700 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Kijelentkezés</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

