'use client';

import { ReactNode, memo, useRef } from 'react';
import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MobileSkeletonCard } from './MobileSkeletonCard';

const VIRTUALIZE_THRESHOLD = 40;

interface MobileTableProps<T> {
  items: T[];
  renderRow: (item: T, index: number) => ReactNode;
  renderCard: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  emptyState?: ReactNode;
  loading?: boolean;
  skeletonCount?: number;
  className?: string;
  mobileCardClassName?: string;
  renderHeader?: () => ReactNode;
  rowClassName?: (item: T, index: number) => string;
  estimateRowHeight?: number;
  estimateCardHeight?: number;
}

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
  estimateRowHeight = 56,
  estimateCardHeight = 120,
}: MobileTableProps<T>) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const shouldVirtualize = items.length > VIRTUALIZE_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => (isMobile ? estimateCardHeight : estimateRowHeight),
    overscan: 10,
  });

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
    if (!shouldVirtualize) {
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
    return (
      <div ref={scrollParentRef} className={`overflow-auto ${className}`} style={{ maxHeight: '80vh' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            return (
              <div
                key={keyExtractor(item, virtualItem.index)}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className={`pb-4 ${mobileCardClassName}`}
              >
                {renderCard(item, virtualItem.index)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop: Table view (non-virtualized for small lists)
  if (!shouldVirtualize) {
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

  // Desktop: Virtualized table
  return (
    <div className={`card p-0 overflow-hidden ${className}`}>
      <div ref={scrollParentRef} className="overflow-auto" style={{ maxHeight: '80vh' }}>
        <table className="min-w-full divide-y divide-gray-200">
          {renderHeader && (
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50 sticky top-0 z-10">
              <tr>
                {renderHeader()}
              </tr>
            </thead>
          )}
          <tbody className="bg-white divide-y divide-gray-200">
            {/* spacer row for virtual offset */}
            {rowVirtualizer.getVirtualItems().length > 0 && rowVirtualizer.getVirtualItems()[0].start > 0 && (
              <tr><td colSpan={100} style={{ height: rowVirtualizer.getVirtualItems()[0].start, padding: 0 }} /></tr>
            )}
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const item = items[virtualItem.index];
              const defaultClassName = "hover:bg-gray-50";
              const customClassName = rowClassName ? rowClassName(item, virtualItem.index) : '';
              const finalClassName = customClassName ? `${defaultClassName} ${customClassName}` : defaultClassName;
              return (
                <tr
                  key={keyExtractor(item, virtualItem.index)}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  className={finalClassName}
                >
                  {renderRow(item, virtualItem.index)}
                </tr>
              );
            })}
            {/* spacer row for bottom padding */}
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <tr>
                <td
                  colSpan={100}
                  style={{
                    height: rowVirtualizer.getTotalSize() -
                      (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                    padding: 0,
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const MobileTable = memo(MobileTableComponent) as typeof MobileTableComponent;
