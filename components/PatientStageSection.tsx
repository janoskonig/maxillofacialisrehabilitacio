'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { PatientStageEntry, StageEventEntry, StageCatalogEntry } from '@/lib/types';
import { patientStageOptions } from '@/lib/types';
import { Calendar, ArrowRight, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

interface PatientStageSectionProps {
  patientId: string;
  patientName?: string | null;
}

function isStageEventEntry(s: unknown): s is StageEventEntry {
  return typeof s === 'object' && s != null && 'stageCode' in s;
}

function isLegacyStage(s: unknown): s is PatientStageEntry {
  return typeof s === 'object' && s != null && 'stage' in s;
}

export function PatientStageSection({
  patientId,
  patientName,
}: PatientStageSectionProps) {
  const router = useRouter();
  const [currentStage, setCurrentStage] = useState<PatientStageEntry | StageEventEntry | null>(null);
  const [catalog, setCatalog] = useState<StageCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCurrentStage = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/patients/${patientId}/stages`, {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Hiba a stádium betöltésekor');
        }

        const data = await response.json();
        const stage = data.timeline?.currentStage || null;
        setCurrentStage(stage);

        // Fetch catalog for new model stage labels (stageCode -> labelHu)
        if (data.useNewModel && stage && isStageEventEntry(stage)) {
          const reason = data.timeline?.episodes?.[0]?.episode?.reason;
          const catUrl = reason
            ? `/api/stage-catalog?reason=${encodeURIComponent(reason)}`
            : '/api/stage-catalog';
          try {
            const catRes = await fetch(catUrl, { credentials: 'include' });
            if (catRes.ok) {
              const catData = await catRes.json();
              setCatalog(catData.catalog ?? []);
            }
          } catch {
            // Non-blocking
          }
        }
      } catch (error) {
        console.error('Error fetching current stage:', error);
      } finally {
        setLoading(false);
      }
    };

    if (patientId) {
      fetchCurrentStage();
    }
  }, [patientId]);

  const getStageLabel = (stageOrCode: string) => {
    const fromCatalog = catalog.find((c) => c.code === stageOrCode)?.labelHu;
    if (fromCatalog) return fromCatalog;
    return patientStageOptions.find((opt) => opt.value === stageOrCode)?.label || stageOrCode;
  };

  const getStageColor = (stageOrCode: string) => {
    const legacyColors: Record<string, string> = {
      uj_beteg: 'bg-blue-100 text-blue-800',
      onkologiai_kezeles_kesz: 'bg-purple-100 text-purple-800',
      arajanlatra_var: 'bg-yellow-100 text-yellow-800',
      implantacios_sebeszi_tervezesre_var: 'bg-orange-100 text-orange-800',
      fogpotlasra_var: 'bg-amber-100 text-amber-800',
      fogpotlas_keszul: 'bg-indigo-100 text-indigo-800',
      fogpotlas_kesz: 'bg-green-100 text-green-800',
      gondozas_alatt: 'bg-gray-100 text-gray-800',
    };
    if (legacyColors[stageOrCode]) return legacyColors[stageOrCode];
    const stageNum = stageOrCode.replace('STAGE_', '');
    const palette = ['bg-blue-100 text-blue-800', 'bg-purple-100 text-purple-800', 'bg-yellow-100 text-yellow-800', 'bg-orange-100 text-orange-800', 'bg-amber-100 text-amber-800', 'bg-indigo-100 text-indigo-800', 'bg-green-100 text-green-800', 'bg-gray-100 text-gray-800'];
    return palette[parseInt(stageNum, 10) % palette.length] || 'bg-gray-100 text-gray-800';
  };

  const stageKey = currentStage && (isStageEventEntry(currentStage) ? currentStage.stageCode : isLegacyStage(currentStage) ? currentStage.stage : null);
  const stageDate = currentStage && (isStageEventEntry(currentStage) ? currentStage.at : isLegacyStage(currentStage) ? currentStage.stageDate : null);
  const stageNote = currentStage && (isStageEventEntry(currentStage) ? currentStage.note : isLegacyStage(currentStage) ? currentStage.notes : null);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-medical-primary" />
          Betegstádium
        </h3>
        <button
          onClick={() => router.push(`/patients/${patientId}/stages`)}
          className="text-sm text-medical-primary hover:text-medical-primary-dark flex items-center gap-1"
        >
          Részletek
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {currentStage && stageKey ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${getStageColor(stageKey)}`}
            >
              {getStageLabel(stageKey)}
            </span>
            {stageDate && (
              <span className="text-sm text-gray-600 flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {format(new Date(stageDate), 'yyyy. MMMM d.', { locale: hu })}
              </span>
            )}
          </div>
          {stageNote && (
            <p className="text-sm text-gray-700">{stageNote}</p>
          )}
        </div>
      ) : (
        <div className="text-center py-4">
          <p className="text-gray-500 text-sm">Még nincs stádium beállítva.</p>
          <button
            onClick={() => router.push(`/patients/${patientId}/stages`)}
            className="mt-2 text-sm text-medical-primary hover:text-medical-primary-dark"
          >
            Stádium beállítása
          </button>
        </div>
      )}
    </div>
  );
}
