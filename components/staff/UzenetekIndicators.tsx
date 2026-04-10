'use client';

type UzenetekIndicatorsProps = {
  patientUnread: number;
  doctorUnread: number;
  variant?: 'corner' | 'inline';
};

function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/**
 * Staff üzenetek: piros = olvasatlan betegüzenet (badge: beteg + kolléga összesen);
 * borostyán = csak kollégai olvasatlan.
 */
export function UzenetekIndicators({ patientUnread, doctorUnread, variant = 'corner' }: UzenetekIndicatorsProps) {
  const isInline = variant === 'inline';
  const baseCorner =
    'pointer-events-none absolute -top-1.5 -right-1.5 min-w-[1.125rem] h-5 px-1 flex items-center justify-center rounded-full text-[10px] font-bold shadow-sm';
  const baseInline =
    'ml-auto shrink-0 min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold';

  if (patientUnread > 0) {
    const total = patientUnread + doctorUnread;
    const count = formatCount(total);
    return (
      <span
        className={isInline ? `${baseInline} bg-red-500 text-white` : `${baseCorner} bg-red-500 text-white`}
        aria-hidden
      >
        {count}
      </span>
    );
  }

  if (doctorUnread > 0) {
    const count = formatCount(doctorUnread);
    return (
      <span
        className={
          isInline
            ? `${baseInline} bg-amber-100 text-amber-900 font-semibold border border-amber-300`
            : `${baseCorner} bg-amber-100 text-amber-900 font-semibold border border-amber-300`
        }
        aria-hidden
      >
        {count}
      </span>
    );
  }

  return null;
}

export function uzenetekAriaLabel(patientUnread: number, doctorUnread: number): string {
  if (patientUnread > 0 && doctorUnread > 0) {
    return `Üzenetek, ${patientUnread} olvasatlan betegüzenet és ${doctorUnread} olvasatlan kollégai üzenet`;
  }
  if (patientUnread > 0) {
    return `Üzenetek, ${patientUnread} olvasatlan betegüzenet`;
  }
  if (doctorUnread > 0) {
    return `Üzenetek, ${doctorUnread} olvasatlan kollégai üzenet`;
  }
  return 'Üzenetek';
}
