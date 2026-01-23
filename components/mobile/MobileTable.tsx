'use client';

import { ReactNode, memo } from 'react';
import React from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MobileSkeletonCard } from './MobileSkeletonCard';

interface MobileTableProps<T> {
  items: T[];
  renderRow: (item: T, index: number) => ReactNode; // Desktop table row (td elements)
  renderCard: (item: T, index: number) => ReactNode; // Mobile card
  keyExtractor: (item: T, index: number) => string | number;
  emptyState?: ReactNode;
  loading?: boolean;
  skeletonCount?: number;
  className?: string;
  mobileCardClassName?: string;
  renderHeader?: () => ReactNode; // Optional desktop table header
  rowClassName?: (item: T, index: number) => string; // Optional row className callback
}

/**
 * MobileTable - Unified table/card component
 * - Desktop: renders table with renderRow
 * - Mobile: renders cards with renderCard
 * - Handles loading (skeleton) and empty states
 * - Consistent styling across the app
 */
function MobileTableComponent<T>({
  items,
  renderRow,
  renderCard,
  keyExtractor,
  emptyState,
  loading = false,
  skeletonCount = 5,
  className = '',
  mobileCardClassName = '',
  renderHeader,
  rowClassName,
}: MobileTableProps<T>) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  // Loading state
  if (loading) {
    if (isMobile) {
      return (
        <div className={`space-y-4 ${className}`}>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <MobileSkeletonCard key={index} className={mobileCardClassName} />
          ))}
        </div>
      );
    }
    // Desktop skeleton (simple table skeleton)
    return (
      <div className={`card p-0 overflow-hidden ${className}`}>
        <div className="animate-pulse">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          </div>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <div key={index} className="border-b border-gray-200 px-4 py-3">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    if (emptyState) {
      return <>{emptyState}</>;
    }
    return (
      <div className="card text-center py-8">
        <div className="text-gray-400 mb-2">Nincs találat</div>
        <p className="text-sm text-gray-500">Nincsenek megjeleníthető elemek</p>
      </div>
    );
  }

  // Mobile: Card view
  if (isMobile) {
    return (
      <div className={`space-y-4 ${className}`}>
        {items.map((item, index) => (
          <div key={keyExtractor(item, index)} className={mobileCardClassName}>
            {renderCard(item, index)}
          </div>
        ))}
      </div>
    );
  }

  // Desktop: Table view
  return (
    <div className={`card p-0 overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          {renderHeader && (
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
              <tr>
                {renderHeader()}
              </tr>
            </thead>
          )}
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item, index) => {
              const rowContent = renderRow(item, index);
              const defaultClassName = "hover:bg-gray-50";
              const customClassName = rowClassName ? rowClassName(item, index) : '';
              const finalClassName = customClassName ? `${defaultClassName} ${customClassName}` : defaultClassName;
              
              return (
                <tr key={keyExtractor(item, index)} className={finalClassName}>
                  {rowContent}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const MobileTable = memo(MobileTableComponent) as typeof MobileTableComponent;
