'use client';

import { useState, useEffect, useRef } from 'react';
import { PatientDocument } from '@/lib/types';
import { Upload, File, Download, Trash2, X, Tag, Plus, Package, AlertTriangle, Loader2 } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { formatDateForDisplay } from '@/lib/dateUtils';
import { useToast } from '@/contexts/ToastContext';
import { logEvent } from '@/lib/event-logger';

interface PatientDocumentsProps {
  patientId: string | null;
  isViewOnly?: boolean;
  canUpload?: boolean;
  canDelete?: boolean;
  onSavePatientBeforeUpload?: () => Promise<string | null>; // Returns patientId or null
  isPatientDirty?: boolean;
}

export function PatientDocuments({ 
  patientId, 
  isViewOnly = false, 
  canUpload = false, 
  canDelete = false,
  onSavePatientBeforeUpload,
  isPatientDirty = false
}: PatientDocumentsProps) {
  const { showToast, confirm: confirmDialog } = useToast();
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [filteredTags, setFilteredTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedTagIndex, setSelectedTagIndex] = useState(-1);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagSuggestionsRef = useRef<HTMLDivElement>(null);
  const [userRole, setUserRole] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [fileAccept, setFileAccept] = useState<string | undefined>(undefined);
  const [neakExportLoading, setNeakExportLoading] = useState(false);
  const [neakExportStatus, setNeakExportStatus] = useState<{
    isReady: boolean;
    missingDocTags: string[];
  } | null>(null);

  useEffect(() => {
    const checkRole = async () => {
      const user = await getCurrentUser();
      if (user) {
        setUserRole(user.role);
      }
    };
    checkRole();
  }, []);

  useEffect(() => {
    if (patientId) {
      loadDocuments();
    }
    // Load tags regardless of patientId - tags are global
    loadAvailableTags();
  }, [patientId]);

  const loadAvailableTags = async () => {
    try {
      const response = await fetch('/api/patients/documents/tags');
      if (response.ok) {
        const data = await response.json();
        setAvailableTags(data.tags || []);
        console.log('Loaded available tags:', data.tags);
      } else {
        console.error('Failed to load tags:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error loading available tags:', error);
    }
  };

  // Update file accept attribute based on tags
  useEffect(() => {
    const hasOPTag = tags.some(tag => 
      tag.toLowerCase() === 'op' || 
      tag.toLowerCase() === 'orthopantomogram'
    );
    setFileAccept(hasOPTag ? 'image/*' : undefined);
    
    // Also update the input element's accept attribute if ref is available
    if (fileInputRef.current) {
      if (hasOPTag) {
        fileInputRef.current.setAttribute('accept', 'image/*');
      } else {
        fileInputRef.current.removeAttribute('accept');
      }
    }
  }, [tags]);

  // Filter tags based on input
  useEffect(() => {
    if (newTag.trim() === '') {
      setFilteredTags([]);
      setShowTagSuggestions(false);
      return;
    }

    // Only filter if we have tags loaded
    if (availableTags.length === 0) {
      setFilteredTags([]);
      setShowTagSuggestions(false);
      return;
    }

    const term = newTag.toLowerCase();
    const filtered = availableTags
      .filter(tag => 
        tag && 
        typeof tag === 'string' &&
        tag.toLowerCase().includes(term) && 
        !tags.includes(tag) // Don't show already added tags
      )
      .slice(0, 10); // Maximum 10 suggestions

    setFilteredTags(filtered);
    setShowTagSuggestions(filtered.length > 0);
    setSelectedTagIndex(-1);
  }, [newTag, availableTags, tags]);

  const loadDocuments = async () => {
    if (!patientId) return;
    
    try {
      setLoading(true);
      const response = await fetch(`/api/patients/${patientId}/documents`);
      if (!response.ok) {
        throw new Error('Failed to load documents');
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Error loading documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Check if OP tag is selected and validate all files are images
    const hasOPTag = tags.some(tag => 
      tag.toLowerCase() === 'op' || 
      tag.toLowerCase() === 'orthopantomogram'
    );
    
    if (hasOPTag) {
      const invalidFiles = fileArray.filter(file => !file.type.startsWith('image/'));
      if (invalidFiles.length > 0) {
        showToast('OP tag-gel csak képfájlok tölthetők fel. Kérjük, válasszon ki képfájlokat vagy távolítsa el az OP tag-et.', 'error');
        return;
      }
    }

    // Check if foto tag is selected and validate all files are images
    const hasFotoTag = tags.some(tag => 
      tag.toLowerCase() === 'foto'
    );
    
    if (hasFotoTag) {
      const invalidFiles = fileArray.filter(file => !file.type.startsWith('image/'));
      if (invalidFiles.length > 0) {
        showToast('Foto tag-gel csak képfájlok tölthetők fel. Kérjük, válasszon ki képfájlokat vagy távolítsa el a foto tag-et.', 'error');
        return;
      }
    }
    
    setSelectedFiles(fileArray);
    setShowUploadForm(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    // Validate: OP tag can only be used with image files
    const hasOPTag = tags.some(tag => 
      tag.toLowerCase() === 'op' || 
      tag.toLowerCase() === 'orthopantomogram'
    );
    
    if (hasOPTag) {
      const invalidFiles = selectedFiles.filter(file => !file.type.startsWith('image/'));
      if (invalidFiles.length > 0) {
        showToast('OP tag-gel csak képfájlok tölthetők fel. Kérjük, válasszon ki képfájlokat vagy távolítsa el az OP tag-et.', 'error');
        return;
      }
    }

    // Validate: foto tag can only be used with image files
    const hasFotoTag = tags.some(tag => 
      tag.toLowerCase() === 'foto'
    );
    
    if (hasFotoTag) {
      const invalidFiles = selectedFiles.filter(file => !file.type.startsWith('image/'));
      if (invalidFiles.length > 0) {
        showToast('Foto tag-gel csak képfájlok tölthetők fel. Kérjük, válasszon ki képfájlokat vagy távolítsa el a foto tag-et.', 'error');
        return;
      }
    }

    // Check if patient needs to be saved first
    let currentPatientId = patientId;
    if ((!currentPatientId || isPatientDirty) && onSavePatientBeforeUpload) {
      try {
        const savedPatientId = await onSavePatientBeforeUpload();
        if (!savedPatientId) {
          showToast('A beteg mentése szükséges a dokumentum feltöltéséhez. Kérjük, mentse el először a beteg adatait.', 'error');
          return;
        }
        currentPatientId = savedPatientId;
        // Reload documents with new patient ID
        if (currentPatientId) {
          await loadDocuments();
        }
      } catch (error: any) {
        console.error('Error saving patient before upload:', error);
        const errorMessage = error instanceof Error ? error.message : 'Hiba történt a beteg mentésekor';
        showToast(`Hiba a beteg mentésekor: ${errorMessage}. A dokumentum feltöltése megszakadt.`, 'error');
        return;
      }
    }

    if (!currentPatientId) {
      showToast('Hiba: A beteg ID nem elérhető. Kérjük, mentse el először a beteg adatait.', 'error');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      const uploadedDocuments: PatientDocument[] = [];
      let successCount = 0;
      let errorCount = 0;

      // Upload each file with the same tags and description
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        try {
          const formData = new FormData();
          formData.append('file', file);
          if (description.trim()) {
            formData.append('description', description.trim());
          }
          // Always send tags, even if empty array
          console.log('Sending tags:', tags);
          formData.append('tags', JSON.stringify(tags));

          const response = await fetch(`/api/patients/${currentPatientId}/documents`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
          }

          const data = await response.json();
          uploadedDocuments.push(data.document);
          successCount++;
          
          // Update progress
          setUploadProgress(Math.round(((i + 1) / selectedFiles.length) * 100));
        } catch (error) {
          console.error(`Error uploading file ${file.name}:`, error);
          errorCount++;
        }
      }

      if (uploadedDocuments.length > 0) {
        setDocuments([...uploadedDocuments, ...documents]);
        // Reload available tags to include any new tags
        loadAvailableTags();
      }

      // Show success/error message
      if (successCount > 0 && errorCount === 0) {
        showToast(`${successCount} fájl sikeresen feltöltve`, 'success');
      } else if (successCount > 0 && errorCount > 0) {
        showToast(`${successCount} fájl feltöltve, ${errorCount} fájl hibával`, 'error');
      } else {
        showToast('Hiba történt a fájlok feltöltésekor', 'error');
      }
      
      // Reset form
      setSelectedFiles([]);
      setDescription('');
      setTags([]);
      setNewTag('');
      setShowUploadForm(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error uploading documents:', error);
      showToast(error instanceof Error ? error.message : 'Hiba történt a feltöltés során', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDownload = async (doc: PatientDocument) => {
    if (!patientId) return;

    try {
      const response = await fetch(`/api/patients/${patientId}/documents/${doc.id}`);
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading document:', error);
      showToast('Hiba történt a letöltés során', 'error');
    }
  };

  const handleDelete = async (doc: PatientDocument) => {
    if (!patientId) return;

    const confirmed = await confirmDialog(
      `Biztosan törölni szeretné a "${doc.filename}" dokumentumot?`,
      {
        title: 'Dokumentum törlése',
        confirmText: 'Törlés',
        cancelText: 'Mégse',
        type: 'danger'
      }
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/patients/${patientId}/documents/${doc.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Ismeretlen hiba' }));
        throw new Error(errorData.error || 'Törlés sikertelen');
      }

      const data = await response.json();
      setDocuments(documents.filter(d => d.id !== doc.id));
      
      // Show success message
      showToast(data.message || 'Dokumentum sikeresen törölve', 'success');
    } catch (error) {
      console.error('Error deleting document:', error);
      const errorMessage = error instanceof Error ? error.message : 'Hiba történt a törlés során';
      showToast(errorMessage, 'error');
    }
  };

  const addTag = (tagToAdd?: string) => {
    const tag = tagToAdd || newTag.trim();
    if (tag && !tags.includes(tag)) {
      // Check if adding OP tag and selected files are not images
      const isOPTag = tag.toLowerCase() === 'op' || tag.toLowerCase() === 'orthopantomogram';
      if (isOPTag && selectedFiles.length > 0) {
        const invalidFiles = selectedFiles.filter(file => !file.type.startsWith('image/'));
        if (invalidFiles.length > 0) {
          showToast('OP tag-gel csak képfájlok tölthetők fel. Kérjük, válasszon ki képfájlokat vagy távolítsa el a nem képfájlokat.', 'error');
          return;
        }
      }

      // Check if adding foto tag and selected files are not images
      const isFotoTag = tag.toLowerCase() === 'foto';
      if (isFotoTag && selectedFiles.length > 0) {
        const invalidFiles = selectedFiles.filter(file => !file.type.startsWith('image/'));
        if (invalidFiles.length > 0) {
          showToast('Foto tag-gel csak képfájlok tölthetők fel. Kérjük, válasszon ki képfájlokat vagy távolítsa el a nem képfájlokat.', 'error');
          return;
        }
      }
      
      setTags([...tags, tag]);
      setNewTag('');
      setShowTagSuggestions(false);
      setSelectedTagIndex(-1);
    }
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedTagIndex >= 0 && filteredTags[selectedTagIndex]) {
        addTag(filteredTags[selectedTagIndex]);
      } else if (newTag.trim()) {
        addTag();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedTagIndex(prev => 
        prev < filteredTags.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedTagIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Escape') {
      setShowTagSuggestions(false);
      setSelectedTagIndex(-1);
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tagInputRef.current &&
        !tagInputRef.current.contains(event.target as Node) &&
        tagSuggestionsRef.current &&
        !tagSuggestionsRef.current.contains(event.target as Node)
      ) {
        setShowTagSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  // NEAK Export handler
  const handleNeakExport = async () => {
    if (!patientId) {
      showToast('Beteg ID hiányzik', 'error');
      return;
    }

    try {
      setNeakExportLoading(true);
      setNeakExportStatus(null);

      // Check feature flag (client-side check, server also validates)
      const enableNeakExport = process.env.NEXT_PUBLIC_ENABLE_NEAK_EXPORT === 'true';
      if (!enableNeakExport) {
        showToast('NEAK export funkció nincs engedélyezve', 'error');
        return;
      }

      // Dry-run: Check if ready
      const dryRunResponse = await fetch(`/api/patients/${patientId}/export-neak?dryRun=1`, {
        credentials: 'include',
      });

      if (!dryRunResponse.ok) {
        const errorData = await dryRunResponse.json().catch(() => ({}));
        if (errorData.code === 'FEATURE_DISABLED') {
          showToast('NEAK export funkció nincs engedélyezve', 'error');
          return;
        }
        throw new Error(errorData.error || 'Dry-run hiba');
      }

      const dryRunData = await dryRunResponse.json();

      // Log attempt
      logEvent('neak_export_attempt', {
        patientIdHash: patientId ? patientId.substring(0, 8) : null,
        isReady: dryRunData.isReady,
        missingDocTags: dryRunData.missingDocTags || [],
      }, dryRunData.correlationId);

      if (!dryRunData.isReady) {
        // Show missing tags
        setNeakExportStatus({
          isReady: false,
          missingDocTags: dryRunData.missingDocTags || [],
        });
        showToast(
          `Hiányoznak kötelező dokumentumok: ${dryRunData.missingDocTags?.join(', ') || 'ismeretlen'}`,
          'info'
        );
        return;
      }

      // Ready: Start export
      const exportResponse = await fetch(`/api/patients/${patientId}/export-neak`, {
        credentials: 'include',
      });

      if (!exportResponse.ok) {
        const errorData = await exportResponse.json().catch(() => ({}));
        if (errorData.code === 'MISSING_REQUIRED_DOCS') {
          setNeakExportStatus({
            isReady: false,
            missingDocTags: errorData.details?.missingDocTags || [],
          });
          showToast('Hiányoznak kötelező dokumentumok', 'error');
          logEvent('neak_export_fail', {
            patientIdHash: patientId ? patientId.substring(0, 8) : null,
            errorCode: errorData.code,
            missingDocTags: errorData.details?.missingDocTags || [],
          }, errorData.correlationId);
          return;
        }
        throw new Error(errorData.error || 'Export hiba');
      }

      // Download ZIP
      // IMPORTANT: Wait for blob to fully download before logging success
      // This ensures the ZIP stream was fully written on the server
      const blob = await exportResponse.blob();
      
      // Verify blob is not empty (basic sanity check)
      if (blob.size === 0) {
        throw new Error('Downloaded ZIP is empty - export may have failed');
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NEAK_${patientId}_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // Log success ONLY after ZIP is fully downloaded and verified
      // This ensures the archive.on("end") event fired on the server
      showToast('NEAK export sikeresen letöltve', 'success');
      logEvent('neak_export_success', {
        patientIdHash: patientId ? patientId.substring(0, 8) : null,
        estimatedTotalBytes: dryRunData.estimatedTotalBytes,
        actualDownloadSize: blob.size,
      }, dryRunData.correlationId);
    } catch (error) {
      console.error('NEAK export error:', error);
      showToast(error instanceof Error ? error.message : 'Hiba történt az export során', 'error');
      logEvent('neak_export_fail', {
        patientIdHash: patientId ? patientId.substring(0, 8) : null,
        errorName: error instanceof Error ? error.constructor.name : 'Unknown',
      });
    } finally {
      setNeakExportLoading(false);
    }
  };

  if (!patientId) {
    return (
      <div className="card">
        <p className="text-gray-500 text-sm">Mentse el a beteget a dokumentumok feltöltéséhez</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-lg font-semibold text-gray-900 flex items-center">
          <File className="w-5 h-5 mr-2 text-medical-primary" />
          DOKUMENTUMOK ({documents.length})
        </h4>
        <div className="flex gap-2">
          {process.env.NEXT_PUBLIC_ENABLE_NEAK_EXPORT === 'true' && patientId && (
            <button
              onClick={handleNeakExport}
              disabled={neakExportLoading}
              className="btn-secondary text-sm"
            >
              {neakExportLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Export...
                </>
              ) : (
                <>
                  <Package className="w-4 h-4 mr-2" />
                  NEAK Export
                </>
              )}
            </button>
          )}
          {canUpload && !isViewOnly && (
            <button
              onClick={() => {
                setShowUploadForm(!showUploadForm);
                if (!showUploadForm && fileInputRef.current) {
                  fileInputRef.current.click();
                }
              }}
              className="btn-primary text-sm"
            >
              <Upload className="w-4 h-4 mr-2" />
              Feltöltés
            </button>
          )}
        </div>
      </div>

      {/* NEAK Export Status */}
      {neakExportStatus && !neakExportStatus.isReady && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h5 className="text-sm font-semibold text-amber-800 mb-2">
                Hiányoznak kötelező dokumentumok
              </h5>
              <p className="text-sm text-amber-700 mb-2">
                Az alábbi tag-ekkel rendelkező dokumentumok hiányoznak:
              </p>
              <ul className="list-disc list-inside text-sm text-amber-700 mb-3">
                {neakExportStatus.missingDocTags.map((tag) => (
                  <li key={tag}>{tag.toUpperCase()}</li>
                ))}
              </ul>
              <button
                onClick={() => {
                  setNeakExportStatus(null);
                  setShowUploadForm(true);
                  if (fileInputRef.current) {
                    fileInputRef.current.click();
                  }
                }}
                className="text-sm text-amber-800 hover:text-amber-900 underline"
              >
                Ugrás dokumentum feltöltéshez →
              </button>
            </div>
            <button
              onClick={() => setNeakExportStatus(null)}
              className="text-amber-600 hover:text-amber-800 ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Upload Form */}
      {showUploadForm && canUpload && !isViewOnly && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fájl kiválasztása
              </label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-medical-primary bg-medical-primary/5'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={fileAccept}
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileSelect(e.target.files);
                    }
                  }}
                />
                <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-600">
                  {selectedFiles.length > 0 
                    ? `${selectedFiles.length} fájl kiválasztva` 
                    : 'Kattintson vagy húzza ide a fájlokat'}
                </p>
                {selectedFiles.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Összesen: {formatFileSize(selectedFiles.reduce((sum, file) => sum + file.size, 0))}
                  </p>
                )}
              </div>
            </div>

            {selectedFiles.length > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Kiválasztott fájlok ({selectedFiles.length})
                  </label>
                  <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                    <ul className="space-y-1">
                      {selectedFiles.map((file, index) => (
                        <li key={index} className="text-sm text-gray-700 flex items-center justify-between">
                          <span className="flex-1 truncate">{file.name}</span>
                          <span className="text-xs text-gray-500 ml-2">{formatFileSize(file.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Leírás (opcionális - minden fájlhoz ugyanaz)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="form-input"
                    rows={3}
                    placeholder="Dokumentum leírása..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Címkék
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-medical-primary text-white"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="ml-2 hover:text-gray-200"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="relative flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        ref={tagInputRef}
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={handleTagInputKeyDown}
                        onFocus={() => {
                          // Re-trigger filtering when input is focused
                          if (newTag.trim() && availableTags.length > 0) {
                            const term = newTag.toLowerCase();
                            const filtered = availableTags
                              .filter(tag => 
                                tag && 
                                typeof tag === 'string' &&
                                tag.toLowerCase().includes(term) && 
                                !tags.includes(tag)
                              )
                              .slice(0, 10);
                            setFilteredTags(filtered);
                            setShowTagSuggestions(filtered.length > 0);
                          }
                        }}
                        className="form-input w-full"
                        placeholder="Új címke (pl. OP, orthopantomogram) - Enter vagy + gomb a hozzáadáshoz"
                      />
                      {showTagSuggestions && filteredTags.length > 0 && (
                        <div
                          ref={tagSuggestionsRef}
                          className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto"
                        >
                          {filteredTags.map((tag, index) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => addTag(tag)}
                              className={`w-full text-left px-4 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${
                                index === selectedTagIndex ? 'bg-gray-100' : ''
                              }`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => addTag()}
                      className="btn-secondary"
                      disabled={!newTag.trim()}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUploadForm(false);
                      setSelectedFiles([]);
                      setDescription('');
                      setTags([]);
                      setNewTag('');
                    }}
                    className="btn-secondary"
                  >
                    Mégse
                  </button>
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={uploading || selectedFiles.length === 0}
                    className="btn-primary"
                  >
                    {uploading 
                      ? `Feltöltés... (${selectedFiles.length} fájl)` 
                      : `Feltöltés (${selectedFiles.length} fájl)`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Documents List */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Betöltés...</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <File className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>Nincsenek dokumentumok</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <File className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {doc.filename}
                    </p>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <span>{formatFileSize(doc.fileSize || 0)}</span>
                      {doc.uploadedAt && (
                        <span>{formatDateForDisplay(doc.uploadedAt)}</span>
                      )}
                      {doc.uploadedByName && (
                        <span>Feltöltötte: {doc.uploadedByName}</span>
                      )}
                    </div>
                    {doc.description && (
                      <p className="text-xs text-gray-600 mt-1">{doc.description}</p>
                    )}
                    {doc.tags && Array.isArray(doc.tags) && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {doc.tags.map((tag: string) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                          >
                            <Tag className="w-3 h-3 mr-1" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => handleDownload(doc)}
                  className="p-2 text-gray-600 hover:text-medical-primary hover:bg-gray-100 rounded"
                  title="Letöltés"
                >
                  <Download className="w-5 h-5" />
                </button>
                {canDelete && (
                  <button
                    onClick={() => handleDelete(doc)}
                    className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Törlés"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

