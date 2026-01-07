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
  onClick?: () => void;
}

export function DashboardWidget({
  title,
  icon,
  children,
  className = '',
  onClose,
  collapsible = false,
  defaultCollapsed = false,
  onClick,
}: DashboardWidgetProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div 
      className={`card card-hover ${className} animate-fade-in ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          {icon && <div className="text-medical-primary flex-shrink-0">{icon}</div>}
          <h3 className="text-heading-4">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {collapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-gray-400 hover:text-gray-600 p-1.5 rounded-md hover:bg-gray-100 transition-all duration-200"
              aria-label={isCollapsed ? 'Kibontás' : 'Összecsukás'}
            >
              {isCollapsed ? '▼' : '▲'}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1.5 rounded-md hover:bg-gray-100 transition-all duration-200"
              aria-label="Bezárás"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {!isCollapsed && (
        <div className="p-4">
          {children}
        </div>
      )}
    </div>
  );
}

