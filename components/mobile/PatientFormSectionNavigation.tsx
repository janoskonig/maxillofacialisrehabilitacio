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
  /**
   * Megjelenési mód:
   * - 'bar'  (alapértelmezett): felső vízszintes „tartalomjegyzék” + mobilon lenyíló választó.
   * - 'rail': függőleges oldalsáv (xl+ képernyőn a form mellett).
   * A reszponzív megjelenítést a szülő `className`-je vezérli (pl. `hidden xl:block` / `xl:hidden`).
   */
  variant?: 'bar' | 'rail';
  className?: string;
}

/**
 * PatientFormSectionNavigation - a betegűrlap szakaszainak tartalomjegyzéke.
 * Nem varázsló: nincs „kész” lépcső / X-ből-Y számláló — csak az aktuális szakasz
 * van kiemelve (görgetés-követéssel), hibajelvénnyel, és egy kattintással bárhova ugorhat.
 * - Mobil: sticky felső választó (lenyíló lap)
 * - Tablet / kisebb desktop: vízszintes pill-sor
 * - xl+: függőleges oldalsáv ('rail' variáns)
 */
export function PatientFormSectionNavigation({
  sections,
  activeSectionId,
  onSectionChange,
  sectionErrors = {},
  variant = 'bar',
  className,
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
          const headerOffset = breakpoint === 'mobile' ? 80 : 100;
          const elementPosition = retryElement.getBoundingClientRect().top;
          const offsetPosition = elementPosition + (window.scrollY || window.pageYOffset) - headerOffset;
          window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
        }
      }, 200);
      return;
    }

    const headerOffset = breakpoint === 'mobile' ? 80 : 100; // Account for sticky header
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + (window.scrollY || window.pageYOffset) - headerOffset;

    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
  };

  // Cleanup scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  if (sections.length === 0) {
    return null;
  }

  const handleSectionSelect = (sectionId: string) => {
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

  // Kis piros hibaszámláló jelvény
  const errorBadge = (count: number, onColored = false) =>
    count > 0 ? (
      <span
        className={`flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[11px] font-semibold leading-none ${
          onColored ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
        }`}
      >
        {count}
      </span>
    ) : null;

  // ── xl+ : függőleges oldalsáv ──────────────────────────────────────────────
  if (variant === 'rail') {
    return (
      <nav aria-label="Szakaszok" className={className}>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2">
          <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Tartalom
          </div>
          <ul className="space-y-0.5">
            {sections.map((section) => {
              const isActive = section.id === activeSectionId;
              const errorCount = sectionErrors[section.id] || 0;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => handleSectionSelect(section.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`group flex w-full items-stretch gap-2.5 rounded-lg py-2 pl-2 pr-2.5 text-left text-sm transition-colors ${
                      isActive
                        ? 'bg-medical-primary/10 text-medical-primary font-semibold'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    <span
                      className={`w-0.5 self-stretch rounded-full ${isActive ? 'bg-medical-primary' : 'bg-transparent'}`}
                      aria-hidden
                    />
                    {section.icon && (
                      <span
                        className={`flex-shrink-0 ${
                          isActive ? 'text-medical-primary' : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {section.icon}
                      </span>
                    )}
                    <span className="flex-1 min-w-0 truncate">{section.label}</span>
                    {errorBadge(errorCount)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    );
  }

  // ── Mobil: sticky választó + lenyíló lap ───────────────────────────────────
  if (isMobile) {
    return (
      <>
        <div className={`mobile-header sticky top-16 z-30 bg-white dark:bg-gray-900 border-b sm:top-[4.5rem] ${className ?? ''}`}>
          <div className="px-4 py-3">
            {activeSection && (
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 font-medium">
                {activeSection.label}
                <span className="text-gray-400 dark:text-gray-500"> · {currentSectionNumber}/{totalSections}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowMobileSelector(true)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors mobile-touch-target"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {activeSection?.icon && (
                  <div className="flex-shrink-0 text-medical-primary">{activeSection.icon}</div>
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {activeSection?.label || 'Válasszon szakaszt'}
                </span>
                {activeSection && errorBadge(sectionErrors[activeSection.id] || 0)}
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 ml-2" />
            </button>
          </div>
        </div>

        <MobileBottomSheet
          open={showMobileSelector}
          onOpenChange={setShowMobileSelector}
          title="Szakaszok"
          type="action"
        >
          <div className="space-y-1">
            {sections.map((section) => {
              const errorCount = sectionErrors[section.id] || 0;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => handleSectionSelect(section.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors mobile-touch-target ${
                    section.id === activeSectionId
                      ? 'bg-medical-primary/10 text-medical-primary'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {section.icon && (
                      <div className="flex-shrink-0 text-medical-primary">{section.icon}</div>
                    )}
                    <span className="text-sm font-medium truncate">{section.label}</span>
                  </div>
                  {errorBadge(errorCount)}
                </button>
              );
            })}
          </div>
        </MobileBottomSheet>
      </>
    );
  }

  // ── Tablet / kisebb desktop: nyugodt vízszintes tartalomjegyzék ────────────
  return (
    <div
      className={`mb-6 sticky top-16 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur pt-3 pb-2 border-b border-gray-200 dark:border-gray-800 -mx-3 sm:-mx-6 px-3 sm:px-6 sm:top-[4.5rem] md:top-[4.75rem] lg:top-20 ${className ?? ''}`}
    >
      <div
        className="flex items-center gap-1 overflow-x-auto overscroll-x-contain pb-1 scroll-smooth [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700"
        aria-label="Szakaszok"
      >
        {sections.map((section) => {
          const isActive = section.id === activeSectionId;
          const errorCount = sectionErrors[section.id] || 0;
          return (
            <button
              key={section.id}
              type="button"
              data-section-step={section.id}
              onClick={() => handleSectionSelect(section.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-medical-primary text-white font-semibold shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {section.icon && (
                <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">{section.icon}</span>
              )}
              {section.label}
              {errorBadge(errorCount, isActive)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
