'use client';

import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { MessageCircle, Users } from 'lucide-react';
import type { MessageSearchHit } from '@/lib/types/messaging';
import { SearchSnippet } from './SearchSnippet';

interface Props {
  hit: MessageSearchHit;
  onSelect: (hit: MessageSearchHit) => void;
}

export function SearchResultRow({ hit, onSelect }: Props) {
  const title =
    hit.channel === 'patient'
      ? hit.patientName || 'Beteg szál'
      : hit.groupId
        ? 'Csoport'
        : hit.senderName || hit.senderEmail || 'Orvos';

  const subtitle =
    hit.channel === 'patient'
      ? hit.senderType === 'doctor'
        ? hit.senderEmail || 'Orvos'
        : 'Beteg'
      : hit.senderName || hit.senderEmail || '';

  const when = format(new Date(hit.createdAt), 'yyyy. MM. dd. HH:mm', { locale: hu });

  return (
    <button
      type="button"
      onClick={() => onSelect(hit)}
      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition-colors focus:outline-none focus:bg-blue-50"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
          {hit.groupId ? (
            <Users className="w-4 h-4" />
          ) : (
            <MessageCircle className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{title}</span>
            <span className="text-xs text-gray-400 flex-shrink-0">{when}</span>
          </div>
          {subtitle && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</p>
          )}
          <div className="mt-1">
            <SearchSnippet html={hit.snippet} />
          </div>
        </div>
      </div>
    </button>
  );
}
