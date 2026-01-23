'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBreakpoint } from '@/hooks/useBreakpoint';

interface MobileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  side?: 'left' | 'right';
  children: ReactNode;
}

/**
 * Mobile drawer component (slide-in panel)
 * - Mobile: slides in from left or right, full height
 * - Desktop: not shown (conditional rendering recommended)
 * - A11y: focus trap, ESC close, overlay click close
 * - Safe-area: top and bottom padding
 */
export function MobileDrawer({
  open,
  onOpenChange,
  title,
  side = 'left',
  children,
}: MobileDrawerProps) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  
  // SSR-safe mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close drawer when breakpoint changes from mobile to desktop
  useEffect(() => {
    if (open && !isMobile) {
      onOpenChange(false);
    }
  }, [isMobile, open, onOpenChange]);

  // ESC key handler
  useEffect(() => {
    if (!open || !isMobile) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange, isMobile]);

  // Focus trap
  useEffect(() => {
    if (!open || !isMobile || !contentRef.current) return;

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
  }, [open, isMobile]);

  // Prevent body scroll when open (with counter for multiple modals)
  useEffect(() => {
    if (!isMobile) return;
    
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
  }, [open, isMobile]);

  // Don't render on desktop, when closed, or before mount
  if (!mounted || !isMobile || !open) {
    return null;
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onOpenChange(false);
    }
  };

  const slideClass = side === 'left' 
    ? 'translate-x-0' 
    : 'translate-x-0';
  const initialSlideClass = side === 'left'
    ? '-translate-x-full'
    : 'translate-x-full';

  const content = (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/50 z-50"
      onClick={handleOverlayClick}
    >
      <div
        ref={contentRef}
        className={`
          fixed top-0 ${side === 'left' ? 'left-0' : 'right-0'}
          h-full w-80 bg-white shadow-2xl
          transform transition-transform duration-300 ease-in-out
          ${open ? slideClass : initialSlideClass}
          flex flex-col
          mobile-safe-top mobile-safe-bottom
        `}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'drawer-title' : undefined}
      >
        {/* Header */}
        {title && (
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 id="drawer-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            <button
              onClick={() => onOpenChange(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors mobile-touch-target"
              aria-label="Bezárás"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );

  // Use portal for better z-index management (SSR-safe)
  if (!mounted) {
    return null;
  }

  return createPortal(content, document.body);
}
