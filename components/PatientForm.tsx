'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Patient, patientSchema, beutaloIntezmenyOptions, nyakiBlokkdisszekcioOptions, fabianFejerdyProtetikaiOsztalyOptions, kezeleoorvosOptions } from '@/lib/types';
import { formatDateForInput } from '@/lib/dateUtils';
import { X, Calendar, User, Phone, Mail, MapPin, FileText, AlertTriangle } from 'lucide-react';

// ToothCheckbox komponens
interface ToothCheckboxProps {
  toothNumber: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function ToothCheckbox({ toothNumber, checked, onChange, disabled }: ToothCheckboxProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <label 
        htmlFor={`tooth-${toothNumber}`}
        className="text-xs text-gray-600 font-medium cursor-pointer"
      >
        {toothNumber}
      </label>
      <input
        id={`tooth-${toothNumber}`}
        type="checkbox"
        checked={!!checked}
        onChange={() => {
          if (!disabled) {
            onChange();
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
        disabled={disabled}
        className="w-7 h-7 rounded border-2 border-gray-300 text-medical-primary focus:ring-2 focus:ring-medical-primary focus:ring-offset-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

interface PatientFormProps {
  patient?: Patient | null;
  onSave: (patient: Patient) => void;
  onCancel: () => void;
  isViewOnly?: boolean;
}

export function PatientForm({ patient, onSave, onCancel, isViewOnly = false }: PatientFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<Patient>({
    resolver: zodResolver(patientSchema),
    defaultValues: patient ? {
      ...patient,
      szuletesiDatum: formatDateForInput(patient.szuletesiDatum),
      mutetIdeje: formatDateForInput(patient.mutetIdeje),
      felvetelDatuma: formatDateForInput(patient.felvetelDatuma),
    } : {
      radioterapia: false,
      chemoterapia: false,
      nemIsmertPoziciokbanImplantatum: false,
      felsoFogpotlasVan: false,
      felsoFogpotlasElegedett: true,
      alsoFogpotlasVan: false,
      alsoFogpotlasElegedett: true,
    },
  });

  const radioterapia = watch('radioterapia');
  const chemoterapia = watch('chemoterapia');
  const kezeleoorvos = watch('kezeleoorvos');
  const nemIsmertPoziciokbanImplantatum = watch('nemIsmertPoziciokbanImplantatum');
  const felsoFogpotlasVan = watch('felsoFogpotlasVan');
  const felsoFogpotlasElegedett = watch('felsoFogpotlasElegedett');
  const alsoFogpotlasVan = watch('alsoFogpotlasVan');
  const alsoFogpotlasElegedett = watch('alsoFogpotlasElegedett');
  const [implantatumok, setImplantatumok] = useState<Record<string, string>>(patient?.meglevoImplantatumok || {});
  const [fogak, setFogak] = useState<Record<string, string>>(patient?.meglevoFogak || {});
  // State for "vanBeutalo" toggle (default true if bármely beutaló-adat van)
  const initialVanBeutalo = !!(patient?.beutaloOrvos || patient?.beutaloIntezmeny || patient?.kezelesreErkezesIndoka);
  const [vanBeutalo, setVanBeutalo] = useState(initialVanBeutalo);

  // Implantátumok frissítése amikor patient változik
  useEffect(() => {
    if (patient?.meglevoImplantatumok) {
      setImplantatumok(patient.meglevoImplantatumok);
    } else {
      setImplantatumok({});
    }
    if (patient?.meglevoFogak) {
      setFogak(patient.meglevoFogak);
    } else {
      setFogak({});
    }
  }, [patient]);

  // Automatikus intézet beállítás a kezelőorvos alapján
  useEffect(() => {
    if (kezeleoorvos && !isViewOnly) {
      const fogpotlastaniKlinikaOrvosok = ['Dr. Kádár', 'Dr. König', 'Dr. Takács', 'Dr. Körmendi', 'Dr. Tasi'];
      if (fogpotlastaniKlinikaOrvosok.includes(kezeleoorvos)) {
        setValue('kezeleoorvosIntezete', 'Fogpótlástani Klinika');
      } else {
        setValue('kezeleoorvosIntezete', 'Fogászati és Szájsebészeti Oktató Intézet');
      }
    }
  }, [kezeleoorvos, setValue, isViewOnly]);

  // Implantátumok frissítése a form-ban
  useEffect(() => {
    setValue('meglevoImplantatumok', implantatumok);
  }, [implantatumok, setValue]);

  // Fogazati státusz frissítése a form-ban
  useEffect(() => {
    setValue('meglevoFogak', fogak);
  }, [fogak, setValue]);

  const handleToothToggle = (toothNumber: string) => {
    if (isViewOnly) return;
    
    setImplantatumok(prev => {
      const currentValue = prev[toothNumber];
      if (currentValue !== undefined && currentValue !== null) {
        // Kipipálás - törlés
        const newState = { ...prev };
        delete newState[toothNumber];
        return newState;
      } else {
        // Pipálás - hozzáadás üres stringgel
        return { ...prev, [toothNumber]: '' };
      }
    });
  };

  const handleImplantatumDetailsChange = (toothNumber: string, details: string) => {
    if (isViewOnly) return;
    setImplantatumok(prev => ({ ...prev, [toothNumber]: details }));
  };

  const handleToothStatusToggle = (toothNumber: string) => {
    if (isViewOnly) return;
    setFogak(prev => {
      const current = prev[toothNumber];
      if (current !== undefined && current !== null) {
        const newState = { ...prev };
        delete newState[toothNumber];
        return newState; // Pipából kivéve: hiányzik
      } else {
        return { ...prev, [toothNumber]: '' }; // Pipálva: jelen van, részletek opcionálisak
      }
    });
  };

  const handleToothStatusDetailsChange = (toothNumber: string, details: string) => {
    if (isViewOnly) return;
    setFogak(prev => ({ ...prev, [toothNumber]: details }));
  };

  const onSubmit = (data: Patient) => {
    onSave(data);
  };

  // Watch kezelésre érkezés indoka for conditional logic
  const selectedIndok = watch('kezelesreErkezesIndoka');

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-2xl font-bold text-gray-900">
          {isViewOnly ? 'Beteg megtekintése' : patient ? 'Beteg szerkesztése' : 'Új beteg'}
        </h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* ALAPADATOK */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-medical-primary" />
            ALAPADATOK
          </h4>
          <div className="space-y-4">
            <div>
              <label className="form-label">NÉV</label>
              <input
                {...register('nev')}
                className="form-input"
                placeholder="Teljes név"
                readOnly={isViewOnly}
              />
              {errors.nev && (
                <p className="text-red-500 text-sm mt-1">{errors.nev.message}</p>
              )}
            </div>
            <div>
              <label className="form-label">TAJ</label>
              <input
                {...register('taj')}
                className="form-input"
                placeholder="TAJ szám"
              />
            </div>
            <div>
              <label className="form-label">TELEFONSZÁM</label>
              <input
                {...register('telefonszam')}
                className="form-input"
                placeholder="Telefonszám"
                readOnly={isViewOnly}
              />
            </div>
          </div>
        </div>

        {/* SZEMÉLYES ADATOK */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <MapPin className="w-5 h-5 mr-2 text-medical-primary" />
            SZEMÉLYES ADATOK
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Születési dátum</label>
              <input
                {...register('szuletesiDatum')}
                type="date"
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">Nem</label>
              <select {...register('nem')} className="form-input">
                <option value="">Válasszon...</option>
                <option value="ferfi">Férfi</option>
                <option value="no">Nő</option>
                <option value="egyeb">Egyéb</option>
              </select>
            </div>
            <div>
              <label className="form-label">Email</label>
              <input
                {...register('email')}
                type="email"
                className="form-input"
                placeholder="Email cím"
              />
              {errors.email && (
                <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
              )}
            </div>
            <div>
              <label className="form-label">Cím</label>
              <input
                {...register('cim')}
                className="form-input"
                placeholder="Lakcím"
              />
            </div>
            <div>
              <label className="form-label">Város</label>
              <input
                {...register('varos')}
                className="form-input"
                placeholder="Város"
              />
            </div>
            <div>
              <label className="form-label">Irányítószám</label>
              <input
                {...register('iranyitoszam')}
                className="form-input"
                placeholder="Irányítószám"
              />
            </div>
          </div>
        </div>

        {/* BEUTALÓ */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-medical-primary" />
            BEUTALÓ
          </h4>

          <div className="flex items-center mb-4">
            <input
              id="beutalo-toggle"
              type="checkbox"
              checked={vanBeutalo}
              onChange={() => setVanBeutalo((prev) => !prev)}
              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
              disabled={isViewOnly}
            />
            <label htmlFor="beutalo-toggle" className="ml-2 text-sm text-gray-700">Van beutaló?</label>
          </div>

          {vanBeutalo && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Beutaló orvos</label>
                <input
                  {...register('beutaloOrvos')}
                  className="form-input"
                  placeholder="Beutaló orvos neve"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
              </div>
              <div>
                <label className="form-label">Beutaló intézmény</label>
                <select {...register('beutaloIntezmeny')} className="form-input" disabled={isViewOnly || !vanBeutalo}>
                  <option value="">Válasszon...</option>
                  {beutaloIntezmenyOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="form-label">Indokolás</label>
                <textarea
                  {...register('mutetRovidLeirasa')}
                  rows={3}
                  className="form-input"
                  placeholder="Miért kapott beutalót?"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
              </div>
            </div>
          )}
        </div>

        {/* KEZELŐORVOS */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-medical-primary" />
            KEZELŐORVOS
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Kezelőorvos</label>
              <select {...register('kezeleoorvos')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                {kezeleoorvosOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Kezelőorvos intézete</label>
              <input
                {...register('kezeleoorvosIntezete')}
                className="form-input"
                placeholder="Automatikusan kitöltődik"
                readOnly
              />
            </div>
          </div>
        </div>

        {/* ANAMNÉZIS */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
            ANAMNÉZIS
          </h4>
          <div className="space-y-4">
            <div>
              <label className="form-label">Kezelésre érkezés indoka</label>
              <select {...register('kezelesreErkezesIndoka')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                <option value="traumás sérülés">traumás sérülés</option>
                <option value="veleszületett rendellenesség">veleszületett rendellenesség</option>
                <option value="onkológiai kezelés utáni állapot">onkológiai kezelés utáni állapot</option>
              </select>
            </div>
            {/* Ezeket mindig mutatjuk, conditionaltól függetlenül */}
            <div>
              <label className="form-label">Alkoholfogyasztás</label>
              <textarea
                {...register('alkoholfogyasztas')}
                rows={2}
                className="form-input"
                placeholder="Szabadszavas leírás"
                readOnly={isViewOnly}
              />
            </div>
            <div>
              <label className="form-label">Dohányzás (n szál/nap)</label>
              <input
                {...register('dohanyzasSzam')}
                className="form-input"
                placeholder="pl. 10 szál/nap"
                readOnly={isViewOnly}
              />
            </div>

            {/* TRAUMA kérdések */}
            {selectedIndok === 'traumás sérülés' && (
              <>
                <div>
                  <label className="form-label">Baleset időpontja</label>
                  <input
                    {...register('balesetIdopont')}
                    type="date"
                    className="form-input"
                    readOnly={isViewOnly}
                  />
                </div>
                <div>
                  <label className="form-label">Baleset etiológiája</label>
                  <textarea
                    {...register('balesetEtiologiaja')}
                    rows={2}
                    className="form-input"
                    placeholder="Szabadszavas leírás (pl. közlekedési baleset, esés stb.)"
                    readOnly={isViewOnly}
                  />
                </div>
                <div>
                  <label className="form-label">Egyéb körülmények, műtétek</label>
                  <textarea
                    {...register('balesetEgyeb')}
                    rows={2}
                    className="form-input"
                    placeholder="Egyéb körülmények, műtétek, stb. (szabadszavas)"
                    readOnly={isViewOnly}
                  />
                </div>
              </>
            )}

            {/* ONKOLOGIA kérdések */}
            {selectedIndok === 'onkológiai kezelés utáni állapot' && (
              <>
                <div>
                  <label className="form-label">Tumor szövettani típusa</label>
                  <input
                    {...register('szovettaniDiagnozis')}
                    className="form-input"
                    placeholder="Szövettani diagnózis"
                    readOnly={isViewOnly}
                  />
                </div>
                {/* TNM-staging mező */}
                <div>
                  <label className="form-label">TNM-staging</label>
                  <input
                    {...register('tnmStaging')}
                    className="form-input"
                    placeholder="pl. pT3N2bM0, UICC 8. ed."
                    readOnly={isViewOnly}
                  />
                </div>
                {/* Műtét ideje csak onkológiai esetben */}
                <div>
                  <label className="form-label">Műtét ideje</label>
                  <input
                    {...register('mutetIdeje')}
                    type="date"
                    className="form-input"
                    readOnly={isViewOnly}
                  />
                </div>
                {/* Primer műtét leírása */}
                <div>
                  <label className="form-label">Primer műtét leírása</label>
                  <textarea
                    {...register('primerMutetLeirasa')}
                    rows={2}
                    className="form-input"
                    placeholder="Primer műtét rövid leírása (szabadszavas)"
                    readOnly={isViewOnly}
                  />
                </div>
                {/* Nyaki blokkdisszekció most itt */}
                <div>
                  <label className="form-label">Nyaki blokkdisszekció</label>
                  <select {...register('nyakiBlokkdisszekcio')} className="form-input" disabled={isViewOnly}>
                    <option value="">Válasszon...</option>
                    {nyakiBlokkdisszekcioOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                {/* Adjuváns terápiák blokk (mindig utolsó onkológiai kérdés ebben a conditionalban) */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h5 className="text-md font-semibold text-gray-900 mb-4">Adjuváns terápiák</h5>
                  <div className="space-y-4">
                    <div className="flex items-center">
                      <input
                        {...register('radioterapia')}
                        type="checkbox"
                        className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                        disabled={isViewOnly}
                      />
                      <label className="ml-2 text-sm text-gray-700">Radioterápia</label>
                    </div>
                    {radioterapia && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                        <div>
                          <label className="form-label">Dózis (n Gy)</label>
                          <input
                            {...register('radioterapiaDozis')}
                            className="form-input"
                            placeholder="pl. 60 Gy"
                            readOnly={isViewOnly}
                          />
                        </div>
                        <div>
                          <label className="form-label">Dátumintervallum</label>
                          <input
                            {...register('radioterapiaDatumIntervallum')}
                            className="form-input"
                            placeholder="pl. 2023.01.15 - 2023.03.15"
                            readOnly={isViewOnly}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center">
                      <input
                        {...register('chemoterapia')}
                        type="checkbox"
                        className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                        disabled={isViewOnly}
                      />
                      <label className="ml-2 text-sm text-gray-700">Kemoterápia</label>
                    </div>
                    {chemoterapia && (
                      <div className="ml-6">
                        <label className="form-label">Mikor, mit, mennyit</label>
                        <textarea
                          {...register('chemoterapiaLeiras')}
                          rows={3}
                          className="form-input"
                          placeholder="Részletes leírás: mikor, milyen készítmény, mennyiség"
                          readOnly={isViewOnly}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* VELESZÜLETETT kérdések */}
            {selectedIndok === 'veleszületett rendellenesség' && (
              <>
                <div>
                  <label className="form-label">Milyen rendellenesség(ek) áll(nak) fenn?</label>
                  <div className="flex flex-col gap-2 ml-4">
                    {["kemény szájpadhasadék", "lágyszájpad inszufficiencia", "állcsonthasadék", "ajakhasadék"]
                      .map(opt => (
                        <label key={opt} className="flex items-center">
                          <input
                            type="checkbox"
                            value={opt}
                            {...register('veleszuletettRendellenessegek')}
                            className="mr-2"
                            disabled={isViewOnly}
                          />
                          {opt}
                        </label>
                      ))}
                  </div>
                </div>
                <div>
                  <label className="form-label">Műtétek leírása, legutolsó beavatkozás</label>
                  <textarea
                    {...register('veleszuletettMutetekLeirasa')}
                    rows={2}
                    className="form-input"
                    placeholder="Műtétek leírása, legutolsó beavatkozás (szabadszavas)"
                    readOnly={isViewOnly}
                  />
                </div>
              </>
            )}

            {/* Közös mezők (mindháromhoz) */}
            {/* Műtét ideje már nem itt, hanem onkológiai esetben */}
          </div>
        </div>

        {/* BETEGVIZSGÁLAT */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
            BETEGVIZSGÁLAT
          </h4>
          <div className="space-y-4">
            {/* Fogazati státusz */}
            <div className="border-t pt-4 mt-4">
              <h5 className="text-md font-semibold text-gray-900 mb-3">Fogazati státusz (Zsigmondy)</h5>
              <p className="text-sm text-gray-600 mb-3">Nem pipálva: hiányzik. Pipálva: jelen van (állapot lent rögzíthető).</p>
              <div className="bg-gray-50 p-4 rounded-lg">
                {/* Felső sor */}
                <div className="flex justify-between mb-2">
                  <div className="flex gap-1">
                    {[18, 17, 16, 15, 14, 13, 12, 11].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          checked={toothStr in fogak}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                  <div className="flex gap-1">
                    {[21, 22, 23, 24, 25, 26, 27, 28].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          checked={toothStr in fogak}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                </div>
                {/* Alsó sor */}
                <div className="flex justify-between">
                  <div className="flex gap-1">
                    {[48, 47, 46, 45, 44, 43, 42, 41].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          checked={toothStr in fogak}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                  <div className="flex gap-1">
                    {[31, 32, 33, 34, 35, 36, 37, 38].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          checked={toothStr in fogak}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Fog státusz részletek */}
              {Object.keys(fogak).length > 0 && (
                <div className="space-y-4 mt-4">
                  <h6 className="font-medium text-gray-700">Fogak állapota</h6>
                  {Object.keys(fogak).sort().map(toothNumber => (
                    <div key={toothNumber} className="border border-gray-200 rounded-md p-4">
                      <label className="form-label font-medium">{toothNumber}. fog – állapot</label>
                      <textarea
                        value={fogak[toothNumber] || ''}
                        onChange={(e) => handleToothStatusDetailsChange(toothNumber, e.target.value)}
                        rows={2}
                        className="form-input"
                        placeholder="Pl. szuvas, tömött, koronával ellátott"
                        readOnly={isViewOnly}
                      />
                    </div>
                  ))}
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

              {/* Meglévő fogpótlás típusa */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                {felsoFogpotlasVan && (
                  <div>
                    <label className="form-label">Meglévő fogpótlás típusa – felső</label>
                    <select {...register('felsoFogpotlasTipus')} className="form-input" disabled={isViewOnly}>
                      <option value="">Válasszon...</option>
                      <option value="teljes akrilátlemezes fogpótlás">teljes akrilátlemezes fogpótlás</option>
                      <option value="részleges akrilátlemezes fogpótlás">részleges akrilátlemezes fogpótlás</option>
                      <option value="részleges fémlemezes fogpótlás kapocselhorgonyzással">részleges fémlemezes fogpótlás kapocselhorgonyzással</option>
                      <option value="kombinált fogpótlás kapocselhorgonyzással">kombinált fogpótlás kapocselhorgonyzással</option>
                      <option value="kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel">kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel</option>
                      <option value="fedőlemezes fogpótlás">fedőlemezes fogpótlás</option>
                      <option value="rögzített fogpótlás">rögzített fogpótlás</option>
                    </select>
                  </div>
                )}
                {alsoFogpotlasVan && (
                  <div>
                    <label className="form-label">Meglévő fogpótlás típusa – alsó</label>
                    <select {...register('alsoFogpotlasTipus')} className="form-input" disabled={isViewOnly}>
                      <option value="">Válasszon...</option>
                      <option value="teljes akrilátlemezes fogpótlás">teljes akrilátlemezes fogpótlás</option>
                      <option value="részleges akrilátlemezes fogpótlás">részleges akrilátlemezes fogpótlás</option>
                      <option value="részleges fémlemezes fogpótlás kapocselhorgonyzással">részleges fémlemezes fogpótlás kapocselhorgonyzással</option>
                      <option value="kombinált fogpótlás kapocselhorgonyzással">kombinált fogpótlás kapocselhorgonyzással</option>
                      <option value="kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel">kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel</option>
                      <option value="fedőlemezes fogpótlás">fedőlemezes fogpótlás</option>
                      <option value="rögzített fogpótlás">rögzített fogpótlás</option>
                    </select>
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

        {/* MEGLÉVŐ IMPLANTÁTUMOK */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-medical-primary" />
            Meglévő implantátumok, ha vannak
          </h4>
          
          {/* Zsigmondy-kereszt */}
          <div className="mb-6">
            <div className="bg-gray-50 p-4 rounded-lg">
              {/* Felső sor - 1. kvadráns (bal felső) és 2. kvadráns (jobb felső) */}
              <div className="flex justify-between mb-2">
                <div className="flex gap-1">
                  {[18, 17, 16, 15, 14, 13, 12, 11].map(tooth => {
                    const toothStr = tooth.toString();
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        checked={toothStr in implantatumok}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1">
                  {[21, 22, 23, 24, 25, 26, 27, 28].map(tooth => {
                    const toothStr = tooth.toString();
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        checked={toothStr in implantatumok}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                      />
                    );
                  })}
                </div>
              </div>
              
              {/* Alsó sor - 4. kvadráns (bal alsó) és 3. kvadráns (jobb alsó) */}
              <div className="flex justify-between">
                <div className="flex gap-1">
                  {[48, 47, 46, 45, 44, 43, 42, 41].map(tooth => {
                    const toothStr = tooth.toString();
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        checked={toothStr in implantatumok}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1">
                  {[31, 32, 33, 34, 35, 36, 37, 38].map(tooth => {
                    const toothStr = tooth.toString();
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        checked={toothStr in implantatumok}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Implantátum részletek */}
          {Object.keys(implantatumok).length > 0 && (
            <div className="space-y-4 mb-4">
              <h5 className="font-medium text-gray-700 mb-3">Implantátum részletek</h5>
              {Object.keys(implantatumok).sort().map(toothNumber => (
                <div key={toothNumber} className="border border-gray-200 rounded-md p-4">
                  <label className="form-label font-medium">
                    {toothNumber}. fog - Implantátum típusa, gyári száma, stb.
                  </label>
                  <textarea
                    value={implantatumok[toothNumber] || ''}
                    onChange={(e) => handleImplantatumDetailsChange(toothNumber, e.target.value)}
                    rows={2}
                    className="form-input"
                    placeholder="Pl. Straumann BLT 4.1x10mm, Gyári szám: 028.015, Dátum: 2023.05.15"
                    readOnly={isViewOnly}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Nem ismert pozíciókban implantátum */}
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center mb-3">
              <input
                {...register('nemIsmertPoziciokbanImplantatum')}
                type="checkbox"
                className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm font-medium text-gray-700">
                Nem ismert pozíciókban
              </label>
            </div>
            
            {nemIsmertPoziciokbanImplantatum && (
              <div className="ml-6">
                <label className="form-label">Részletek (típus, mennyiség, stb.)</label>
                <textarea
                  {...register('nemIsmertPoziciokbanImplantatumRészletek')}
                  rows={3}
                  className="form-input"
                  placeholder="Pl. Straumann implantátumok, pontos pozíció nem ismert, mennyiség: 3 db"
                  readOnly={isViewOnly}
                />
              </div>
            )}
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-4 pt-6 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
          >
            {isViewOnly ? 'Bezárás' : 'Mégse'}
          </button>
          {!isViewOnly && (
            <button
              type="submit"
              className="btn-primary"
            >
              {patient ? 'Beteg frissítése' : 'Beteg mentése'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}