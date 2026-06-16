'use client';

import { Dispatch, SetStateAction, useState } from 'react';
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors, UseFormRegisterReturn } from 'react-hook-form';
import { Patient, kezelesiTervOptions, fabianFejerdyProtetikaiOsztalyOptions } from '@/lib/types';
import { REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { type ToothStatus } from '@/hooks/usePatientAutoSave';
import { Calendar, Download, Check, CircleDashed, AlertTriangle, AlertCircle, Activity, Layers, type LucideIcon } from 'lucide-react';
import { ToothTreatmentProvider, ToothTreatmentInline } from '../ToothTreatmentPanel';
import { OPInlinePreview } from '../OPInlinePreview';
import { DentalStatusTimeline } from '../DentalStatusTimeline';
import { Odontogram } from './odontogram/Odontogram';
import { readConditions, computeDMFT, BASE_LABELS, isPresent } from './odontogram/tooth-conditions';
import { applyTreatmentOutcome } from '@/lib/tooth-treatment-outcome';
import { PerioChart } from './perio/PerioChart';

const FOGPOTLAS_TIPUS_OPTIONS = kezelesiTervOptions.filter((o) => o !== 'sebészi sablon készítése');

/** Egységes csoport-fejléc ikonos jelöléssel (Meglévő fogpótlások / Defektusok / Funkcionális állapot). */
function GroupHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-md bg-medical-primary/10 text-medical-primary shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <h5 className="text-md font-semibold text-gray-900 dark:text-gray-100 leading-tight">{title}</h5>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * Kétállású szegmens-kapcsoló egy boolean mezőhöz (pl. Van/Nincs, Igen/Nem).
 * `markMissing` esetén a `null`/`undefined` (nincs adat) állapotot borostyán
 * „Hiányzik" jelzés mutatja — megkülönböztetve az aktív nemleges választástól.
 */
function SegToggle({
  value,
  onChange,
  options,
  disabled,
  markMissing,
}: {
  value: boolean | null | undefined;
  onChange: (v: boolean) => void;
  options: Array<{ value: boolean; label: string; activeClass: string }>;
  disabled?: boolean;
  markMissing?: boolean;
}) {
  const missing = !!markMissing && (value === null || value === undefined);
  return (
    <div className="inline-flex items-center gap-2 shrink-0">
      {missing && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800 whitespace-nowrap">
          <AlertCircle className="w-3 h-3" /> Hiányzik
        </span>
      )}
      <div className={`inline-flex rounded-md border overflow-hidden text-xs shrink-0 ${missing ? 'border-amber-300 dark:border-amber-700' : 'border-gray-300 dark:border-gray-700'}`}>
        {options.map((o, i) => {
          const active = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={`px-3 py-1.5 font-medium transition-colors ${i > 0 ? 'border-l border-gray-300 dark:border-gray-700' : ''} ${
                active
                  ? o.activeClass
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              } disabled:cursor-default`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const YES_NO_OPTIONS = [
  { value: true, label: 'Igen', activeClass: 'bg-medical-primary text-white' },
  { value: false, label: 'Nem', activeClass: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200' },
] as const;

/** Egy klinikai igen/nem mező sora háromállású kapcsolóval (Igen / Nem / Hiányzik). */
function BoolFieldRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null | undefined;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-x-3 gap-y-2 flex-wrap">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <SegToggle value={value} onChange={onChange} disabled={disabled} markMissing options={[...YES_NO_OPTIONS]} />
    </div>
  );
}

/** Egy állcsont meglévő fogpótlásának kártyája (felső vagy alsó). */
function FogpotlasCard({
  jawLabel,
  van,
  onVanChange,
  elegedett,
  onElegedettChange,
  tipusField,
  mikorField,
  keszitoField,
  problemaField,
  isViewOnly,
}: {
  jawLabel: string;
  van: boolean | null;
  onVanChange: (v: boolean) => void;
  elegedett: boolean | null;
  onElegedettChange: (v: boolean) => void;
  tipusField: UseFormRegisterReturn;
  mikorField: UseFormRegisterReturn;
  keszitoField: UseFormRegisterReturn;
  problemaField: UseFormRegisterReturn;
  isViewOnly: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{jawLabel}</span>
        <SegToggle
          value={van}
          onChange={onVanChange}
          disabled={isViewOnly}
          markMissing
          options={[
            { value: true, label: 'Van', activeClass: 'bg-medical-primary text-white' },
            { value: false, label: 'Nincs', activeClass: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200' },
          ]}
        />
      </div>
      {van === true ? (
        <div className="space-y-3">
          <div>
            <label className="form-label">Típus</label>
            <select {...tipusField} className="form-input" disabled={isViewOnly}>
              <option value="">Válasszon...</option>
              {FOGPOTLAS_TIPUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Mikor készült?</label>
              <input {...mikorField} className="form-input" placeholder="pl. 2023 tavasz" readOnly={isViewOnly} />
            </div>
            <div>
              <label className="form-label">Ki / hol készült?</label>
              <input {...keszitoField} className="form-input" placeholder="pl. klinika / magánrendelő" readOnly={isViewOnly} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-x-2 gap-y-2 flex-wrap p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-md">
            <span className="text-sm text-gray-700 dark:text-gray-300">Elégedett vele?</span>
            <SegToggle
              value={elegedett}
              onChange={onElegedettChange}
              disabled={isViewOnly}
              markMissing
              options={[
                { value: true, label: 'Igen', activeClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
                { value: false, label: 'Nem', activeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
              ]}
            />
          </div>
          {elegedett === false && (
            <div>
              <label className="form-label">Mi a baj velük?</label>
              <textarea {...problemaField} rows={2} className="form-input" placeholder="Rövid leírás a problémákról" readOnly={isViewOnly} />
            </div>
          )}
        </div>
      ) : van === false ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-4 text-gray-500 dark:text-gray-400">
          <Check className="w-5 h-5 mb-1.5 text-green-600 dark:text-green-400" />
          <span className="text-sm">Nincs régi fogpótlás</span>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-4 text-gray-400 dark:text-gray-500">
          <CircleDashed className="w-5 h-5 mb-1.5" />
          <span className="text-sm">Nincs rögzítve adat</span>
          {!isViewOnly && <span className="text-xs">Nyilatkozz: Van vagy Nincs</span>}
        </div>
      )}
    </div>
  );
}

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
  felsoFogpotlasVan: boolean | null | undefined;
  felsoFogpotlasElegedett: boolean | null | undefined;
  alsoFogpotlasVan: boolean | null | undefined;
  alsoFogpotlasElegedett: boolean | null | undefined;
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
          <Odontogram
            fogak={fogak}
            setFogak={setFogak}
            editing={!isViewOnly}
            isViewOnly={isViewOnly}
            fabianFelsoField={register('fabianFejerdyProtetikaiOsztalyFelso')}
            fabianAlsoField={register('fabianFejerdyProtetikaiOsztalyAlso')}
            fabianOptions={fabianFejerdyProtetikaiOsztalyOptions}
          />

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

        {/* ===== Meglévő fogpótlások — felső és alsó egymás mellett ===== */}
        <div className="border-t pt-4 mt-4">
          <GroupHeader icon={Layers} title="Meglévő fogpótlások" subtitle="A beteg jelenlegi pótlásai — felső és alsó állcsont egymás mellett." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
            <FogpotlasCard
              jawLabel="Felső állcsont"
              van={felsoFogpotlasVan ?? null}
              onVanChange={(v) => setValue('felsoFogpotlasVan', v, { shouldDirty: true })}
              elegedett={felsoFogpotlasElegedett ?? null}
              onElegedettChange={(v) => setValue('felsoFogpotlasElegedett', v, { shouldDirty: true })}
              tipusField={register('felsoFogpotlasTipus')}
              mikorField={register('felsoFogpotlasMikor')}
              keszitoField={register('felsoFogpotlasKeszito')}
              problemaField={register('felsoFogpotlasProblema')}
              isViewOnly={isViewOnly}
            />
            <FogpotlasCard
              jawLabel="Alsó állcsont"
              van={alsoFogpotlasVan ?? null}
              onVanChange={(v) => setValue('alsoFogpotlasVan', v, { shouldDirty: true })}
              elegedett={alsoFogpotlasElegedett ?? null}
              onElegedettChange={(v) => setValue('alsoFogpotlasElegedett', v, { shouldDirty: true })}
              tipusField={register('alsoFogpotlasTipus')}
              mikorField={register('alsoFogpotlasMikor')}
              keszitoField={register('alsoFogpotlasKeszito')}
              problemaField={register('alsoFogpotlasProblema')}
              isViewOnly={isViewOnly}
            />
          </div>
        </div>

        {/* ===== Defektusok ===== */}
        <div className="border-t pt-4 mt-4">
          <GroupHeader icon={AlertTriangle} title="Defektusok" subtitle="Maxilla- és mandibuladefektus, osztályozással." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
            <div className={`rounded-lg border p-4 bg-white dark:bg-gray-800/30 h-full ${watch('maxilladefektusVan') === true ? 'border-medical-primary/50' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex items-center justify-between gap-x-3 gap-y-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Maxilladefektus</span>
                <SegToggle
                  value={watch('maxilladefektusVan')}
                  onChange={(v) => setValue('maxilladefektusVan', v, { shouldDirty: true })}
                  disabled={isViewOnly}
                  markMissing
                  options={[...YES_NO_OPTIONS]}
                />
              </div>
              {watch('maxilladefektusVan') === true && (
                <div className="space-y-3 mt-3">
                  <div>
                    <label className="form-label">Brown – függőleges komponens</label>
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

            <div className={`rounded-lg border p-4 bg-white dark:bg-gray-800/30 h-full ${watch('mandibuladefektusVan') === true ? 'border-medical-primary/50' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex items-center justify-between gap-x-3 gap-y-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Mandibuladefektus</span>
                <SegToggle
                  value={watch('mandibuladefektusVan')}
                  onChange={(v) => setValue('mandibuladefektusVan', v, { shouldDirty: true })}
                  disabled={isViewOnly}
                  markMissing
                  options={[...YES_NO_OPTIONS]}
                />
              </div>
              {watch('mandibuladefektusVan') === true && (
                <div className="mt-3">
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
          </div>
        </div>

        {/* ===== Funkcionális állapot ===== */}
        <div className="border-t pt-4 mt-4">
          <GroupHeader icon={Activity} title="Funkcionális állapot" subtitle="Beszéd, nyelvmozgás és nyálmirigy állapota." />
          <div className="bg-white dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <div className="pb-3">
                <BoolFieldRow
                  label="Nyelvmozgások akadályozottak"
                  value={watch('nyelvmozgásokAkadályozottak')}
                  onChange={(v) => setValue('nyelvmozgásokAkadályozottak', v, { shouldDirty: true })}
                  disabled={isViewOnly}
                />
              </div>
              <div className="pt-3">
                <BoolFieldRow
                  label="Gombócos beszéd"
                  value={watch('gombocosBeszed')}
                  onChange={(v) => setValue('gombocosBeszed', v, { shouldDirty: true })}
                  disabled={isViewOnly}
                />
              </div>
            </div>
            <div className="sm:max-w-xs">
              <label className="form-label">Nyálmirigy állapot</label>
              <select {...register('nyalmirigyAllapot')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                <option value="hiposzaliváció">Hiposzaliváció</option>
                <option value="hiperszaliváció">Hiperszaliváció</option>
                <option value="Nem számol be eltérésről">Nem számol be eltérésről</option>
              </select>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              A Fábián–Fejérdy protetikai osztály a fenti fogazati státusz odontogramján, a felső és alsó ív mellett állítható.
            </p>
          </div>
        </div>
        {/* Felvétel dátuma már nem itt, hanem alapadatokban */}
      </div>
    </div>
  );
}
