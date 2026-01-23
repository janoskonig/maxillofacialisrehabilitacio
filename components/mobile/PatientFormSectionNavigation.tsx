'use client';

import { useEffect, useRef, useState } from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { ChevronDown } from 'lucide-react';
import { MobileBottomSheet } from './MobileBottomSheet';

export interface Section {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface PatientFormSectionNavigationProps {
  sections: Section[];
  activeSectionId: string | null;
  onSectionChange: (sectionId: string) => void;
  sectionErrors?: Record<string, number>; // sectionId -> error count
}

/**
 * PatientFormSectionNavigation - Section navigation for PatientForm
 * - Mobile: Sticky top selector (dropdown/sheet)
 * - Desktop: Stepper or tabs
 * - Shows progress indicator: "Szekció neve / X of Y"
 * - Shows error badges on sections with validation errors
 */
export function PatientFormSectionNavigation({
  sections,
  activeSectionId,
  onSectionChange,
  sectionErrors = {},
}: PatientFormSectionNavigationProps) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [showMobileSelector, setShowMobileSelector] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeIndex = sections.findIndex(s => s.id === activeSectionId);
  const activeSection = activeIndex >= 0 ? sections[activeIndex] : null;
  const totalSections = sections.length;
  const currentSectionNumber = activeIndex >= 0 ? activeIndex + 1 : 0;

  // Scroll to section on change (edge case: element might not exist yet)
  const scrollToSection = (sectionId: string) => {
    if (typeof window === 'undefined') return;
    
    const element = document.getElementById(`section-${sectionId}`);
    if (!element) {
      // Edge case: element not found, try again after a short delay
      setTimeout(() => {
        const retryElement = document.getElementById(`section-${sectionId}`);
        if (retryElement) {
          const headerOffset = isMobile ? 80 : 100;
          const elementPosition = retryElement.getBoundingClientRect().top;
          const offsetPosition = elementPosition + (window.scrollY || window.pageYOffset) - headerOffset;
          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth',
          });
        }
      }, 200);
      return;
    }
    
    const headerOffset = isMobile ? 80 : 100; // Account for sticky header
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + (window.scrollY || window.pageYOffset) - headerOffset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
  };

  // Cleanup scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const handleSectionSelect = (sectionId: string) => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    onSectionChange(sectionId);
    setShowMobileSelector(false);
    
    // Scroll after a short delay to ensure DOM is updated
    scrollTimeoutRef.current = setTimeout(() => {
      scrollToSection(sectionId);
      scrollTimeoutRef.current = null;
    }, 100);
  };

  // Mobile: Sticky top selector
  if (isMobile) {
    return (
      <>
        <div className="mobile-header sticky top-0 z-30 bg-white border-b">
          <div className="px-4 py-3">
            {/* Progress indicator */}
            {activeSection && (
              <div className="text-xs text-gray-500 mb-2">
                {activeSection.label} / {currentSectionNumber} / {totalSections}
              </div>
            )}
            
            {/* Section selector button */}
            <button
              type="button"
              onClick={() => setShowMobileSelector(true)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors mobile-touch-target"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {activeSection?.icon && (
                  <div className="flex-shrink-0 text-medical-primary">
                    {activeSection.icon}
                  </div>
                )}
                <span className="text-sm font-medium text-gray-900 truncate">
                  {activeSection?.label || 'Válasszon szekciót'}
                </span>
                {activeSection && sectionErrors[activeSection.id] > 0 && (
                  <span className="flex-shrink-0 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                    {sectionErrors[activeSection.id]}
                  </span>
                )}
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" />
            </button>
          </div>
        </div>

        {/* Mobile section selector sheet */}
        <MobileBottomSheet
          open={showMobileSelector}
          onOpenChange={setShowMobileSelector}
          title="Szekciók"
          type="action"
        >
          <div className="space-y-1">
            {sections.map((section, index) => {
              const errorCount = sectionErrors[section.id] || 0;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => handleSectionSelect(section.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors mobile-touch-target ${
                    section.id === activeSectionId
                      ? 'bg-medical-primary/10 text-medical-primary'
                      : 'hover:bg-gray-50 text-gray-900'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {section.icon && (
                      <div className="flex-shrink-0 text-medical-primary">
                        {section.icon}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {section.label}
                      </div>
                      <div className="text-xs text-gray-500">
                        {index + 1} / {totalSections}
                      </div>
                    </div>
                  </div>
                  {errorCount > 0 && (
                    <span className="flex-shrink-0 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full ml-2">
                      {errorCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </MobileBottomSheet>
      </>
    );
  }

  // Desktop: Stepper
  return (
    <div className="mb-6">
      {/* Progress indicator */}
      {activeSection && (
        <div className="text-sm text-gray-600 mb-4">
          {activeSection.label} / {currentSectionNumber} / {totalSections}
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {sections.map((section, index) => {
          const errorCount = sectionErrors[section.id] || 0;
          const isActive = section.id === activeSectionId;
          const isCompleted = activeIndex > index;
          const isClickable = true;

          return (
            <div key={section.id} className="flex items-center flex-shrink-0">
              <button
                type="button"
                onClick={() => handleSectionSelect(section.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-medical-primary text-white'
                    : isCompleted
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {section.icon && (
                  <div className="flex-shrink-0">
                    {section.icon}
                  </div>
                )}
                <span className="text-sm font-medium whitespace-nowrap">
                  {section.label}
                </span>
                {errorCount > 0 && (
                  <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-red-500 text-white'
                  }`}>
                    {errorCount}
                  </span>
                )}
              </button>
              {index < sections.length - 1 && (
                <div className={`w-8 h-0.5 mx-1 ${
                  isCompleted ? 'bg-green-500' : 'bg-gray-300'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
