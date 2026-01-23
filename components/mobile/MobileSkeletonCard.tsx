'use client';

interface MobileSkeletonCardProps {
  lines?: number;
  className?: string;
}

/**
 * Mobile skeleton card component
 * - Consistent loading state for mobile cards
 * - Used in PatientList, WaitingPatientsList, etc.
 * - Prevents different skeleton implementations everywhere
 */
export function MobileSkeletonCard({ lines = 3, className = '' }: MobileSkeletonCardProps) {
  return (
    <div className={`mobile-card ${className}`}>
      {/* Title skeleton */}
      <div className="animate-pulse bg-gray-200 rounded h-5 w-3/4 mb-3" />
      
      {/* Value lines skeleton */}
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className="animate-pulse bg-gray-200 rounded h-4" />
        ))}
      </div>
    </div>
  );
}
