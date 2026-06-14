import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Opcionális CTA (pl. <Button>). */
  action?: ReactNode;
  className?: string;
}

/** Egységes üres állapot — kiváltja az ismétlődő `card text-center py-12` blokkokat. */
export function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`card text-center py-12 ${className}`.trim()}>
      {Icon && (
        <div className="flex justify-center mb-3">
          <Icon className="w-10 h-10 text-gray-300" />
        </div>
      )}
      <p className="text-gray-900 font-medium">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
