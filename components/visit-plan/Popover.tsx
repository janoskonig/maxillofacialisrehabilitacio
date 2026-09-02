'use client';

/**
 * Minimális, függőség nélküli popover: gomb + lebegő panel. Kívülre
 * kattintás és Escape zár. Nem portálozik — a hívó adja a pozicionáló
 * (relative) wrappert, így a DnD-vel sem ütközik.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';

export interface PopoverProps {
  /** A nyitó gomb tartalma. */
  trigger: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  triggerAriaLabel?: string;
  disabled?: boolean;
  /** A panel igazítása a gombhoz. */
  align?: 'left' | 'right';
  widthClass?: string;
  /** Render-prop: a close-t a menüpontok hívják. */
  children: (close: () => void) => ReactNode;
  /** Vezérelt nyitás (opcionális). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra attribútumok a nyitó gombra (pl. dnd-kit listeners/attributes). */
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>;
  triggerRef?: Ref<HTMLButtonElement>;
}

export function Popover({
  trigger, triggerClassName, triggerTitle, triggerAriaLabel, disabled,
  align = 'right', widthClass = 'w-64', children, open: controlledOpen, onOpenChange,
  triggerProps, triggerRef,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    setUncontrolledOpen(v);
    onOpenChange?.(v);
  };
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        {...triggerProps}
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        title={triggerTitle}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-30 mt-1 ${widthClass} max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-1 text-left`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick, children, tone = 'default', disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40'
      : tone === 'primary'
        ? 'text-medical-primary font-medium hover:bg-medical-primary/10'
        : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800';
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pt-1.5 pb-0.5 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
      {children}
    </p>
  );
}
