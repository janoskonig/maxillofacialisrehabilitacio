'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  success: 'btn-success',
};

// A btn-* osztályok alapból px-5 py-2.5; a 'sm' csak a méretet csökkenti.
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: '',
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };

type ButtonAsLink = CommonProps & {
  href: string;
  'aria-label'?: string;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function buildClass(variant: ButtonVariant, size: ButtonSize, className: string) {
  return `${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`.replace(/\s+/g, ' ').trim();
}

/**
 * Egységes gomb a globals.css .btn-* osztályok fölött. Vizuálisan azonos a
 * meglévő gombokkal — csak centralizálja a variánsokat. href esetén Next Link.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { variant = 'primary', size = 'md', className = '', children } = props;
  const classes = buildClass(variant, size, className);

  if ('href' in props && props.href !== undefined) {
    const { href, ...rest } = props as ButtonAsLink;
    return (
      <Link href={href} className={classes} aria-label={rest['aria-label']}>
        {children}
      </Link>
    );
  }

  const { variant: _v, size: _s, className: _c, children: _ch, href: _h, ...buttonProps } = props as ButtonAsButton;
  return (
    <button ref={ref} className={classes} {...buttonProps}>
      {children}
    </button>
  );
});
