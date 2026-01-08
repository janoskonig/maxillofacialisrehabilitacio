'use client';

import { useState, useEffect } from 'react';
import { X, Menu, CalendarDays, Settings, LogOut, Shield, Home, Users, MessageCircle, ArrowLeft, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import { useFeedback } from '@/components/FeedbackContext';
import { getStoredErrors } from '@/lib/errorLogger';

interface MobileMenuProps {
  currentPath?: string;
  onMessageClick?: () => void;
  onNewPatientClick?: () => void;
  showBackButton?: boolean;
}

export function MobileMenu({ currentPath, onMessageClick, onNewPatientClick, showBackButton }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hasStoredErrors, setHasStoredErrors] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { openModal } = useFeedback();

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
      } catch (error) {
        console.error('Error loading user:', error);
      } finally {
        setIsLoading(false);
      }
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

  if (isLoading) {
    return (
      <button
        className="md:hidden p-2 rounded-md text-gray-700"
        aria-label="Betöltés..."
        disabled
      >
        <Menu className="w-6 h-6" />
      </button>
    );
  }

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
            className={`fixed top-0 left-0 h-full w-80 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
              isOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            style={{ backgroundColor: '#ffffff' }}
          >
            <div className="flex flex-col h-full bg-white" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white flex-shrink-0">
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
              <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                <p className="text-sm font-medium text-gray-900">{user.email}</p>
                <p className="text-xs text-gray-500 mt-1 capitalize">{user.role}</p>
              </div>

              {/* Menu Items */}
              <div className="overflow-y-auto bg-white" style={{ padding: '8px', height: 'calc(100vh - 200px)', minHeight: '300px' }}>
                  {/* Főoldal - mindig megjelenik */}
                  <button
                    onClick={() => handleNavigate('/')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors mb-1 ${
                      currentPath === '/' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    style={{ backgroundColor: currentPath === '/' ? '#eff6ff' : '#ffffff', display: 'flex' }}
                  >
                    <Home className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">Főoldal</span>
                  </button>

                  {/* Naptár - mindig megjelenik */}
                  <button
                    onClick={() => handleNavigate('/calendar')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors mb-1 ${
                      currentPath === '/calendar' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    style={{ backgroundColor: currentPath === '/calendar' ? '#eff6ff' : '#ffffff', display: 'flex' }}
                  >
                    <CalendarDays className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">Naptár</span>
                  </button>

                  {/* Admin - ha admin jogosultság van */}
                  {user.role === 'admin' && (
                    <button
                      onClick={() => handleNavigate('/admin')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors mb-1 ${
                        currentPath === '/admin' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                      style={{ backgroundColor: currentPath === '/admin' ? '#eff6ff' : '#ffffff', display: 'flex' }}
                    >
                      <Shield className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Admin</span>
                    </button>
                  )}

                  {onMessageClick && (
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        onMessageClick();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 hover:bg-gray-100 transition-colors mb-1"
                      style={{ backgroundColor: '#ffffff', display: 'flex' }}
                    >
                      <MessageCircle className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Üzenet</span>
                    </button>
                  )}

                  {onNewPatientClick && (user.role === 'admin' || user.role === 'editor' || user.role === 'fogpótlástanász' || user.role === 'sebészorvos') && (
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        onNewPatientClick();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 hover:bg-gray-100 transition-colors mb-1"
                      style={{ backgroundColor: '#eff6ff', color: '#1e40af', display: 'flex' }}
                    >
                      <Plus className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Új beteg</span>
                    </button>
                  )}

                  {(user.role === 'fogpótlástanász' || user.role === 'admin') && (
                    <button
                      onClick={() => handleNavigate('/time-slots')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors mb-1 ${
                        currentPath === '/time-slots' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                      style={{ backgroundColor: currentPath === '/time-slots' ? '#eff6ff' : '#ffffff', display: 'flex' }}
                    >
                      <CalendarDays className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Időpontok kezelése</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleNavigate('/settings')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors mb-1 ${
                      currentPath === '/settings' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    style={{ backgroundColor: currentPath === '/settings' ? '#eff6ff' : '#ffffff', display: 'flex' }}
                  >
                    <Settings className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">Beállítások</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsOpen(false);
                      openModal();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 hover:bg-gray-100 transition-colors relative mb-1"
                    style={{ backgroundColor: '#ffffff', display: 'flex' }}
                  >
                    <MessageCircle className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">Visszajelzés</span>
                    {hasStoredErrors && (
                      <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        !
                      </span>
                    )}
                  </button>

                  {showBackButton && currentPath !== '/' && (
                    <button
                      onClick={() => handleNavigate('/')}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 hover:bg-gray-100 transition-colors mb-1"
                      style={{ backgroundColor: '#ffffff', display: 'flex' }}
                    >
                      <ArrowLeft className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Vissza</span>
                    </button>
                  )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-red-700 hover:bg-red-50 transition-colors"
                  style={{ backgroundColor: '#ffffff', display: 'flex' }}
                >
                  <LogOut className="w-5 h-5 flex-shrink-0" />
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

