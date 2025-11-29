'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Upload, Download, Plus, Loader2, X } from 'lucide-react';
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

export function PatientDocumentsList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [showUploadForm, setShowUploadForm] = useState(false);

  useEffect(() => {
    fetchDocuments();
  }, []);

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

  const handleDownload = async (document: Document) => {
    try {
      const response = await fetch(`/api/patient-portal/documents/${document.id}/download`, {
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
      a.download = document.filename;
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-medical-primary" />
            Dokumentumok
          </h1>
          <p className="text-gray-600 mt-2">
            Itt találhatja az összes dokumentumát és tölthet fel újakat.
          </p>
        </div>
        <button
          onClick={() => setShowUploadForm(!showUploadForm)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Dokumentum feltöltése</span>
          <span className="sm:hidden">Feltöltés</span>
        </button>
      </div>

      {/* Upload Form */}
      {showUploadForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Dokumentum feltöltése
            </h2>
            <button
              onClick={() => setShowUploadForm(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <DocumentUploadForm
            onSuccess={() => {
              setShowUploadForm(false);
              fetchDocuments();
            }}
          />
        </div>
      )}

      {/* Documents List */}
      {documents.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Nincsenek dokumentumok
          </h3>
          <p className="text-gray-600 mb-6">
            Még nincs feltöltött dokumentuma. Töltsön fel dokumentumot a "Dokumentum feltöltése" gombbal.
          </p>
          <button
            onClick={() => setShowUploadForm(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Dokumentum feltöltése
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="divide-y">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <p className="font-medium text-gray-900 truncate">
                        {doc.filename}
                      </p>
                    </div>
                    {doc.description && (
                      <p className="text-sm text-gray-600 mb-1">{doc.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{formatFileSize(doc.fileSize)}</span>
                      <span>
                        {format(new Date(doc.uploadedAt), 'yyyy. MMMM d.', { locale: hu })}
                      </span>
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex gap-1">
                          {doc.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownload(doc)}
                    className="btn-secondary flex items-center gap-2 flex-shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Letöltés</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Document Upload Form Component
function DocumentUploadForm({ onSuccess }: { onSuccess: () => void }) {
  const { showToast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFile) {
      showToast('Kérjük, válasszon fájlt', 'error');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (description.trim()) {
        formData.append('description', description.trim());
      }
      formData.append('tags', JSON.stringify([])); // Empty tags for patient uploads

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
      setSelectedFile(null);
      setDescription('');
      onSuccess();
    } catch (error) {
      console.error('Hiba a dokumentum feltöltésekor:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt a dokumentum feltöltésekor',
        'error'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="form-label">Fájl kiválasztása</label>
        <input
          type="file"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          className="form-input"
          required
          disabled={uploading}
        />
        {selectedFile && (
          <p className="text-sm text-gray-600 mt-1">
            Kiválasztott fájl: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </div>

      <div>
        <label className="form-label">Leírás (opcionális)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="form-input"
          rows={3}
          placeholder="Dokumentum leírása..."
          disabled={uploading}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="btn-primary flex items-center gap-2 flex-1"
          disabled={uploading || !selectedFile}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Feltöltés...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Feltöltés
            </>
          )}
        </button>
      </div>
    </form>
  );
}

