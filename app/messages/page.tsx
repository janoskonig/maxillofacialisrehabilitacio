import { Suspense } from 'react';
import MessagesPageClient from './MessagesPageClient';
import { MessagesSkeleton } from '@/components/skeletons/Skeletons';

export default function MessagesPage() {
  return (
    <Suspense fallback={<MessagesSkeleton />}>
      <MessagesPageClient />
    </Suspense>
  );
}
