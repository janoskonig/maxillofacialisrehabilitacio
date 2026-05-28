'use client';

import type { MessageContextLink } from '@/lib/types/messaging';
import { MessageContextCard } from './MessageContextCard';

interface Props {
  links: MessageContextLink[];
  variant?: 'bubble-own' | 'bubble-other';
  onRemoveLink?: (linkId: string) => void;
  canRemove?: boolean;
}

export function MessageContextLinksStrip({
  links,
  variant = 'bubble-other',
  onRemoveLink,
  canRemove = false,
}: Props) {
  if (!links.length) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5 w-full min-w-0">
      {links.map((link) => (
        <MessageContextCard
          key={link.id}
          link={link}
          variant={variant}
          onRemove={onRemoveLink}
          canRemove={canRemove}
        />
      ))}
    </div>
  );
}
