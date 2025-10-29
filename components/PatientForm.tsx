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
      nem: 'ferfi',
      radioterapia: false,
      chemoterapia: false,
      nemIsmertPoziciokbanImplantatum: false,
    },
  });

  const radioterapia = watch('radioterapia');
  const chemoterapia = watch('chemoterapia');
  const kezeleoorvos = watch('kezeleoorvos');
  const nemIsmertPoziciokbanImplantatum = watch('nemIsmertPoziciokbanImplantatum');
  const [implantatumok, setImplantatumok] = useState<Record<string, string>>(patient?.meglevoImplantatumok || {});

  // Implantátumok frissítése amikor patient változik
  useEffect(() => {
    if (patient?.meglevoImplantatumok) {
      setImplantatumok(patient.meglevoImplantatumok);
    } else {
      setImplantatumok({});
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

  const onSubmit = (data: Patient) => {
    onSave(data);
  };

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
              <label className="form-label">NÉV *</label>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Beutaló orvos</label>
              <input
                {...register('beutaloOrvos')}
                className="form-input"
                placeholder="Beutaló orvos neve"
                readOnly={isViewOnly}
              />
            </div>
            <div>
              <label className="form-label">Beutaló intézmény</label>
              <select {...register('beutaloIntezmeny')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                {beutaloIntezmenyOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Műtét rövid leírása</label>
              <textarea
                {...register('mutetRovidLeirasa')}
                rows={3}
                className="form-input"
                placeholder="Műtét rövid leírása"
                readOnly={isViewOnly}
              />
            </div>
            <div>
              <label className="form-label">Műtét ideje</label>
              <input
                {...register('mutetIdeje')}
                type="date"
                className="form-input"
                readOnly={isViewOnly}
              />
            </div>
            <div>
              <label className="form-label">Szövettani diagnózis</label>
              <input
                {...register('szovettaniDiagnozis')}
                className="form-input"
                placeholder="Szövettani diagnózis"
                readOnly={isViewOnly}
              />
            </div>
            <div>
              <label className="form-label">Nyaki blokkdisszekció</label>
              <select {...register('nyakiBlokkdisszekcio')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                {nyakiBlokkdisszekcioOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Adjuváns terápiák */}
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
                <label className="ml-2 text-sm text-gray-700">
                  Radioterápia
                </label>
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
                <label className="ml-2 text-sm text-gray-700">
                  Kemoterápia
                </label>
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
        </div>

        {/* ANAMNÉZIS ÉS BETEGVIZSGÁLAT */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
            ANAMNÉZIS ÉS BETEGVIZSGÁLAT
          </h4>
          <div className="space-y-4">
            {/* Alap kérdések */}
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
              </select>
            </div>
            <div>
              <label className="form-label">Fábián- és Fejérdy-féle protetikai osztály (a defektustól eltekintve)</label>
              <select {...register('fabianFejerdyProtetikaiOsztaly')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                {fabianFejerdyProtetikaiOsztalyOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
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
            <div>
              <label className="form-label">Felvétel dátuma</label>
              <input
                {...register('felvetelDatuma')}
                type="date"
                className="form-input"
                readOnly={isViewOnly}
              />
            </div>
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