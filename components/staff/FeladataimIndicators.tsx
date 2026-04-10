'use client';

type FeladataimIndicatorsProps = {
  unviewed: number;
  viewedOpen: number;
  /** 'corner' for icon buttons; 'inline' for list rows (badge after label). */
  variant?: 'corner' | 'inline';
};

/**
 * Staff Feladataim affordance: strong (red count) for unseen tasks,
 * softer (amber count) for seen-but-still-open tasks.
 */
export function FeladataimIndicators({ unviewed, viewedOpen, variant = 'corner' }: FeladataimIndicatorsProps) {
  const isInline = variant === 'inline';

  if (unviewed > 0) {
    const count = unviewed > 99 ? '99+' : String(unviewed);
    return (
      <span
        className={
          isInline
            ? 'ml-auto shrink-0 min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold'
            : 'pointer-events-none absolute -top-1.5 -right-1.5 min-w-[1.125rem] h-5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shadow-sm'
        }
        aria-hidden
      >
        {count}
      </span>
    );
  }

  if (viewedOpen > 0) {
    const count = viewedOpen > 99 ? '99+' : String(viewedOpen);
    return (
      <span
        className={
          isInline
            ? 'ml-auto shrink-0 min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-900 text-[10px] font-semibold border border-amber-300'
            : 'pointer-events-none absolute -top-1.5 -right-1.5 min-w-[1.125rem] h-5 px-1 flex items-center justify-center rounded-full bg-amber-100 text-amber-900 text-[10px] font-semibold border border-amber-300'
        }
        aria-hidden
      >
        {count}
      </span>
    );
  }

  return null;
}

export function feladataimTasksAriaLabel(unviewed: number, viewedOpen: number): string {
  if (unviewed > 0) {
    return `Feladataim, ${unviewed} új vagy még nem megtekintett`;
  }
  if (viewedOpen > 0) {
    return `Feladataim, ${viewedOpen} megtekintett, még nyitott feladat`;
  }
  return 'Feladataim';
}
