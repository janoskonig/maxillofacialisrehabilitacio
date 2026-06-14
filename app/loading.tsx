import { PageListSkeleton } from '@/components/skeletons/Skeletons';

// Univerzális route-fallback (páciens-lista + minden saját loading.tsx nélküli staff útvonal).
export default function Loading() {
  return <PageListSkeleton />;
}
