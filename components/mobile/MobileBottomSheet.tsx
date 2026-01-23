'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBreakpoint } from '@/hooks/useBreakpoint';

interface MobileBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  type?: 'action' | 'dialog';
  children: ReactNode;
}

/**
 * Mobile bottom sheet component
 * - Mobile: slides up from bottom, max-height 85vh
 * - Desktop: centered modal (fallback)
 * - A11y: focus trap, ESC close, overlay click close
 * - Safe-area: padding-bottom for content
 */
export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  description,
  type = 'dialog',
  children,
}: MobileBottomSheetProps) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  
  // SSR-safe mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC key handler
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  // Focus trap
  useEffect(() => {
    if (!open || !contentRef.current) return;

    const content = contentRef.current;
    const focusableElements = content.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    // Edge case: no focusable elements
    if (focusableElements.length === 0) return;
    
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    // Focus first element (only if it exists)
    if (firstElement) {
      firstElement.focus();
    }

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  // Prevent body scroll when open (with counter for multiple modals)
  useEffect(() => {
    if (open) {
      // Increment lock counter
      const currentCount = parseInt(document.body.dataset.scrollLockCount || '0', 10);
      document.body.dataset.scrollLockCount = String(currentCount + 1);
      document.body.style.overflow = 'hidden';
    } else {
      // Decrement lock counter
      const currentCount = parseInt(document.body.dataset.scrollLockCount || '0', 10);
      const newCount = Math.max(0, currentCount - 1);
      document.body.dataset.scrollLockCount = String(newCount);
      
      // Only unlock if no other modals are open
      if (newCount === 0) {
        document.body.style.overflow = '';
      }
    }
    return () => {
      // Cleanup: ensure we don't leave body locked
      const currentCount = parseInt(document.body.dataset.scrollLockCount || '0', 10);
      const newCount = Math.max(0, currentCount - 1);
      document.body.dataset.scrollLockCount = String(newCount);
      if (newCount === 0) {
        document.body.style.overflow = '';
      }
    };
  }, [open]);

  // Don't render when closed or before mount
  if (!mounted || !open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onOpenChange(false);
    }
  };

  const content = (
    <div
      ref={overlayRef}
      className={`fixed inset-0 bg-black/50 z-50 ${
        isMobile ? 'flex items-end justify-center' : 'flex items-center justify-center p-4'
      }`}
      onClick={handleOverlayClick}
    >
      <div
        ref={contentRef}
        className={`
          bg-white w-full max-w-2xl
          ${isMobile ? 'rounded-t-lg max-h-[85vh]' : 'rounded-lg max-h-[90vh]'}
          ${isMobile ? 'animate-slide-up' : 'animate-scale-in'}
          flex flex-col
          ${isMobile ? 'shadow-2xl' : 'shadow-xl'}
        `}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'bottomsheet-title' : undefined}
        aria-describedby={description ? 'bottomsheet-description' : undefined}
      >
        {/* Handle bar (mobile only) */}
        {isMobile && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-12 h-1 bg-gray-300 rounded-full" />
          </div>
        )}

        {/* Header */}
        {(title || description) && (
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
            {title && (
              <h2 id="bottomsheet-title" className="text-lg font-semibold text-gray-900">
                {title}
              </h2>
            )}
            {description && (
              <p id="bottomsheet-description" className="mt-1 text-sm text-gray-600">
                {description}
              </p>
            )}
          </div>
        )}

        {/* Content */}
        <div
          className={`
            flex-1 overflow-y-auto
            ${isMobile ? 'px-4 py-4 mobile-safe-bottom' : 'px-6 py-6'}
          `}
        >
          {children}
        </div>

        {/* Close button (desktop only) */}
        {!isMobile && (
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors mobile-touch-target"
            aria-label="Bezárás"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );

  // Use portal for better z-index management (SSR-safe)
  if (!mounted) {
    return null;
  }

  return createPortal(content, document.body);
}
