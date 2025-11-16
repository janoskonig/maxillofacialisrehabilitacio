'use client';

import { useState, useEffect, useRef } from 'react';
import { PatientDocument } from '@/lib/types';
import { Upload, File, Download, Trash2, X, Tag, Plus } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { formatDateForDisplay } from '@/lib/dateUtils';

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
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

  const handleFileSelect = (file: File) => {
    if (file) {
      setSelectedFile(file);
      setShowUploadForm(true);
    }
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
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    // Check if patient needs to be saved first
    let currentPatientId = patientId;
    if ((!currentPatientId || isPatientDirty) && onSavePatientBeforeUpload) {
      try {
        const savedPatientId = await onSavePatientBeforeUpload();
        if (!savedPatientId) {
          alert('A beteg mentése szükséges a dokumentum feltöltéséhez. Kérjük, mentse el először a beteg adatait.');
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
        alert(`Hiba a beteg mentésekor: ${errorMessage}. A dokumentum feltöltése megszakadt.`);
        return;
      }
    }

    if (!currentPatientId) {
      alert('Hiba: A beteg ID nem elérhető. Kérjük, mentse el először a beteg adatait.');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('file', selectedFile);
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
      setDocuments([data.document, ...documents]);
      
      // Reload available tags to include any new tags
      loadAvailableTags();
      
      // Reset form
      setSelectedFile(null);
      setDescription('');
      setTags([]);
      setNewTag('');
      setShowUploadForm(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      alert(error instanceof Error ? error.message : 'Hiba történt a feltöltés során');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDownload = async (document: PatientDocument) => {
    if (!patientId) return;

    try {
      const response = await fetch(`/api/patients/${patientId}/documents/${document.id}`);
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = document.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading document:', error);
      alert('Hiba történt a letöltés során');
    }
  };

  const handleDelete = async (document: PatientDocument) => {
    if (!patientId || !confirm(`Biztosan törölni szeretné a "${document.filename}" dokumentumot?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/patients/${patientId}/documents/${document.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Ismeretlen hiba' }));
        throw new Error(errorData.error || 'Törlés sikertelen');
      }

      const data = await response.json();
      setDocuments(documents.filter(doc => doc.id !== document.id));
      
      // Show success message
      alert(data.message || 'Dokumentum sikeresen törölve');
    } catch (error) {
      console.error('Error deleting document:', error);
      const errorMessage = error instanceof Error ? error.message : 'Hiba történt a törlés során';
      alert(errorMessage);
    }
  };

  const addTag = (tagToAdd?: string) => {
    const tag = tagToAdd || newTag.trim();
    if (tag && !tags.includes(tag)) {
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
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
                <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-600">
                  {selectedFile ? selectedFile.name : 'Kattintson vagy húzza ide a fájlt'}
                </p>
                {selectedFile && (
                  <p className="text-xs text-gray-500 mt-1">
                    {formatFileSize(selectedFile.size)}
                  </p>
                )}
              </div>
            </div>

            {selectedFile && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Leírás (opcionális)
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
                      setSelectedFile(null);
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
                    disabled={uploading}
                    className="btn-primary"
                  >
                    {uploading ? 'Feltöltés...' : 'Feltöltés'}
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
                      {doc.uploadedBy && (
                        <span>Feltöltötte: {doc.uploadedBy}</span>
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

