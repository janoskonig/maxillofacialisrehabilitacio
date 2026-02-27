'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { OHIP14Response, OHIP14Timepoint, ohip14TimepointOptions, ohip14ResponseValueOptions } from '@/lib/types';
import { ohip14Questions, calculateOHIP14Scores } from '@/lib/ohip14-questions';
import { getTimepointAvailability, type TimepointAvailability } from '@/lib/ohip14-timepoint-stage';
import { useToast } from '@/contexts/ToastContext';
import { FileText, Save, Loader2, CheckCircle, AlertCircle, Lock, CalendarClock } from 'lucide-react';

interface OHIP14SectionProps {
  patientId: string;
  isViewOnly?: boolean;
  isPatientPortal?: boolean;
}

export function OHIP14Section({
  patientId,
  isViewOnly = false,
  isPatientPortal = false,
}: OHIP14SectionProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [responses, setResponses] = useState<Record<OHIP14Timepoint, OHIP14Response | null>>({
    T0: null,
    T1: null,
    T2: null,
    T3: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<OHIP14Timepoint | null>(null);
  const [activeTimepoint, setActiveTimepoint] = useState<OHIP14Timepoint | null>(null);
  const [currentStageCode, setCurrentStageCode] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState<Date | null>(null);
  const [completedTimepoints, setCompletedTimepoints] = useState<OHIP14Timepoint[]>([]);

  useEffect(() => {
    fetchCurrentStage();
    fetchResponses();
  }, [patientId]);

  // Auto-select first available timepoint for patient portal
  useEffect(() => {
    if (!isPatientPortal) return;
    const firstAvailable = ohip14TimepointOptions.find((tp) => {
      const avail = getTimepointAvailability(tp.value, currentStageCode, deliveryDate);
      return avail.allowed && !completedTimepoints.includes(tp.value);
    });
    if (firstAvailable) {
      setActiveTimepoint(firstAvailable.value);
    }
  }, [isPatientPortal, currentStageCode, deliveryDate, completedTimepoints]);

  const fetchCurrentStage = async () => {
    try {
      const endpoint = isPatientPortal
        ? `/api/patient-portal/stages/current`
        : `/api/patients/${patientId}/stages`;

      const response = await fetch(endpoint, { credentials: 'include' });

      if (response.ok) {
        const data = await response.json();
        if (isPatientPortal) {
          const cs = data.currentStage;
          setCurrentStageCode(cs?.stageCode ?? null);
          if (cs?.deliveryDate) {
            setDeliveryDate(new Date(cs.deliveryDate));
          }
        } else {
          const useNew = !!data.useNewModel;
          if (useNew) {
            setCurrentStageCode(data.timeline?.currentStage?.stageCode ?? null);
          } else {
            // Legacy: map to stage code equivalent
            const stage = data.timeline?.currentStage?.stage;
            const legacyMap: Record<string, string> = {
              uj_beteg: 'STAGE_0', onkologiai_kezeles_kesz: 'STAGE_0',
              arajanlatra_var: 'STAGE_2', implantacios_sebeszi_tervezesre_var: 'STAGE_2',
              fogpotlasra_var: 'STAGE_5', fogpotlas_keszul: 'STAGE_5',
              fogpotlas_kesz: 'STAGE_6', gondozas_alatt: 'STAGE_7',
            };
            setCurrentStageCode(stage ? (legacyMap[stage] ?? null) : null);
          }
          if (data.deliveryDate) {
            setDeliveryDate(new Date(data.deliveryDate));
          }
        }
      }
    } catch (error) {
      console.error('Error fetching current stage:', error);
    }
  };

  const getAvailability = (timepoint: OHIP14Timepoint): TimepointAvailability => {
    return getTimepointAvailability(timepoint, currentStageCode, deliveryDate);
  };

  const fetchResponses = async () => {
    try {
      setLoading(true);
      const endpoint = isPatientPortal
        ? `/api/patient-portal/ohip14`
        : `/api/patients/${patientId}/ohip14`;

      const response = await fetch(endpoint, { credentials: 'include' });

      if (!response.ok) {
        throw new Error('Hiba a válaszok betöltésekor');
      }

      const data = await response.json();
      const responsesMap: Record<OHIP14Timepoint, OHIP14Response | null> = {
        T0: null, T1: null, T2: null, T3: null,
      };

      if (isPatientPortal) {
        const completed: OHIP14Timepoint[] = [];
        if (data.responses && Array.isArray(data.responses)) {
          data.responses.forEach((r: { timepoint?: string }) => {
            if (r.timepoint === 'T0' || r.timepoint === 'T1' || r.timepoint === 'T2' || r.timepoint === 'T3') {
              completed.push(r.timepoint);
            }
          });
        }
        setCompletedTimepoints(completed);
        setResponses(responsesMap);
      } else {
        if (data.responses && Array.isArray(data.responses)) {
          data.responses.forEach((resp: OHIP14Response) => {
            if (resp.timepoint === 'T0' || resp.timepoint === 'T1' || resp.timepoint === 'T2' || resp.timepoint === 'T3') {
              responsesMap[resp.timepoint] = resp;
            }
          });
        }
        setResponses(responsesMap);
      }
    } catch (error) {
      console.error('Error fetching OHIP-14 responses:', error);
      showToast('Hiba a válaszok betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResponseChange = (
    timepoint: OHIP14Timepoint,
    questionId: string,
    value: number | null
  ) => {
    if (isViewOnly) return;

    setResponses((prev) => {
      const current = prev[timepoint] || {
        patientId,
        timepoint,
        completedByPatient: isPatientPortal,
        q1_functional_limitation: null,
        q2_functional_limitation: null,
        q3_physical_pain: null,
        q4_physical_pain: null,
        q5_psychological_discomfort: null,
        q6_psychological_discomfort: null,
        q7_physical_disability: null,
        q8_physical_disability: null,
        q9_psychological_disability: null,
        q10_psychological_disability: null,
        q11_social_disability: null,
        q12_social_disability: null,
        q13_handicap: null,
        q14_handicap: null,
      };

      const updated = { ...current };
      const questionMap: Record<string, keyof OHIP14Response> = {
        q1: 'q1_functional_limitation',
        q2: 'q2_functional_limitation',
        q3: 'q3_physical_pain',
        q4: 'q4_physical_pain',
        q5: 'q5_psychological_discomfort',
        q6: 'q6_psychological_discomfort',
        q7: 'q7_physical_disability',
        q8: 'q8_physical_disability',
        q9: 'q9_psychological_disability',
        q10: 'q10_psychological_disability',
        q11: 'q11_social_disability',
        q12: 'q12_social_disability',
        q13: 'q13_handicap',
        q14: 'q14_handicap',
      };

      const field = questionMap[questionId];
      if (field) {
        (updated as any)[field] = value;
      }

      const scores = calculateOHIP14Scores(updated);
      updated.totalScore = scores.totalScore;
      updated.functionalLimitationScore = scores.functionalLimitationScore;
      updated.physicalPainScore = scores.physicalPainScore;
      updated.psychologicalDiscomfortScore = scores.psychologicalDiscomfortScore;
      updated.physicalDisabilityScore = scores.physicalDisabilityScore;
      updated.psychologicalDisabilityScore = scores.psychologicalDisabilityScore;
      updated.socialDisabilityScore = scores.socialDisabilityScore;
      updated.handicapScore = scores.handicapScore;

      return {
        ...prev,
        [timepoint]: updated,
      };
    });
  };

  const handleSave = async (timepoint: OHIP14Timepoint) => {
    const response = responses[timepoint];
    if (!response) {
      showToast('Nincs mit menteni', 'error');
      return;
    }

    const requiredFields = [
      'q1_functional_limitation', 'q2_functional_limitation',
      'q3_physical_pain', 'q4_physical_pain',
      'q5_psychological_discomfort', 'q6_psychological_discomfort',
      'q7_physical_disability', 'q8_physical_disability',
      'q9_psychological_disability', 'q10_psychological_disability',
      'q11_social_disability', 'q12_social_disability',
      'q13_handicap', 'q14_handicap',
    ];

    const hasAllAnswers = requiredFields.every((field) => {
      const value = (response as any)[field];
      return value !== null && value !== undefined;
    });

    if (!hasAllAnswers) {
      showToast('Kérjük, válaszoljon minden kérdésre', 'error');
      return;
    }

    try {
      setSaving(timepoint);

      const endpoint = isPatientPortal
        ? `/api/patient-portal/ohip14/${timepoint}`
        : `/api/patients/${patientId}/ohip14/${timepoint}`;

      const method = response.id ? 'PUT' : 'POST';

      const saveResponse = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(response),
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json();
        throw new Error(errorData.error || 'Hiba a mentés során');
      }

      showToast('OHIP-14 válaszok sikeresen mentve', 'success');
      await fetchResponses();
    } catch (error) {
      console.error('Error saving OHIP-14:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba a mentés során',
        'error'
      );
    } finally {
      setSaving(null);
    }
  };

  const getQuestionValue = (timepoint: OHIP14Timepoint, questionId: string): number | null => {
    const response = responses[timepoint];
    if (!response) return null;

    const questionMap: Record<string, keyof OHIP14Response> = {
      q1: 'q1_functional_limitation',
      q2: 'q2_functional_limitation',
      q3: 'q3_physical_pain',
      q4: 'q4_physical_pain',
      q5: 'q5_psychological_discomfort',
      q6: 'q6_psychological_discomfort',
      q7: 'q7_physical_disability',
      q8: 'q8_physical_disability',
      q9: 'q9_psychological_disability',
      q10: 'q10_psychological_disability',
      q11: 'q11_social_disability',
      q12: 'q12_social_disability',
      q13: 'q13_handicap',
      q14: 'q14_handicap',
    };

    const field = questionMap[questionId];
    if (!field) return null;

    return (response as any)[field] as number | null;
  };

  const getCompletedCount = (timepoint: OHIP14Timepoint): number => {
    let count = 0;
    ohip14Questions.forEach((q) => {
      const value = getQuestionValue(timepoint, q.id);
      if (value !== null && value !== undefined) {
        count++;
      }
    });
    return count;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  const isCurrentTimepointCompleted =
    isPatientPortal && activeTimepoint !== null && completedTimepoints.includes(activeTimepoint);

  const formatWindowDate = (d: Date) => {
    return d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Budapest' });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-medical-primary" />
            OHIP-14 Kérdőív
          </h4>
          <p className="text-sm text-gray-600 mt-1">
            Orális egészséghez kapcsolódó életminőség mérése
          </p>
        </div>
        {!isPatientPortal && (
          <button
            onClick={() => router.push(`/patients/${patientId}/ohip14`)}
            className="text-sm text-medical-primary hover:text-medical-primary-dark"
          >
            Részletes nézet
          </button>
        )}
      </div>

      {isPatientPortal && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">
            <strong>Szabály:</strong> Egy időablakban csak egyszer töltheti ki a kérdőívet. Kitöltés
            után a válaszokat és az eredményt nem tekintheti meg.
          </p>
        </div>
      )}

      {/* Timepoint selector */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {ohip14TimepointOptions.map((tp) => {
            const completed = getCompletedCount(tp.value);
            const isCompletePatient = isPatientPortal && completedTimepoints.includes(tp.value);
            const isComplete = isCompletePatient || completed === 14;
            const response = responses[tp.value];
            const availability = getAvailability(tp.value);
            const isAllowed = availability.allowed;
            const isLocked = !isPatientPortal && !!response?.lockedAt;
            const isCompletedNoView = isPatientPortal && completedTimepoints.includes(tp.value);

            return (
              <button
                key={tp.value}
                type="button"
                onClick={() => (isAllowed || isCompletedNoView) && !isLocked && setActiveTimepoint(tp.value)}
                disabled={(!isAllowed && !isCompletedNoView) || isLocked}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  (!isAllowed && !isCompletedNoView) || isLocked
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : activeTimepoint === tp.value
                      ? 'bg-medical-primary text-white border-medical-primary'
                      : isComplete || (response && !isPatientPortal)
                        ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
                        : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
                title={!isAllowed ? (availability.reason ?? '') : isLocked ? 'Ez a kérdőív le van zárva' : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{tp.label}</span>
                  {!isAllowed && !isCompletedNoView && <Lock className="w-4 h-4" />}
                  {isComplete && isAllowed && (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  {completed > 0 && completed < 14 && isAllowed && (
                    <span className="text-xs">({completed}/14)</span>
                  )}
                </div>
                <div className="text-xs mt-1">{tp.description}</div>
              </button>
            );
          })}
        </div>

        {/* Time-window info for active or hovered timepoint */}
        {activeTimepoint && activeTimepoint !== 'T0' && (() => {
          const avail = getAvailability(activeTimepoint);
          if (avail.opensAt && avail.closesAt) {
            return (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-gray-600">
                <CalendarClock className="w-4 h-4" />
                <span>
                  Kitöltési időablak: {formatWindowDate(avail.opensAt)} – {formatWindowDate(avail.closesAt)}
                </span>
              </div>
            );
          }
          return null;
        })()}

        {currentStageCode && (
          <p className="text-sm text-gray-600 mt-2">
            Jelenlegi stádium: <strong>{currentStageCode}</strong>
          </p>
        )}
        {!currentStageCode && (
          <p className="text-sm text-gray-500 mt-2">
            Nincs stádium beállítva. T0 kitölthető a protetikai fázis megkezdéséig.
          </p>
        )}
      </div>

      {/* Questions for active timepoint */}
      {activeTimepoint && (
        <div className="space-y-6">
          {isCurrentTimepointCompleted ? (
            <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <p className="text-gray-700 font-medium">
                A jelenlegi időablakhoz tartozó kérdőív már kitöltve.
              </p>
              <p className="text-sm text-gray-500 mt-1">
                A válaszokat és az eredményt a szabályok szerint nem tekintheti meg.
              </p>
            </div>
          ) : (
            <>
          <div className="flex items-center justify-between">
            <h5 className="text-base font-semibold text-gray-900">
              {ohip14TimepointOptions.find((tp) => tp.value === activeTimepoint)?.label} –{' '}
              {ohip14TimepointOptions.find((tp) => tp.value === activeTimepoint)?.description}
            </h5>
            {responses[activeTimepoint]?.lockedAt && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                Lezárva
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">
                Kitöltve: {getCompletedCount(activeTimepoint)} / 14 kérdés
              </span>
              <span className="text-sm font-medium text-gray-900">
                {Math.round((getCompletedCount(activeTimepoint) / 14) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-medical-primary h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(getCompletedCount(activeTimepoint) / 14) * 100}%`,
                }}
              ></div>
            </div>
          </div>

          {/* Questions grouped by dimension */}
          {ohip14Questions.map((question) => {
            const value = getQuestionValue(activeTimepoint, question.id);
            const response = responses[activeTimepoint];
            const isLocked = !!response?.lockedAt;
            const isAllowed = getAvailability(activeTimepoint).allowed;

            return (
              <div key={question.id} className="border-b border-gray-100 pb-4 last:border-b-0">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  {question.questionNumber}. {question.question}
                  <span className="text-xs text-gray-500 ml-2">
                    ({question.dimensionHungarian})
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {ohip14ResponseValueOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        !isViewOnly &&
                        !isLocked &&
                        isAllowed &&
                        handleResponseChange(activeTimepoint, question.id, option.value)
                      }
                      disabled={isViewOnly || isLocked || !isAllowed}
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        value === option.value
                          ? 'bg-medical-primary text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      } ${isViewOnly || isLocked || !isAllowed ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Total score display */}
          {responses[activeTimepoint]?.totalScore !== undefined && (
            <div className="mt-6 p-4 bg-medical-primary/10 rounded-lg border border-medical-primary/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">Összpontszám:</span>
                <span className="text-2xl font-bold text-medical-primary">
                  {responses[activeTimepoint]?.totalScore} / 56
                </span>
              </div>
            </div>
          )}

          {/* Save button */}
          {!isViewOnly && !responses[activeTimepoint]?.lockedAt && getAvailability(activeTimepoint).allowed && (
            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={() => handleSave(activeTimepoint)}
                disabled={saving === activeTimepoint || getCompletedCount(activeTimepoint) < 14}
                className="inline-flex items-center gap-2 px-4 py-2 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving === activeTimepoint ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mentés...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Mentés</span>
                  </>
                )}
              </button>
            </div>
          )}
          {!getAvailability(activeTimepoint).allowed && (
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                <strong>Figyelem:</strong>{' '}
                {getAvailability(activeTimepoint).reason}
              </p>
            </div>
          )}
            </>
          )}
        </div>
      )}

      {!activeTimepoint && (
        <p className="text-gray-500 text-center py-8">
          Válasszon egy timepointot a kérdőív kitöltéséhez
        </p>
      )}
    </div>
  );
}
