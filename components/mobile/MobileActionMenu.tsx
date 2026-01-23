'use client';

import { useState, ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MobileBottomSheet } from './MobileBottomSheet';

interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  hint?: string;
}

interface MobileActionMenuProps {
  items: ActionMenuItem[];
  trigger?: ReactNode;
}

/**
 * Mobile action menu component
 * - Mobile: opens MobileBottomSheet type="action"
 * - Desktop: dropdown menu (simple implementation)
 * - Guard: doesn't render if 0-1 items
 */
export function MobileActionMenu({ items, trigger }: MobileActionMenuProps) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [isOpen, setIsOpen] = useState(false);

  // Guard: don't render if 0 items
  if (items.length === 0) {
    return null;
  }

  const handleItemClick = (item: ActionMenuItem) => {
    if (item.disabled) return;
    item.onClick();
    setIsOpen(false);
  };

  // Mobile: BottomSheet
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setIsOpen(true)}
          className="p-2 text-gray-600 hover:text-gray-900 transition-colors mobile-touch-target"
          aria-label="További műveletek"
        >
          {trigger || <MoreVertical className="w-5 h-5" />}
        </button>

        <MobileBottomSheet
          open={isOpen}
          onOpenChange={setIsOpen}
          type="action"
        >
          <div className="divide-y divide-gray-200">
            {items.map((item, index) => (
              <button
                key={index}
                onClick={() => handleItemClick(item)}
                disabled={item.disabled}
                className={`
                  w-full px-4 py-3 text-left flex items-center gap-3
                  transition-colors mobile-touch-target
                  ${item.disabled 
                    ? 'opacity-50 cursor-not-allowed' 
                    : 'hover:bg-gray-50'
                  }
                  ${item.destructive 
                    ? 'text-red-600 hover:text-red-700 hover:bg-red-50' 
                    : 'text-gray-900'
                  }
                `}
              >
                {item.icon && (
                  <span className="flex-shrink-0">{item.icon}</span>
                )}
                <div className="flex-1">
                  <div className="font-medium text-sm">{item.label}</div>
                  {item.hint && (
                    <div className="text-xs text-gray-500 mt-0.5">{item.hint}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </MobileBottomSheet>
      </>
    );
  }

  // Desktop: Dropdown menu
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
        aria-label="További műveletek"
        aria-expanded={isDropdownOpen}
      >
        {trigger || <MoreVertical className="w-5 h-5" />}
      </button>

      {isDropdownOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsDropdownOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
            <div className="py-1">
              {items.map((item, index) => (
                <button
                  key={index}
                  onClick={() => handleItemClick(item)}
                  disabled={item.disabled}
                  className={`
                    w-full px-4 py-2 text-left flex items-center gap-3
                    transition-colors
                    ${item.disabled 
                      ? 'opacity-50 cursor-not-allowed' 
                      : 'hover:bg-gray-50'
                    }
                    ${item.destructive 
                      ? 'text-red-600 hover:text-red-700 hover:bg-red-50' 
                      : 'text-gray-900'
                    }
                  `}
                >
                  {item.icon && (
                    <span className="flex-shrink-0">{item.icon}</span>
                  )}
                  <div className="flex-1">
                    <div className="font-medium text-sm">{item.label}</div>
                    {item.hint && (
                      <div className="text-xs text-gray-500 mt-0.5">{item.hint}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
