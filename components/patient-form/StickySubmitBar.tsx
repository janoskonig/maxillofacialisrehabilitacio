'use client';

import { Patient } from '@/lib/types';
import { Section } from '../mobile/PatientFormSectionNavigation';

interface StickySubmitBarProps {
  patient: Patient | null | undefined;
  breakpoint: string;
  visibleSections: Section[];
  activeSectionId: string | null;
  setActiveSectionId: (id: string) => void;
  handleCancel: () => void;
}

export function StickySubmitBar({
  patient,
  breakpoint,
  visibleSections,
  activeSectionId,
  setActiveSectionId,
  handleCancel,
}: StickySubmitBarProps) {
  return (
    <div className="mobile-cta-bar absolute bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 px-3 sm:px-6 md:px-8">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between gap-2 sm:gap-3 py-3 sm:py-4">
        {/* Left: Next section button (mobile only if not last section) */}
        {breakpoint === 'mobile' && (() => {
          const currentActiveIndex = visibleSections.findIndex(s => s.id === activeSectionId);
          return currentActiveIndex >= 0 && currentActiveIndex < visibleSections.length - 1;
        })() && (
          <button
            type="button"
            onClick={() => {
              const currentActiveIndex = visibleSections.findIndex(s => s.id === activeSectionId);
              const nextSection = visibleSections[currentActiveIndex + 1];
              if (nextSection) {
                setActiveSectionId(nextSection.id);
                setTimeout(() => {
                  const element = document.getElementById(`section-${nextSection.id}`);
                  if (element) {
                    const headerOffset = 100;
                    const elementPosition = element.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + (window.scrollY || window.pageYOffset) - headerOffset;
                    window.scrollTo({
                      top: offsetPosition,
                      behavior: 'smooth',
                    });
                  }
                }, 100);
              }
            }}
            className="btn-secondary text-xs sm:text-sm px-3 sm:px-5 py-2 sm:py-2.5 mobile-touch-target w-full sm:w-auto order-2 sm:order-1"
          >
            Következő szekció →
          </button>
        )}
        
        {/* Right: Cancel and Save buttons */}
        <div className="flex gap-2 sm:gap-3 w-full sm:w-auto order-1 sm:order-2 ml-auto">
          <button
            type="button"
            onClick={handleCancel}
            className="btn-secondary text-xs sm:text-sm px-3 sm:px-5 py-2 sm:py-2.5 mobile-touch-target flex-1 sm:flex-none"
            data-patient-form-cancel
          >
            Mégse
          </button>
          <button
            type="submit"
            form="patient-form"
            className="btn-primary text-xs sm:text-sm px-3 sm:px-5 py-2 sm:py-2.5 mobile-touch-target flex-1 sm:flex-none"
          >
            {patient ? 'Beteg frissítése' : 'Beteg mentése'}
          </button>
        </div>
      </div>
    </div>
  );
}
