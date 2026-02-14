'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, Info, AlertTriangle, AlertCircle } from 'lucide-react';

export type ContextBannerVariant = 'info' | 'warn' | 'error';

export interface ContextBannerProps {
  variant?: ContextBannerVariant;
  title: string;
  message: string;
  primaryLink?: {
    label: string;
    href: string;
  };
  /** Storage key for dismissible state. If set, banner can be dismissed (localStorage). Dismissible only after user clicked primaryLink or X. */
  dismissKey?: string;
  /** If true (default), dismiss only after user action. */
  dismissibleOnlyAfterAction?: boolean;
}

const VARIANT_STYLES: Record<ContextBannerVariant, { bg: string; border: string; icon: React.ReactNode }> = {
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />,
  },
  warn: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />,
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />,
  },
};

export function ContextBanner({
  variant = 'info',
  title,
  message,
  primaryLink,
  dismissKey,
  dismissibleOnlyAfterAction = true,
}: ContextBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [hasTakenAction, setHasTakenAction] = useState(false);

  useEffect(() => {
    if (!dismissKey) return;
    try {
      const stored = localStorage.getItem(dismissKey);
      if (stored === 'true') setDismissed(true);
      const actionKey = `${dismissKey}-action-taken`;
      const actionStored = localStorage.getItem(actionKey);
      if (actionStored === 'true') setHasTakenAction(true);
    } catch {
      // ignore
    }
  }, [dismissKey]);

  const handleDismiss = () => {
    if (!dismissKey) return;
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, 'true');
    } catch {
      // ignore
    }
  };

  const handlePrimaryLinkClick = () => {
    setHasTakenAction(true);
    try {
      if (dismissKey) {
        localStorage.setItem(`${dismissKey}-action-taken`, 'true');
      }
    } catch {
      // ignore
    }
  };

  const style = VARIANT_STYLES[variant];
  const showDismissButton =
    !!dismissKey &&
    (!dismissibleOnlyAfterAction || !primaryLink || hasTakenAction);

  if (dismissed) return null;

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border ${style.bg} ${style.border}`}
      role="status"
      aria-live="polite"
    >
      {style.icon}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <p className="text-sm text-gray-700 mt-0.5">{message}</p>
        {primaryLink && (
          <Link
            href={primaryLink.href}
            onClick={handlePrimaryLinkClick}
            className="inline-block mt-2 text-sm font-medium text-medical-primary hover:underline"
          >
            {primaryLink.label}
          </Link>
        )}
      </div>
      {showDismissButton && (
        <button
          onClick={handleDismiss}
          className="text-gray-500 hover:text-gray-700 p-1 rounded"
          aria-label="Bezárás"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
