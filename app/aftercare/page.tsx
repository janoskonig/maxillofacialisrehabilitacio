'use client';

import { AppShell } from '@/components/layout/AppShell';
import { SchedulingQueue } from '@/components/aftercare/SchedulingQueue';

export default function AftercareQueuePage() {
  return <AppShell title="Visszarendelések" maxWidth="lg"><SchedulingQueue /></AppShell>;
}
