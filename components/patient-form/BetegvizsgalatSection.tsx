'use client';

import { Dispatch, SetStateAction } from 'react';
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { Patient, kezelesiTervOptions, fabianFejerdyProtetikaiOsztalyOptions } from '@/lib/types';
import { REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { normalizeToothData, type ToothStatus } from '@/hooks/usePatientAutoSave';
import { Calendar, Download } from 'lucide-react';
import { ToothCheckbox, getToothState } from './ToothCheckbox';
import { ToothTreatmentProvider, ToothTreatmentInline } from '../ToothTreatmentPanel';
import { OPInlinePreview } from '../OPInlinePreview';

interface BetegvizsgalatSectionProps {
  register: UseFormRegister<Patient>;
  watch: UseFormWatch<Patient>;
  setValue: UseFormSetValue<Patient>;
  errors: FieldErrors<Patient>;
  isViewOnly: boolean;
  fogak: Record<string, ToothStatus>;
  setFogak: Dispatch<SetStateAction<Record<string, ToothStatus>>>;
  handleToothStatusToggle: (toothNumber: string) => void;
  handleToothStatusSelect: (toothNumber: string, status: 'D' | 'F') => void;
  handleToothStatusDetailsChange: (toothNumber: string, details: string) => void;
  felsoFogpotlasVan: boolean | undefined;
  felsoFogpotlasElegedett: boolean | undefined;
  alsoFogpotlasVan: boolean | undefined;
  alsoFogpotlasElegedett: boolean | undefined;
  patientId: string | null;
  currentPatientName: string | null | undefined;
  patient: Patient | null | undefined;
  showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => string;
  sectionErrors: Record<string, number>;
}

export function BetegvizsgalatSection({
  register,
  watch,
  setValue,
  errors,
  isViewOnly,
  fogak,
  setFogak,
  handleToothStatusToggle,
  handleToothStatusSelect,
  handleToothStatusDetailsChange,
  felsoFogpotlasVan,
  felsoFogpotlasElegedett,
  alsoFogpotlasVan,
  alsoFogpotlasElegedett,
  patientId,
  currentPatientName,
  patient,
  showToast,
  sectionErrors,
}: BetegvizsgalatSectionProps) {
  return (
    <div id="section-betegvizsgalat" className="card scroll-mt-20 sm:scroll-mt-24">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
        BETEGVIZSGÁLAT
        {sectionErrors['betegvizsgalat'] > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
            {sectionErrors['betegvizsgalat']}
          </span>
        )}
      </h4>
      <div className="space-y-4">
        {/* OP inline preview above dental status */}
        {patientId && (
          <OPInlinePreview patientId={patientId} patientName={currentPatientName || undefined} />
        )}

        {/* Fogazati státusz */}
        <div className="border-t pt-4 mt-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h5 className="text-base sm:text-md font-semibold text-gray-900">Felvételi státusz</h5>
              {REQUIRED_FIELDS.some(f => f.key === 'meglevoFogak') && (
                <span className="text-medical-error text-sm">*</span>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isViewOnly) return;
                  setFogak(prev => {
                    const upperTeeth = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28];
                    const upperTeethStr = upperTeeth.map(t => t.toString());
                    
                    const allMissing = upperTeethStr.every(tooth => {
                      const value = prev[tooth];
                      const normalized = normalizeToothData(value);
                      return normalized?.status === 'M';
                    });
                    
                    const newState = { ...prev };
                    if (allMissing) {
                      upperTeethStr.forEach(tooth => {
                        delete newState[tooth];
                      });
                    } else {
                      upperTeeth.forEach(tooth => {
                        newState[tooth.toString()] = { status: 'M' };
                      });
                    }
                    return newState;
                  });
                }}
                disabled={isViewOnly}
                className="px-4 py-2 sm:px-3 sm:py-1.5 text-sm sm:text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0"
                title="Felső állcsont összes fogát hiányzónak jelöli / visszaállítja"
              >
                Felső teljes fogatlanság
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isViewOnly) return;
                  setFogak(prev => {
                    const lowerTeeth = [31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
                    const lowerTeethStr = lowerTeeth.map(t => t.toString());
                    
                    const allMissing = lowerTeethStr.every(tooth => {
                      const value = prev[tooth];
                      const normalized = normalizeToothData(value);
                      return normalized?.status === 'M';
                    });
                    
                    const newState = { ...prev };
                    if (allMissing) {
                      lowerTeethStr.forEach(tooth => {
                        delete newState[tooth];
                      });
                    } else {
                      lowerTeeth.forEach(tooth => {
                        newState[tooth.toString()] = { status: 'M' };
                      });
                    }
                    return newState;
                  });
                }}
                disabled={isViewOnly}
                className="px-4 py-2 sm:px-3 sm:py-1.5 text-sm sm:text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0"
                title="Alsó állcsont összes fogát hiányzónak jelöli / visszaállítja"
              >
                Alsó teljes fogatlanság
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-3">Kattintás: jelen van → hiányzik → alaphelyzet. Jelen lévő fogaknál D (szuvas) vagy F (tömött) kiválasztható.</p>
          <div className="bg-gray-50 p-3 sm:p-4 rounded-lg overflow-x-auto">
            {/* Felső sor */}
            <div className="flex justify-between mb-2 min-w-[600px] sm:min-w-0">
              <div className="flex gap-1 sm:gap-1">
                {[18, 17, 16, 15, 14, 13, 12, 11].map(tooth => {
                  const toothStr = tooth.toString();
                  return (
                    <ToothCheckbox
                      key={tooth}
                      toothNumber={toothStr}
                      value={fogak[toothStr]}
                      onChange={() => handleToothStatusToggle(toothStr)}
                      disabled={isViewOnly}
                    />
                  );
                })}
              </div>
              <div className="flex gap-1 sm:gap-1">
                {[21, 22, 23, 24, 25, 26, 27, 28].map(tooth => {
                  const toothStr = tooth.toString();
                  return (
                    <ToothCheckbox
                      key={tooth}
                      toothNumber={toothStr}
                      value={fogak[toothStr]}
                      onChange={() => handleToothStatusToggle(toothStr)}
                      disabled={isViewOnly}
                    />
                  );
                })}
              </div>
            </div>
            {/* Alsó sor */}
            <div className="flex justify-between min-w-[600px] sm:min-w-0">
              <div className="flex gap-1 sm:gap-1">
                {[48, 47, 46, 45, 44, 43, 42, 41].map(tooth => {
                  const toothStr = tooth.toString();
                  return (
                    <ToothCheckbox
                      key={tooth}
                      toothNumber={toothStr}
                      value={fogak[toothStr]}
                      onChange={() => handleToothStatusToggle(toothStr)}
                      disabled={isViewOnly}
                    />
                  );
                })}
              </div>
              <div className="flex gap-1 sm:gap-1">
                {[31, 32, 33, 34, 35, 36, 37, 38].map(tooth => {
                  const toothStr = tooth.toString();
                  return (
                    <ToothCheckbox
                      key={tooth}
                      toothNumber={toothStr}
                      value={fogak[toothStr]}
                      onChange={() => handleToothStatusToggle(toothStr)}
                      disabled={isViewOnly}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* DMF-T index számolás és megjelenítés */}
          {(() => {
            let dCount = 0;
            let fCount = 0;
            let mCount = 0;
            
            Object.values(fogak).forEach(value => {
              const normalized = normalizeToothData(value);
              if (normalized) {
                if (normalized.status === 'D') dCount++;
                else if (normalized.status === 'F') fCount++;
                else if (normalized.status === 'M') mCount++;
              }
            });
            
            const dmft = dCount + fCount + mCount;
            
            return (
              <div className="mt-4 p-3 sm:p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h6 className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">DMF-T index</h6>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-sm">
                  <div>
                    <span className="text-gray-600">D (szuvas):</span>
                    <span className="ml-2 font-semibold text-red-700">{dCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">F (tömött):</span>
                    <span className="ml-2 font-semibold text-blue-700">{fCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">M (hiányzik):</span>
                    <span className="ml-2 font-semibold text-gray-700">{mCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">DMF-T:</span>
                    <span className="ml-2 font-bold text-gray-900">{dmft}</span>
                    <span className="ml-1 text-xs text-gray-500">/ 32</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Fog státusz részletek */}
          {(() => {
            const presentTeeth = Object.keys(fogak).filter(toothNumber => {
              const value = fogak[toothNumber];
              const state = getToothState(value);
              return state === 'present';
            });
            
            if (presentTeeth.length === 0) return null;

            const content = (
            <div className="space-y-3 sm:space-y-4 mt-4">
                <h6 className="font-medium text-gray-700 text-sm sm:text-base">Fogak állapota</h6>
                {presentTeeth.sort().map(toothNumber => {
                  const value = fogak[toothNumber];
                  const normalized = normalizeToothData(value);
                  const description = normalized?.description || '';
                  const status = normalized?.status;
                  
                  return (
                <div key={toothNumber} className="border border-gray-200 rounded-md p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                        <label className="form-label font-medium text-sm sm:text-base">
                          {toothNumber}. fog – állapot
                        </label>
                        {!isViewOnly && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleToothStatusSelect(toothNumber, 'D')}
                              className={`px-3 py-2 sm:px-2 sm:py-1 text-sm sm:text-xs rounded border min-h-[44px] sm:min-h-0 ${
                                status === 'D'
                                  ? 'bg-red-100 border-red-400 text-red-700 font-semibold'
                                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                              title="Szuvas (D)"
                            >
                              D
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToothStatusSelect(toothNumber, 'F')}
                              className={`px-3 py-2 sm:px-2 sm:py-1 text-sm sm:text-xs rounded border min-h-[44px] sm:min-h-0 ${
                                status === 'F'
                                  ? 'bg-blue-100 border-blue-400 text-blue-700 font-semibold'
                                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                              title="Tömött (F)"
                            >
                              F
                            </button>
                          </div>
                        )}
                      </div>
                      <textarea
                        value={description}
                        onChange={(e) => handleToothStatusDetailsChange(toothNumber, e.target.value)}
                        rows={2}
                        className="form-input text-base sm:text-sm"
                        placeholder="Pl. korona, hídtag, gyökércsapos felépítmény, egyéb részletek"
                        readOnly={isViewOnly}
                      />
                      {/* Per-tooth treatment needs */}
                      <ToothTreatmentInline toothNumber={toothNumber} isViewOnly={isViewOnly} />
                </div>
                  );
                })}
            </div>
            );

            return patientId ? (
              <ToothTreatmentProvider patientId={patientId}>
                {content}
              </ToothTreatmentProvider>
            ) : content;
          })()}

          {/* Export PDF button */}
          {patientId && (Object.keys(fogak).length > 0 || patient?.felsoFogpotlasVan || patient?.alsoFogpotlasVan || (patient?.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0)) && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch(`/api/patients/${patientId}/dental-status-export`);
                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      throw new Error(errorData.error || 'PDF generálás sikertelen');
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `fogazati-status-${patientId}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    showToast('PDF sikeresen letöltve', 'success');
                  } catch (error) {
                    console.error('Hiba a PDF exportálásakor:', error);
                    const errorMessage = error instanceof Error ? error.message : 'Hiba történt a PDF exportálásakor';
                    alert(errorMessage);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-medical-primary text-white rounded-lg hover:bg-medical-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!patientId}
              >
                <Download className="w-4 h-4" />
                <span>Fog. st. exportálása</span>
              </button>
            </div>
          )}
        </div>

        {/* Fogpótlások – felső és alsó állcsont külön */}
        <div className="border-t pt-4 mt-4">
          <h5 className="text-md font-semibold text-gray-900 mb-3">Fogpótlások</h5>
          {/* Felső állcsont */}
          <div className="mb-6">
            <div className="flex items-center mb-2">
              <input
                {...register('felsoFogpotlasVan')}
                type="checkbox"
                className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm text-gray-700">Felső állcsont: van-e fogpótlása?</label>
            </div>
            {felsoFogpotlasVan && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6 mt-2">
                <div>
                  <label className="form-label">Mikor készült?</label>
                  <input
                    {...register('felsoFogpotlasMikor')}
                    className="form-input"
                    placeholder="pl. 2023 tavasz / 2023-05-10"
                    readOnly={isViewOnly}
                  />
                </div>
                <div>
                  <label className="form-label">Ki készítette / hol készült?</label>
                  <input
                    {...register('felsoFogpotlasKeszito')}
                    className="form-input"
                    placeholder="pl. Klinika / magánrendelő, orvos/technikus neve"
                    readOnly={isViewOnly}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label">Meglévő fogpótlás típusa</label>
                  <select {...register('felsoFogpotlasTipus')} className="form-input" disabled={isViewOnly}>
                    <option value="">Válasszon...</option>
                    {kezelesiTervOptions.filter(option => option !== 'sebészi sablon készítése').map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center md:col-span-2">
                  <input
                    {...register('felsoFogpotlasElegedett')}
                    type="checkbox"
                    className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                    disabled={isViewOnly}
                  />
                  <label className="ml-2 text-sm text-gray-700">Elégedett-e velük?</label>
                </div>
                {!felsoFogpotlasElegedett && (
                  <div className="md:col-span-2">
                    <label className="form-label">Ha nem, mi velük a baj?</label>
                    <textarea
                      {...register('felsoFogpotlasProblema')}
                      rows={2}
                      className="form-input"
                      placeholder="Rövid leírás a problémákról"
                      readOnly={isViewOnly}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Alsó állcsont */}
          <div>
            <div className="flex items-center mb-2">
              <input
                {...register('alsoFogpotlasVan')}
                type="checkbox"
                className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm text-gray-700">Alsó állcsont: van-e fogpótlása?</label>
            </div>
            {alsoFogpotlasVan && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6 mt-2">
                <div>
                  <label className="form-label">Mikor készült?</label>
                  <input
                    {...register('alsoFogpotlasMikor')}
                    className="form-input"
                    placeholder="pl. 2022 ősz / 2022-11-20"
                    readOnly={isViewOnly}
                  />
                </div>
                <div>
                  <label className="form-label">Ki készítette / hol készült?</label>
                  <input
                    {...register('alsoFogpotlasKeszito')}
                    className="form-input"
                    placeholder="pl. Klinika / magánrendelő, orvos/technikus neve"
                    readOnly={isViewOnly}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label">Meglévő fogpótlás típusa</label>
                  <select {...register('alsoFogpotlasTipus')} className="form-input" disabled={isViewOnly}>
                    <option value="">Válasszon...</option>
                    {kezelesiTervOptions.filter(option => option !== 'sebészi sablon készítése').map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center md:col-span-2">
                  <input
                    {...register('alsoFogpotlasElegedett')}
                    type="checkbox"
                    className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                    disabled={isViewOnly}
                  />
                  <label className="ml-2 text-sm text-gray-700">Elégedett-e velük?</label>
                </div>
                {!alsoFogpotlasElegedett && (
                  <div className="md:col-span-2">
                    <label className="form-label">Ha nem, mi velük a baj?</label>
                    <textarea
                      {...register('alsoFogpotlasProblema')}
                      rows={2}
                      className="form-input"
                      placeholder="Rövid leírás a problémákról"
                      readOnly={isViewOnly}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Maxilladefektus */}
        <div>
          <div className="flex items-center mb-2">
            <input
              {...register('maxilladefektusVan')}
              type="checkbox"
              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
              disabled={isViewOnly}
            />
            <label className="ml-2 text-sm text-gray-700">Maxilladefektus van</label>
          </div>
          {watch('maxilladefektusVan') && (
            <div className="space-y-4 ml-6 mt-2">
              <div>
                <label className="form-label">Brown-féle klasszifikáció – függőleges komponens</label>
                <select {...register('brownFuggolegesOsztaly')} className="form-input" disabled={isViewOnly}>
                  <option value="">Válasszon...</option>
                  <option value="1">1. osztály – maxillectomia oroantralis sipoly nélkül</option>
                  <option value="2">2. osztály – alacsony maxillectomia (orbita fenék/tartalom nélkül)</option>
                  <option value="3">3. osztály – magas maxillectomia (orbita tartalom érintett)</option>
                  <option value="4">4. osztály – radikális maxillectomia (orbitexenterációval)</option>
                </select>
              </div>
              <div>
                <label className="form-label">Brown – vízszintes/palatinalis komponens</label>
                <select {...register('brownVizszintesKomponens')} className="form-input" disabled={isViewOnly}>
                  <option value="">Válasszon...</option>
                  <option value="a">a – egyoldali alveolaris maxillectomia</option>
                  <option value="b">b – kétoldali alveolaris maxillectomia</option>
                  <option value="c">c – teljes alveolaris maxilla resectio</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Mandibuladefektus */}
        <div>
          <div className="flex items-center mb-2">
            <input
              {...register('mandibuladefektusVan')}
              type="checkbox"
              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
              disabled={isViewOnly}
            />
            <label className="ml-2 text-sm text-gray-700">Mandibuladefektus van</label>
          </div>
          {watch('mandibuladefektusVan') && (
            <div className="ml-6 mt-2">
              <label className="form-label">Kovács–Dobák osztályozás</label>
              <select {...register('kovacsDobakOsztaly')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                <option value="1">1. osztály – két nagyobb mandibula-maradvány, 2+ értékes foggal</option>
                <option value="2">2. osztály – egy mandibula-maradvány</option>
                <option value="3">3. osztály – két, minimális nagyságú mandibula-maradvány</option>
                <option value="4">4. osztály – kétoldali egység alloplasztikával/osteosynthesissel helyreállítva</option>
                <option value="5">5. osztály – egy/két kisméretű maradvány, szájfenék nem mozgatható → fogpótlás nem készíthető</option>
              </select>
            </div>
          )}
        </div>

        {/* Funkciók */}
        <div className="flex items-center">
          <input
            {...register('nyelvmozgásokAkadályozottak')}
            type="checkbox"
            className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
            disabled={isViewOnly}
          />
          <label className="ml-2 text-sm text-gray-700">Nyelvmozgások akadályozottak</label>
        </div>
        <div className="flex items-center">
          <input
            {...register('gombocosBeszed')}
            type="checkbox"
            className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
            disabled={isViewOnly}
          />
          <label className="ml-2 text-sm text-gray-700">Gombócos beszéd</label>
        </div>
        <div>
          <label className="form-label">Nyálmirigy állapot</label>
          <select {...register('nyalmirigyAllapot')} className="form-input" disabled={isViewOnly}>
            <option value="">Válasszon...</option>
            <option value="hiposzaliváció">Hiposzaliváció</option>
            <option value="hiperszaliváció">Hiperszaliváció</option>
            <option value="Nem számol be eltérésről">Nem számol be eltérésről</option>
          </select>
        </div>
        <div>
          <label className="form-label">Fábián–Fejérdy osztály (felső állcsont)</label>
          <select {...register('fabianFejerdyProtetikaiOsztalyFelso')} className="form-input" disabled={isViewOnly}>
            <option value="">Válasszon...</option>
            {fabianFejerdyProtetikaiOsztalyOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Fábián–Fejérdy osztály (alsó állcsont)</label>
          <select {...register('fabianFejerdyProtetikaiOsztalyAlso')} className="form-input" disabled={isViewOnly}>
            <option value="">Válasszon...</option>
            {fabianFejerdyProtetikaiOsztalyOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        {/* Felvétel dátuma már nem itt, hanem alapadatokban */}
      </div>
    </div>
  );
}
