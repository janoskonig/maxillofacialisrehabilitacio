'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Upload, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { MobileBottomSheet } from './mobile/MobileBottomSheet';
import { useBreakpoint } from '@/hooks/useBreakpoint';

interface Patient {
  id: string;
  nev: string | null;
  email: string | null;
}

interface DocumentRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDocumentUploaded: (messageText: string) => void;
  patientId?: string | null; // Páciens-orvos chatben automatikusan be van állítva
  chatType: 'patient-doctor' | 'doctor-doctor' | 'doctor-view-patient';
  selectedPatientId?: string | null; // Orvos-orvos chatben kiválasztott beteg (ha van)
  requestedTag?: string; // Előre kiválasztott dokumentum típus (ha kérésből jön)
  requestedPatientId?: string | null; // Előre kiválasztott beteg (ha kérésből jön)
  messageId?: string; // Az üzenet ID-ja, amire válaszolunk (ha van)
}

const DOCUMENT_TYPES = [
  { value: 'op', label: 'OP (máshol készített)', icon: ImageIcon, description: 'Máshol készített panorámaröntgen' },
  { value: 'foto', label: 'Önarckép', icon: ImageIcon, description: 'Arc- és szájfotó' },
  { value: 'zarojelentes', label: 'Zárójelentés', icon: FileText, description: 'Kezelés zárójelentése' },
  { value: 'ambulans lap', label: 'Ambuláns lap', icon: FileText, description: 'Ambuláns kezelési lap' },
  { value: '', label: 'Általános', icon: FileText, description: 'Más típusú dokumentum' },
] as const;

export function DocumentRequestModal({
  isOpen,
  onClose,
  onDocumentUploaded,
  patientId,
  chatType,
  selectedPatientId,
  requestedTag,
  requestedPatientId,
  messageId,
}: DocumentRequestModalProps) {
  const { showToast } = useToast();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [selectedType, setSelectedType] = useState<string | null>(requestedTag || null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientIdLocal, setSelectedPatientIdLocal] = useState<string | null>(
    requestedPatientId || selectedPatientId || null
  );
  const [loadingPatients, setLoadingPatients] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when modal opens/closes or requested values change
  useEffect(() => {
    if (isOpen) {
      setSelectedType(requestedTag || null);
      setSelectedPatientIdLocal(requestedPatientId || selectedPatientId || null);
    } else {
      setSelectedType(null);
      setSelectedFile(null);
      setDescription('');
      setSelectedPatientIdLocal(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [isOpen, requestedTag, requestedPatientId, selectedPatientId]);

  // Orvos-orvos chatben betegek betöltése (ha nincs selectedPatientId, de lehet requestedPatientId)
  useEffect(() => {
    if (isOpen && chatType === 'doctor-doctor' && !selectedPatientId) {
      fetchPatients();
    }
  }, [isOpen, chatType, selectedPatientId]);

  // Ha van selectedPatientId prop, használjuk
  useEffect(() => {
    if (selectedPatientId) {
      setSelectedPatientIdLocal(selectedPatientId);
    }
  }, [selectedPatientId]);

  // Amikor a betegek betöltődtek és van requestedPatientId, beállítjuk a kiválasztott beteget
  useEffect(() => {
    if (patients.length > 0 && requestedPatientId) {
      // Ellenőrizzük, hogy a beteg létezik-e a listában
      const patientExists = patients.some(p => p.id === requestedPatientId);
      if (patientExists && selectedPatientIdLocal !== requestedPatientId) {
        setSelectedPatientIdLocal(requestedPatientId);
      }
    }
  }, [patients, requestedPatientId, selectedPatientIdLocal]);

  const fetchPatients = async () => {
    try {
      setLoadingPatients(true);
      const response = await fetch('/api/patients?limit=1000', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a betegek betöltésekor');
      }

      const data = await response.json();
      setPatients(data.patients || []);
    } catch (error) {
      console.error('Hiba a betegek betöltésekor:', error);
      showToast('Hiba történt a betegek betöltésekor', 'error');
    } finally {
      setLoadingPatients(false);
    }
  };

  const handleFileSelect = (file: File) => {
    // Validáció: OP és foto csak képfájlokkal
    if (selectedType === 'op' || selectedType === 'foto') {
      if (!file.type.startsWith('image/')) {
        showToast('OP és önarcképhez csak képfájl tölthető fel', 'error');
        return;
      }
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    // Orvos-orvos chatben beteg választás kötelező
    if (chatType === 'doctor-doctor' && !selectedPatientIdLocal) {
      showToast('Kérjük, válasszon beteget', 'error');
      return;
    }

    if (!selectedFile) {
      showToast('Kérjük, válasszon fájlt', 'error');
      return;
    }

    const targetPatientId = chatType === 'patient-doctor' ? patientId : selectedPatientIdLocal;
    if (!targetPatientId) {
      showToast('Hiba: Beteg ID nem elérhető', 'error');
      return;
    }

    try {
      setUploading(true);

      const formData = new FormData();
      formData.append('file', selectedFile);
      if (description.trim()) {
        formData.append('description', description.trim());
      }
      const tags = selectedType ? [selectedType] : [];
      formData.append('tags', JSON.stringify(tags));

      // API endpoint meghatározása
      const apiEndpoint = chatType === 'patient-doctor'
        ? '/api/patient-portal/documents'
        : `/api/patients/${targetPatientId}/documents`;

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Feltöltés sikertelen');
      }

      const data = await response.json();
      const document = data.document || data;

      // Üzenet formátum: [DOCUMENT_UPLOADED:tag:patientId?:documentId] (válasz üzenet)
      const patientIdPart = chatType === 'doctor-doctor' ? `:${targetPatientId}` : '';
      const messageText = `[DOCUMENT_UPLOADED:${selectedType || ''}${patientIdPart}:${document.id}]`;

      // Callback hívása az üzenet küldéséhez
      onDocumentUploaded(messageText);

      // Reset és bezárás
      setSelectedType(null);
      setSelectedFile(null);
      setDescription('');
      setSelectedPatientIdLocal(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onClose();

      showToast('Dokumentum sikeresen feltöltve', 'success');
    } catch (error) {
      console.error('Hiba a dokumentum feltöltésekor:', error);
      showToast(error instanceof Error ? error.message : 'Hiba történt a feltöltéskor', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  // Beteg választó szükséges, ha orvos-orvos chatben vagyunk és nincs kiválasztott beteg (prop vagy requested)
  const needsPatientSelection = chatType === 'doctor-doctor' && !selectedPatientId && !requestedPatientId;
  const canUpload = !needsPatientSelection || selectedPatientIdLocal;

  const modalContent = (
    <>
      {/* Beteg választó (csak orvos-orvos chatben, ha nincs kiválasztva) */}
      {(needsPatientSelection || (chatType === 'doctor-doctor' && requestedPatientId && !selectedPatientId)) && (
        <div>
          <label className="form-label block mb-2">
            Beteg <span className="text-red-500">*</span>
          </label>
          {loadingPatients ? (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Betegek betöltése...</span>
            </div>
          ) : (
            <select
              value={selectedPatientIdLocal || ''}
              onChange={(e) => setSelectedPatientIdLocal(e.target.value || null)}
              className="form-input w-full"
              disabled={uploading}
            >
              <option value="">-- Válasszon beteget --</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.nev || patient.email || 'Névtelen beteg'}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Dokumentum típus választó */}
      <div>
        <label className="form-label block mb-3">
          Dokumentum típusa <span className="text-red-500">*</span>
        </label>
        <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
          {DOCUMENT_TYPES.map((type) => {
            const Icon = type.icon;
            const isSelected = selectedType === type.value;
            return (
              <button
                key={type.value || 'general'}
                type="button"
                onClick={() => setSelectedType(type.value)}
                disabled={uploading}
                className={`p-4 border-2 rounded-lg text-left transition-colors mobile-touch-target ${
                  isSelected
                    ? 'border-medical-primary bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                } ${uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${isSelected ? 'bg-medical-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className={`font-medium ${isSelected ? 'text-medical-primary' : 'text-gray-900'}`}>
                      {type.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{type.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fájl választó */}
      <div>
        <label className="form-label block mb-2">
          Fájl <span className="text-red-500">*</span>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
          className="hidden"
          accept={selectedType === 'op' || selectedType === 'foto' ? 'image/*' : undefined}
          disabled={uploading}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn-secondary w-full flex items-center justify-center gap-2 py-3 mobile-touch-target"
        >
          <Upload className="w-5 h-5" />
          {selectedFile ? selectedFile.name : 'Fájl kiválasztása'}
        </button>
        {selectedFile && (
          <div className="mt-2 text-sm text-gray-600">
            Kiválasztva: <span className="font-medium">{selectedFile.name}</span>
            {' '}({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
          </div>
        )}
      </div>

      {/* Leírás mező */}
      <div>
        <label className="form-label block mb-2">
          Leírás (opcionális)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="form-input w-full"
          rows={3}
          placeholder="Dokumentum leírása..."
          disabled={uploading}
        />
      </div>
    </>
  );

  const modalActions = (
    <>
      <button
        onClick={onClose}
        disabled={uploading}
        className="btn-secondary px-4 py-2 mobile-touch-target flex-1 sm:flex-none"
      >
        Mégse
      </button>
      <button
        onClick={handleUpload}
        disabled={uploading || !canUpload || !selectedFile || selectedType === null}
        className="btn-primary px-4 py-2 flex items-center gap-2 mobile-touch-target flex-1 sm:flex-none"
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="hidden sm:inline">Feltöltés...</span>
            <span className="sm:hidden">Feltöltés...</span>
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Feltöltés és küldés</span>
            <span className="sm:hidden">Feltöltés</span>
          </>
        )}
      </button>
    </>
  );

  // Mobile: BottomSheet
  if (isMobile) {
    return (
      <MobileBottomSheet
        open={isOpen}
        onOpenChange={onClose}
        title="Dokumentum feltöltése"
        type="dialog"
      >
        <div className="space-y-6 pb-4">
          {modalContent}
        </div>
        <div className="flex items-center gap-3 pt-4 border-t bg-gray-50 -mx-4 -mb-4 px-4 pb-4 mobile-safe-bottom">
          {modalActions}
        </div>
      </MobileBottomSheet>
    );
  }

  // Desktop: Modal
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Dokumentum feltöltése</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={uploading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {modalContent}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
          {modalActions}
        </div>
      </div>
    </div>
  );
}
