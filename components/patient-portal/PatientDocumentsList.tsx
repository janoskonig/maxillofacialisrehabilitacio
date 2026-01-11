'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Upload, Download, Plus, Loader2, X, Image as ImageIcon, File } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';

interface Document {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string | null;
  description: string | null;
  tags: string[];
  uploadedAt: string;
}

interface DocumentUploadCardProps {
  title: string;
  description: string;
  tag: string;
  icon: React.ReactNode;
  onUpload: (file: File, tag: string, description?: string) => Promise<void>;
  uploadedDocuments: Document[];
  patientId: string;
}

function DocumentUploadCard({ title, description, tag, icon, onUpload, uploadedDocuments, patientId }: DocumentUploadCardProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [descriptionText, setDescriptionText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const handleFileSelect = (file: File) => {
    // Validate image for foto tag
    if (tag === 'foto' && !file.type.startsWith('image/')) {
      showToast('Önarcképhez csak képfájl tölthető fel', 'error');
      return;
    }
    // Validate image for op tag
    if (tag === 'op' && !file.type.startsWith('image/')) {
      showToast('OP-hez csak képfájl tölthető fel', 'error');
      return;
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      await onUpload(selectedFile, tag, descriptionText);
      setSelectedFile(null);
      setDescriptionText('');
      setShowUpload(false);
    } catch (error) {
      console.error('Upload error:', error);
      showToast(error instanceof Error ? error.message : 'Hiba történt a feltöltéskor', 'error');
    } finally {
      setUploading(false);
    }
  };

  const documentsWithTag = uploadedDocuments.filter(doc => 
    doc.tags && Array.isArray(doc.tags) && doc.tags.includes(tag)
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
            {icon}
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">{title}</h3>
            <p className="text-xs sm:text-sm text-gray-600 mt-0.5">{description}</p>
          </div>
        </div>
        {!showUpload && (
          <button
            onClick={() => setShowUpload(true)}
            className="btn-primary flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
          >
            <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Feltöltés</span>
          </button>
        )}
      </div>

      {showUpload && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs sm:text-sm font-medium text-gray-700">Fájl feltöltése</span>
            <button
              onClick={() => {
                setShowUpload(false);
                setSelectedFile(null);
                setDescriptionText('');
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
            className="hidden"
            accept={tag === 'foto' || tag === 'op' ? 'image/*' : undefined}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary w-full text-xs sm:text-sm py-2 mb-2"
          >
            {selectedFile ? selectedFile.name : 'Fájl kiválasztása'}
          </button>
          {selectedFile && (
            <div className="mb-2">
              <textarea
                value={descriptionText}
                onChange={(e) => setDescriptionText(e.target.value)}
                placeholder="Leírás (opcionális)"
                className="form-input text-xs sm:text-sm w-full"
                rows={2}
              />
            </div>
          )}
          {selectedFile && (
            <div className="flex gap-2">
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="btn-primary flex-1 text-xs sm:text-sm py-1.5 sm:py-2 flex items-center justify-center gap-1.5"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
                    Feltöltés...
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Feltöltés
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Uploaded documents count */}
      {documentsWithTag.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <p className="text-xs sm:text-sm text-gray-600">
            Feltöltött dokumentumok: <span className="font-semibold text-gray-900">{documentsWithTag.length}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// General Document Upload Form Component
function GeneralDocumentUploadForm({ 
  onUpload, 
  onSuccess 
}: { 
  onUpload: (file: File, tag: string, description?: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!selectedFile) {
      showToast('Kérjük, válasszon fájlt', 'error');
      return;
    }

    if (!description.trim()) {
      showToast('Kérjük, adja meg a dokumentum leírását', 'error');
      return;
    }

    setUploading(true);
    try {
      // No specific tag for general documents, just use description
      await onUpload(selectedFile, '', description.trim());
      setSelectedFile(null);
      setDescription('');
      onSuccess();
    } catch (error) {
      console.error('Upload error:', error);
      showToast(error instanceof Error ? error.message : 'Hiba történt a feltöltéskor', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setSelectedFile(file);
        }}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="btn-secondary w-full text-xs sm:text-sm py-2"
      >
        {selectedFile ? selectedFile.name : 'Fájl kiválasztása'}
      </button>
      
      {selectedFile && (
        <>
          <div>
            <label className="form-label text-xs sm:text-sm">
              Dokumentum leírása <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pl. Orvosi lelet, Labor eredmény, stb."
              className="form-input text-xs sm:text-sm w-full"
              rows={3}
              required
              disabled={uploading}
            />
            <p className="text-[10px] sm:text-xs text-gray-500 mt-1">
              Kérjük, adja meg, hogy milyen típusú dokumentumot tölt fel
            </p>
          </div>
          
          <button
            onClick={handleUpload}
            disabled={uploading || !description.trim()}
            className="btn-primary w-full text-xs sm:text-sm py-1.5 sm:py-2 flex items-center justify-center gap-1.5"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
                Feltöltés...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                Feltöltés
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

export function PatientDocumentsList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [patientId, setPatientId] = useState<string | null>(null);

  useEffect(() => {
    fetchPatientInfo();
    fetchDocuments();
  }, []);

  const fetchPatientInfo = async () => {
    try {
      const response = await fetch('/api/patient-portal/patient', {
        credentials: 'include',
      });

      if (!response.ok || response.status === 401) {
        router.push('/patient-portal');
        return;
      }

      const data = await response.json();
      if (data.patient) {
        setPatientId(data.patient.id);
      }
    } catch (error) {
      console.error('Error fetching patient info:', error);
    }
  };

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/patient-portal/documents', {
        credentials: 'include',
      });

      if (!response.ok || response.status === 401) {
        router.push('/patient-portal');
        return;
      }

      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Hiba a dokumentumok betöltésekor:', error);
      showToast('Hiba történt a dokumentumok betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentUpload = async (file: File, tag: string, description?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    // Only add tag if it's not empty
    if (tag && tag.trim()) {
      formData.append('tags', JSON.stringify([tag]));
    } else {
      formData.append('tags', JSON.stringify([]));
    }
    if (description && description.trim()) {
      formData.append('description', description.trim());
    }

    const response = await fetch('/api/patient-portal/documents', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Hiba történt');
    }

    showToast('Dokumentum sikeresen feltöltve', 'success');
    await fetchDocuments();
  };

  const handleDownload = async (doc: Document) => {
    try {
      const response = await fetch(`/api/patient-portal/documents/${doc.id}/download`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Letöltés sikertelen');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      showToast('Dokumentum letöltve', 'success');
    } catch (error) {
      console.error('Hiba a dokumentum letöltésekor:', error);
      showToast('Hiba történt a dokumentum letöltésekor', 'error');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
        <span className="ml-3 text-gray-600">Betöltés...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 text-medical-primary flex-shrink-0" />
            Dokumentumok
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1 sm:mt-2">
            Itt találhatja az összes dokumentumát és tölthet fel újakat.
          </p>
        </div>
      </div>

      {/* Document Upload Cards */}
      <div className="space-y-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">
          Dokumentumok feltöltése
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DocumentUploadCard
            title="OP (máshol készített)"
            description="Máshol készített panorámaröntgen"
            tag="op"
            icon={<ImageIcon className="w-5 h-5 sm:w-6 sm:h-6" />}
            onUpload={handleDocumentUpload}
            uploadedDocuments={documents}
            patientId={patientId || ''}
          />
          <DocumentUploadCard
            title="Önarckép"
            description="Arc- és szájfotó"
            tag="foto"
            icon={<ImageIcon className="w-5 h-5 sm:w-6 sm:h-6" />}
            onUpload={handleDocumentUpload}
            uploadedDocuments={documents}
            patientId={patientId || ''}
          />
          <DocumentUploadCard
            title="Zárójelentés"
            description="Kezelés zárójelentése"
            tag="zarojelentes"
            icon={<FileText className="w-5 h-5 sm:w-6 sm:h-6" />}
            onUpload={handleDocumentUpload}
            uploadedDocuments={documents}
            patientId={patientId || ''}
          />
          <DocumentUploadCard
            title="Ambuláns lap"
            description="Ambuláns kezelési lap"
            tag="ambulans lap"
            icon={<FileText className="w-5 h-5 sm:w-6 sm:h-6" />}
            onUpload={handleDocumentUpload}
            uploadedDocuments={documents}
            patientId={patientId || ''}
          />
        </div>

        {/* General Document Upload */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-2 bg-gray-50 rounded-lg text-gray-600">
                <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-gray-900">Egyéb dokumentum</h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-0.5">Más típusú dokumentum feltöltése</p>
              </div>
            </div>
          </div>

          <GeneralDocumentUploadForm
            onUpload={handleDocumentUpload}
            onSuccess={fetchDocuments}
          />
        </div>
      </div>

      {/* All Documents List */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
          Összes dokumentum
        </h2>

        {documents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Még nincsenek dokumentumok</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map((doc) => {
              const getThumbnailUrl = (doc: Document) => {
                if (doc.mimeType && doc.mimeType.startsWith('image/')) {
                  return `/api/patient-portal/documents/${doc.id}/download?inline=true`;
                }
                return null;
              };
              const thumbnailUrl = getThumbnailUrl(doc);
              
              return (
                <div
                  key={doc.id}
                  className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                >
                  {/* Thumbnail */}
                  <div 
                    className="relative aspect-square bg-gray-100 cursor-pointer group"
                    onClick={() => window.open(`/api/patient-portal/documents/${doc.id}/download`, '_blank')}
                  >
                    {thumbnailUrl ? (
                      <>
                        <img
                          src={thumbnailUrl}
                          alt={doc.filename}
                          className="w-full h-full object-cover group-hover:opacity-75 transition-opacity"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).nextElementSibling;
                            if (fallback) fallback.classList.remove('hidden');
                          }}
                        />
                        <div className="hidden w-full h-full absolute inset-0 flex items-center justify-center bg-gray-100">
                          <ImageIcon className="w-12 h-12 text-gray-400" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <File className="w-12 h-12 text-gray-400" />
                      </div>
                    )}
                  </div>
                  
                  {/* Document Info */}
                  <div className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm sm:text-base text-gray-900 truncate mb-1" title={doc.filename}>
                          {doc.filename}
                        </p>
                        {doc.description && (
                          <p className="text-xs sm:text-sm text-gray-600 line-clamp-2 mb-2">{doc.description}</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 text-[10px] sm:text-xs text-gray-500 mb-2 flex-wrap">
                      <span>{formatFileSize(doc.fileSize)}</span>
                      <span>•</span>
                      <span>{format(new Date(doc.uploadedAt), 'yyyy. MMMM d.', { locale: hu })}</span>
                    </div>
                    
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mb-2">
                        {doc.tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 sm:px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] sm:text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    <button
                      onClick={() => handleDownload(doc)}
                      className="btn-secondary w-full flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2"
                    >
                      <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      Letöltés
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
