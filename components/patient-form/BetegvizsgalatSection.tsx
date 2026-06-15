'use client';

import { Dispatch, SetStateAction, useState } from 'react';
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { Patient, kezelesiTervOptions, fabianFejerdyProtetikaiOsztalyOptions } from '@/lib/types';
import { REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { type ToothStatus } from '@/hooks/usePatientAutoSave';
import { Calendar, Download } from 'lucide-react';
import { ToothTreatmentProvider, ToothTreatmentInline } from '../ToothTreatmentPanel';
import { OPInlinePreview } from '../OPInlinePreview';
import { DentalStatusTimeline } from '../DentalStatusTimeline';
import { Odontogram } from './odontogram/Odontogram';
import { readConditions, computeDMFT, BASE_LABELS, isPresent } from './odontogram/tooth-conditions';
import { applyTreatmentOutcome } from '@/lib/tooth-treatment-outcome';
import { PerioChart } from './perio/PerioChart';

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
  const [showPerio, setShowPerio] = useState(false);
  return (
    <div id="section-betegvizsgalat" className="card scroll-mt-20 sm:scroll-mt-24">
      <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
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
          <div className="flex items-center gap-2 mb-3">
            <h5 className="text-base sm:text-md font-semibold text-gray-900 dark:text-gray-100">Felvételi státusz</h5>
            {REQUIRED_FIELDS.some(f => f.key === 'meglevoFogak') && (
              <span className="text-medical-error text-sm">*</span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Kattintson egy fogra a státusza beállításához (ép, hiányzó, tömött, korona,
            gyökértömött, implantátum stb.). A szuvasodás külön rátehető.
          </p>
          <Odontogram fogak={fogak} setFogak={setFogak} editing={!isViewOnly} isViewOnly={isViewOnly} />

          {/* DMF-T index számolás és megjelenítés */}
          {(() => {
            const { d: dCount, f: fCount, m: mCount, dmft } = computeDMFT(fogak);

            return (
              <div className="mt-4 p-3 sm:p-4 bg-blue-50 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800">
                <h6 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 text-sm sm:text-base">DMF-T index</h6>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">D (szuvas):</span>
                    <span className="ml-2 font-semibold text-red-700 dark:text-red-300">{dCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">F (tömött):</span>
                    <span className="ml-2 font-semibold text-blue-700 dark:text-blue-300">{fCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">M (hiányzik):</span>
                    <span className="ml-2 font-semibold text-gray-700 dark:text-gray-300">{mCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">DMF-T:</span>
                    <span className="ml-2 font-bold text-gray-900 dark:text-gray-100">{dmft}</span>
                    <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">/ 32</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Fogazati státusz idővonal — felvételkori, datált státuszok és kezelési terv */}
          {patientId && (
            <div className="mt-4">
              <DentalStatusTimeline patientId={patientId} />
            </div>
          )}

          {/* Fogankénti kezelési igények */}
          {(() => {
            const presentTeeth = Object.keys(fogak)
              .filter((toothNumber) => isPresent(readConditions(fogak[toothNumber])))
              .sort();

            if (presentTeeth.length === 0) return null;

            const content = (
              <div className="space-y-3 sm:space-y-4 mt-4">
                <h6 className="font-medium text-gray-700 dark:text-gray-300 text-sm sm:text-base">Fogankénti kezelési igények</h6>
                {presentTeeth.map((toothNumber) => {
                  const c = readConditions(fogak[toothNumber]);
                  return (
                    <div key={toothNumber} className="border border-gray-200 dark:border-gray-800 rounded-md p-3 sm:p-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-medium text-sm sm:text-base text-gray-900 dark:text-gray-100">{toothNumber}. fog</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {BASE_LABELS[c.base]}
                          {c.caries ? ' · szuvas' : ''}
                        </span>
                        {c.description && <span className="text-xs text-gray-500 dark:text-gray-400">· {c.description}</span>}
                      </div>
                      <ToothTreatmentInline toothNumber={toothNumber} isViewOnly={isViewOnly} />
                    </div>
                  );
                })}
              </div>
            );

            return patientId ? (
              <ToothTreatmentProvider
                patientId={patientId}
                onTreatmentCompleted={(toothNumber, treatmentCode) => {
                  // Egy kezelés "Kész"-re állításakor a szerver már frissítette a
                  // tárolt állapotot; itt a helyi (autosave-elt) odontogramot is
                  // átvezetjük, hogy a két oldal ne kerüljön ellentmondásba.
                  setFogak((prev) => {
                    const { changed, next } = applyTreatmentOutcome(prev[toothNumber], treatmentCode);
                    if (!changed) return prev;
                    const ns = { ...prev };
                    if (next === undefined) delete ns[toothNumber];
                    else ns[toothNumber] = next as ToothStatus;
                    return ns;
                  });
                }}
              >
                {content}
              </ToothTreatmentProvider>
            ) : content;
          })()}

          {/* Parodontális státusz — opcionális, alapból kikapcsolva */}
          {patientId && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span className="text-base sm:text-md font-semibold text-gray-900 dark:text-gray-100">Parodontális státusz</span>
                <button
                  type="button"
                  onClick={() => setShowPerio((v) => !v)}
                  role="switch"
                  aria-checked={showPerio}
                  className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
                >
                  <span
                    className={`relative inline-block w-9 h-5 rounded-full transition-colors ${showPerio ? 'bg-medical-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 bg-white dark:bg-gray-900 rounded-full transition-all ${showPerio ? 'right-0.5' : 'left-0.5'}`}
                    />
                  </span>
                  {showPerio ? 'bekapcsolva' : 'parodontális státuszfelvétel'}
                </button>
              </div>
              {showPerio && <PerioChart patientId={patientId} isViewOnly={isViewOnly} />}
            </div>
          )}

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
          <h5 className="text-md font-semibold text-gray-900 dark:text-gray-100 mb-3">Fogpótlások</h5>
          {/* Felső állcsont */}
          <div className="mb-6">
            <div className="flex items-center mb-2">
              <input
                {...register('felsoFogpotlasVan')}
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Felső állcsont: van-e fogpótlása?</label>
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
                    className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                    disabled={isViewOnly}
                  />
                  <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Elégedett-e velük?</label>
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
                className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Alsó állcsont: van-e fogpótlása?</label>
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
                    className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                    disabled={isViewOnly}
                  />
                  <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Elégedett-e velük?</label>
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
              className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
              disabled={isViewOnly}
            />
            <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Maxilladefektus van</label>
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
              className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
              disabled={isViewOnly}
            />
            <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Mandibuladefektus van</label>
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
            className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
            disabled={isViewOnly}
          />
          <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Nyelvmozgások akadályozottak</label>
        </div>
        <div className="flex items-center">
          <input
            {...register('gombocosBeszed')}
            type="checkbox"
            className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
            disabled={isViewOnly}
          />
          <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">Gombócos beszéd</label>
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
