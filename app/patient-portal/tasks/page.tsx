'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PortalLayout } from '@/components/patient-portal/PortalLayout';
import { ClipboardList, Loader2, ChevronRight, Stethoscope } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { hu } from 'date-fns/locale';

type PortalTaskItem = {
  kind: string;
  id: string;
  taskType?: string;
  title: string;
  description?: string | null;
  href: string;
  createdAt?: string;
};

type PortalTreatmentPlanItem = {
  label: string;
  tervezettAtadasDatuma: string | null;
  elkeszult: boolean;
  detail?: string | null;
};

type PortalTreatmentPlan = {
  felso: PortalTreatmentPlanItem[];
  also: PortalTreatmentPlanItem[];
  arcotErinto: PortalTreatmentPlanItem[];
};

function formatPlanDate(isoOrDate: string | null): string | null {
  if (!isoOrDate) return null;
  const d = parseISO(isoOrDate.length > 10 ? isoOrDate : `${isoOrDate}T12:00:00`);
  if (!isValid(d)) return null;
  return format(d, 'yyyy. MMM d.', { locale: hu });
}

function TreatmentPlanBlock({
  title,
  rows,
}: {
  title: string;
  rows: PortalTreatmentPlanItem[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      <ul className="space-y-2">
        {rows.map((row, idx) => (
          <li
            key={`${title}-${idx}`}
            className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="font-medium text-gray-900">{row.label}</span>
              <span
                className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                  row.elkeszult ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                }`}
              >
                {row.elkeszult ? 'Elkészült' : 'Tervezett'}
              </span>
            </div>
            {row.detail ? <p className="text-xs text-gray-600 mt-1">{row.detail}</p> : null}
            {formatPlanDate(row.tervezettAtadasDatuma) ? (
              <p className="text-xs text-gray-500 mt-1">
                Tervezett átadás: {formatPlanDate(row.tervezettAtadasDatuma)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PatientPortalTasksPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PortalTaskItem[]>([]);
  const [treatmentPlan, setTreatmentPlan] = useState<PortalTreatmentPlan | null>(null);
  const [treatmentPlanHasRows, setTreatmentPlanHasRows] = useState(false);

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
        if (data.treatmentPlan && typeof data.treatmentPlan === 'object') {
          setTreatmentPlan(data.treatmentPlan as PortalTreatmentPlan);
        } else {
          setTreatmentPlan(null);
        }
        setTreatmentPlanHasRows(Boolean(data.treatmentPlanHasRows));
      } catch {
        setItems([]);
        setTreatmentPlan(null);
        setTreatmentPlanHasRows(false);
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
          Dokumentumkérések, kezelési terv és egyéb teendők egy helyen.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
            Betöltés...
          </div>
        ) : (
          <div className="space-y-6">
            <section className="card p-4 sm:p-5" aria-labelledby="portal-treatment-plan-heading">
              <div className="flex items-start gap-3">
                <Stethoscope className="w-5 h-5 text-medical-primary flex-shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h2 id="portal-treatment-plan-heading" className="text-base font-semibold text-gray-900">
                    Kezelési tervem
                  </h2>
                  {!treatmentPlanHasRows ? (
                    <p className="text-sm text-gray-600 mt-2">
                      A kezelőcsapat által rögzített kezelési terv tételei itt jelennek meg. Jelenleg nincs
                      megjeleníthető tétel.
                    </p>
                  ) : (
                    <>
                      <TreatmentPlanBlock title="Felső állcsont" rows={treatmentPlan?.felso ?? []} />
                      <TreatmentPlanBlock title="Alsó állcsont" rows={treatmentPlan?.also ?? []} />
                      <TreatmentPlanBlock title="Arcot érintő ellátás" rows={treatmentPlan?.arcotErinto ?? []} />
                    </>
                  )}
                </div>
              </div>
            </section>

            {items.length === 0 ? (
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
        )}
      </div>
    </PortalLayout>
  );
}
