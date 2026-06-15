'use client';

/**
 * ConversationListItem — egyetlen beszélgetés-sor a listában (csatorna-független).
 *
 * Egy `ConversationVM` nézetmodellt renderel: avatar (+ jelenlét), név,
 * al-címke / utolsó üzenet előnézet (olvasás-pipákkal), relatív időbélyeg és
 * olvasatlan-pötty. A doctor / group / patient sorok mind ezen mennek át.
 */

import { format, isToday, isYesterday } from 'date-fns';
import { hu } from 'date-fns/locale';
import { CheckCheck } from 'lucide-react';
import { Avatar, type PresenceState } from './Avatar';

export interface ConversationVM {
  /** Egyedi kulcs (doctorId / groupId / patientId-lane). */
  id: string;
  title: string;
  /** Másodlagos sor: szerep (pl. „Fogpótlástanász”) vagy intézmény. */
  subtitle?: string | null;
  /** Utolsó üzenet előnézet. */
  preview?: string | null;
  /** Előtag az előnézet előtt, pl. csoportban a feladó neve: „Nagy A.:”. */
  previewPrefix?: string | null;
  timestamp?: Date | string | null;
  unreadCount?: number;
  avatar: {
    name?: string | null;
    seed?: string;
    group?: boolean;
    imageUrl?: string | null;
    presence?: PresenceState;
  };
  /** Igaz, ha az utolsó üzenetet én küldtem → olvasás-pipa az előnézetben. */
  ownLastMessage?: boolean;
  /** Igaz, ha a saját utolsó üzenetemet már olvasták. */
  lastMessageRead?: boolean;
}

function timeLabel(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isToday(d)) return format(d, 'HH:mm', { locale: hu });
  if (isYesterday(d)) return 'Tegnap';
  return format(d, 'MMM d.', { locale: hu });
}

interface Props {
  vm: ConversationVM;
  active: boolean;
  onSelect: (id: string) => void;
}

export function ConversationListItem({ vm, active, onSelect }: Props) {
  const hasUnread = (vm.unreadCount ?? 0) > 0;

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => onSelect(vm.id)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-medical-primary ${
        active
          ? 'bg-medical-primary/10 dark:bg-medical-primary/20 border-l-2 border-medical-primary'
          : 'border-l-2 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60'
      }`}
    >
      <Avatar
        name={vm.avatar.name}
        seed={vm.avatar.seed}
        group={vm.avatar.group}
        imageUrl={vm.avatar.imageUrl}
        presence={vm.avatar.presence}
        sizeClass="h-10 w-10"
        textClass="text-sm"
        ringClass={active ? 'ring-medical-primary/10 dark:ring-gray-900' : 'ring-white dark:ring-gray-900'}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{vm.title}</span>
          {vm.timestamp && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0">{timeLabel(vm.timestamp)}</span>
          )}
        </div>
        {vm.subtitle && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{vm.subtitle}</div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-xs truncate flex items-center gap-1 ${
              hasUnread ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {vm.ownLastMessage && (
              <CheckCheck
                className={`w-3.5 h-3.5 flex-shrink-0 ${vm.lastMessageRead ? 'text-medical-primary' : 'opacity-60'}`}
                aria-hidden="true"
              />
            )}
            {vm.previewPrefix && <span className="flex-shrink-0">{vm.previewPrefix}</span>}
            <span className="truncate">{vm.preview ?? ''}</span>
          </span>
          {hasUnread && (
            <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
              {vm.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
