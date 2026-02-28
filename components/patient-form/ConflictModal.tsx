'use client';

import { X, AlertTriangle } from 'lucide-react';
import { ApiError } from '@/lib/storage';

interface ConflictModalProps {
  showConflictModal: boolean;
  conflictError: ApiError | null;
  onDismiss: () => void;
  onRefresh: () => void;
  onOverwrite: (() => Promise<void>) | null;
  userRole: string;
}

export function ConflictModal({
  showConflictModal,
  conflictError,
  onDismiss,
  onRefresh,
  onOverwrite,
  userRole,
}: ConflictModalProps) {
  if (!showConflictModal || !conflictError) return null;

  const details = conflictError.details && typeof conflictError.details === 'object' && 'serverUpdatedAt' in conflictError.details
    ? conflictError.details as { serverUpdatedAt?: string; clientUpdatedAt?: string }
    : null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6">
          <div className="flex items-start mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Konfliktus észlelve
              </h3>
              <p className="text-sm text-gray-700 mb-4">
                Másik felhasználó módosította a beteg adatait közben. Mit szeretne tenni?
              </p>
              
              {details && (
                <details className="mb-4 text-xs text-gray-600">
                  <summary className="cursor-pointer hover:text-gray-800 mb-2">
                    Részletek
                  </summary>
                  <div className="pl-4 space-y-1">
                    {conflictError.correlationId && (
                      <div>
                        <strong>Correlation ID:</strong> {String(conflictError.correlationId)}
                      </div>
                    )}
                    {details.serverUpdatedAt && (
                      <div>
                        <strong>Szerver frissítve:</strong>{' '}
                        {new Date(details.serverUpdatedAt).toLocaleString('hu-HU')}
                      </div>
                    )}
                    {details.clientUpdatedAt && (
                      <div>
                        <strong>Kliens verzió:</strong>{' '}
                        {new Date(details.clientUpdatedAt).toLocaleString('hu-HU')}
                      </div>
                    )}
                  </div>
                </details>
              )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Modal bezárása"
          >
            <X className="w-5 h-5" />
          </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onRefresh}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors text-sm font-medium"
          >
            Frissítés
          </button>
          
          {(userRole === 'admin' || userRole === 'editor') && onOverwrite && (
            <button
              type="button"
              onClick={onOverwrite}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition-colors text-sm font-medium"
            >
              Felülírás
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
