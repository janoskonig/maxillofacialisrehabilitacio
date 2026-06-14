import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** hover árnyék (card-hover), pl. listaelemekhez. */
  hover?: boolean;
  /** kattintható érzet (card-interactive). */
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}

/** A globals.css .card osztály React-wrapperje. Vizuálisan változatlan. */
export function Card({ hover = false, interactive = false, className = '', children, ...rest }: CardProps) {
  const classes = ['card', hover ? 'card-hover' : '', interactive ? 'card-interactive' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
