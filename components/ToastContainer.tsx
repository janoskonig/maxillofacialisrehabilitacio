'use client';

import { Toast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';

export function ToastContainer() {
  const { toasts, confirmDialog, removeToast } = useToast();

  return (
    <>
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          style={{
            bottom: `${20 + index * 80}px`,
          }}
          className="fixed right-2 sm:right-4 left-2 sm:left-auto z-50 max-w-sm sm:max-w-md"
        >
          <Toast
            message={toast.message}
            type={toast.type}
            isVisible={true}
            onClose={() => removeToast(toast.id)}
            duration={toast.duration}
          />
        </div>
      ))}
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          isOpen={!!confirmDialog}
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
          title={confirmDialog.options?.title}
          confirmText={confirmDialog.options?.confirmText}
          cancelText={confirmDialog.options?.cancelText}
          type={confirmDialog.options?.type}
        />
      )}
    </>
  );
}

