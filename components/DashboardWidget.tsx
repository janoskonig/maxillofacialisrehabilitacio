'use client';

import { useState, ReactNode } from 'react';
import { X } from 'lucide-react';

interface DashboardWidgetProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  onClose?: () => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function DashboardWidget({
  title,
  icon,
  children,
  className = '',
  onClose,
  collapsible = false,
  defaultCollapsed = false,
}: DashboardWidgetProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}>
      <div className="flex items-center justify-between p-3 sm:p-4 border-b">
        <div className="flex items-center gap-2">
          {icon && <div className="text-medical-primary">{icon}</div>}
          <h3 className="text-sm sm:text-base font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {collapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-gray-400 hover:text-gray-600 p-1"
              aria-label={isCollapsed ? 'Kibontás' : 'Összecsukás'}
            >
              {isCollapsed ? '▼' : '▲'}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1"
              aria-label="Bezárás"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {!isCollapsed && (
        <div className="p-3 sm:p-4">
          {children}
        </div>
      )}
    </div>
  );
}

