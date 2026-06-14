import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';

interface PageHeaderProps {
  title: string;
  /** Ha meg van adva, „vissza" gomb jelenik meg erre az útvonalra. */
  backTo?: string;
  /** Jobbra igazított műveleti slot (a korábbi inline linkek/gombok helye). */
  actions?: ReactNode;
}

/**
 * Egységes oldal-fejléc, ami kiváltja a ~30 oldalon kézzel duplikált
 * header markupot (Logo + vissza + cím + inline link). A Logo csak mobilon
 * látszik — desktopon a Sidebar hordozza a brandet.
 */
export function PageHeader({ title, backTo, actions }: PageHeaderProps) {
  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-30 max-md:mobile-safe-top">
      <div className="px-4 py-3 flex items-center gap-3">
        {backTo && (
          <Link href={backTo} className="btn-secondary p-2" aria-label="Vissza">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <Logo width={32} height={37} className="md:hidden" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {/* Mobilon nincs oldalsáv, így a téma-váltó a fejlécben érhető el. */}
          <span className="md:hidden">
            <ThemeToggle variant="icon" />
          </span>
          {actions}
        </div>
      </div>
    </header>
  );
}
