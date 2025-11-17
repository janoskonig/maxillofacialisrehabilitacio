'use client';

import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  message: string;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

export function ConfirmDialog({
  message,
  isOpen,
  onConfirm,
  onCancel,
  title = 'Megerősítés',
  confirmText = 'Igen',
  cancelText = 'Mégse',
  type = 'info'
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const colors = {
    danger: 'bg-red-50 border-red-200',
    warning: 'bg-yellow-50 border-yellow-200',
    info: 'bg-blue-50 border-blue-200',
  };

  const buttonColors = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-yellow-600 hover:bg-yellow-700',
    info: 'bg-blue-600 hover:bg-blue-700',
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div 
        className={`${colors[type]} border rounded-lg shadow-lg p-6 max-w-md w-full mx-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <AlertTriangle className={`w-6 h-6 flex-shrink-0 mt-0.5 ${
            type === 'danger' ? 'text-red-600' : 
            type === 'warning' ? 'text-yellow-600' : 
            'text-blue-600'
          }`} />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
            <p className="text-sm text-gray-700 mb-4">{message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                {cancelText}
              </button>
              <button
                onClick={onConfirm}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${buttonColors[type]}`}
              >
                {confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

