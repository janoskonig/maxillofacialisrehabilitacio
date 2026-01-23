'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface MobileBackButtonProps {
  onClick?: () => void;
  label?: string;
  className?: string;
}

/**
 * Mobile back button component
 * - Default: uses router.back() if no onClick provided
 * - Always shows icon + label (not icon-only)
 * - Includes aria-label for accessibility
 */
export function MobileBackButton({ 
  onClick, 
  label = 'Vissza',
  className = '' 
}: MobileBackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      router.back();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors ${className}`}
      aria-label={label}
    >
      <ArrowLeft className="w-5 h-5" />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
