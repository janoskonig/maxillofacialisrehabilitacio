'use client';

import Link from 'next/link';
import {
  Calendar,
  FileText,
  Image as ImageIcon,
  Stethoscope,
  User,
  Users,
  CheckSquare,
  Layers,
  ExternalLink,
} from 'lucide-react';
import type { MessageContextEntityType, MessageContextLink } from '@/lib/types/messaging';

const ENTITY_LABELS: Record<MessageContextEntityType, string> = {
  patient: 'Beteg',
  episode: 'Epizód',
  work_phase: 'Munkafázis',
  appointment: 'Időpont',
  document: 'Dokumentum',
  consilium_session: 'Konzílium',
  task: 'Feladat',
};

function entityIcon(type: MessageContextEntityType) {
  switch (type) {
    case 'patient':
      return User;
    case 'document':
      return FileText;
    case 'appointment':
      return Calendar;
    case 'episode':
      return Layers;
    case 'work_phase':
      return Stethoscope;
    case 'consilium_session':
      return Users;
    case 'task':
      return CheckSquare;
    default:
      return FileText;
  }
}

interface Props {
  link: MessageContextLink;
  variant?: 'bubble-own' | 'bubble-other';
  onRemove?: (linkId: string) => void;
  canRemove?: boolean;
}

export function MessageContextCard({
  link,
  variant = 'bubble-other',
  onRemove,
  canRemove = false,
}: Props) {
  const Icon = entityIcon(link.entityType);
  const label = link.preview?.label ?? ENTITY_LABELS[link.entityType];
  const subtitle = link.preview?.subtitle;
  const href = link.preview?.href;
  const opensInNewTab = link.entityType === 'document' && !!href;

  const isOwn = variant === 'bubble-own';
  const boxClass = isOwn
    ? 'bg-blue-500/30 border-blue-400/50 text-white'
    : 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100';
  const metaClass = isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400';
  const typeClass = isOwn ? 'text-blue-200' : 'text-blue-600 dark:text-blue-300';

  const inner = (
    <div
      className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left w-full min-w-0 ${boxClass}`}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${typeClass}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${typeClass}`}>
          {ENTITY_LABELS[link.entityType]}
        </div>
        <div className="text-sm font-medium truncate">{label}</div>
        {subtitle ? <div className={`text-xs truncate ${metaClass}`}>{subtitle}</div> : null}
      </div>
      {href ? (
        <ExternalLink className={`w-3.5 h-3.5 flex-shrink-0 mt-1 ${metaClass}`} aria-hidden />
      ) : null}
    </div>
  );

  return (
    <div className="relative group/link w-full max-w-full">
      {href ? (
        <Link
          href={href}
          className="block hover:opacity-90 transition-opacity"
          target={opensInNewTab ? '_blank' : undefined}
          rel={opensInNewTab ? 'noopener noreferrer' : undefined}
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
      {canRemove && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(link.id);
          }}
          className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs font-bold shadow ${
            isOwn ? 'bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-300' : 'bg-gray-700 text-white'
          } opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100`}
          aria-label="Link eltávolítása"
          title="Link eltávolítása"
        >
          ×
        </button>
      )}
    </div>
  );
}
