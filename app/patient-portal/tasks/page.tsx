'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PortalLayout } from '@/components/patient-portal/PortalLayout';
import { ClipboardList, Loader2, ChevronRight } from 'lucide-react';

type PortalTaskItem = {
  kind: string;
  id: string;
  taskType?: string;
  title: string;
  description?: string | null;
  href: string;
  createdAt?: string;
};

export default function PatientPortalTasksPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PortalTaskItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/patient-portal/tasks', { credentials: 'include' });
        if (res.status === 401) {
          router.push('/patient-portal');
          return;
        }
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        setItems(data.items || []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Feladataim</h1>
        <p className="text-sm text-gray-600 mb-6">
          Dokumentumkérések és egyéb teendők egy helyen.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
            Betöltés...
          </div>
        ) : items.length === 0 ? (
          <div className="card p-8 text-center text-gray-600">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            Jelenleg nincs nyitott feladat.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="card p-4 flex items-center gap-3 hover:border-medical-primary/40 transition-colors"
                >
                  <ClipboardList className="w-5 h-5 text-medical-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-medium text-gray-900">{item.title}</p>
                    {item.description && (
                      <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">{item.description}</p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalLayout>
  );
}
