'use client';

import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileText, ClipboardList, Loader2 } from 'lucide-react';
import { Patient } from '@/lib/types';
import { PatientDocument } from '@/lib/types';
import { getChecklistStatus, RequiredField } from '@/lib/clinical-rules';

interface ClinicalChecklistProps {
  patient: Patient | null | undefined;
  patientId?: string | null;
}

export function ClinicalChecklist({ patient, patientId }: ClinicalChecklistProps) {
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load documents if patientId is provided
  // Only fetch when patientId changes (not on every render)
  useEffect(() => {
    // Cleanup previous request if component unmounts or patientId changes
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!patientId) {
      setDocuments([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const loadDocuments = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/patients/${patientId}/documents`, {
          credentials: 'include',
          signal: abortController.signal,
        });
        
        if (abortController.signal.aborted) {
          return; // Component unmounted or patientId changed
        }

        if (!response.ok) {
          throw new Error(`Failed to load documents: ${response.status}`);
        }

        const data = await response.json();
        // PHI check: only store tags, not document content/metadata
        // We only need tags for the checklist, so we can safely extract just the tags
        const documentsWithTagsOnly: PatientDocument[] = (data.documents || []).map((doc: PatientDocument) => ({
          id: doc.id,
          tags: doc.tags || [],
          // Explicitly exclude any PHI fields (description, filename, etc.)
        }));
        
        setDocuments(documentsWithTagsOnly);
      } catch (error: any) {
        if (error.name === 'AbortError') {
          // Request was aborted, ignore
          return;
        }
        console.error('Error loading documents for checklist:', error);
        setError('Nem sikerült betölteni a dokumentumokat');
        // On error, set empty array so checklist still works (just shows missing docs)
        setDocuments([]);
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadDocuments();

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [patientId]); // Only re-fetch when patientId changes

  const status = getChecklistStatus(patient, documents);

  // Loading state
  if (loading && documents.length === 0) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <ClipboardList className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-semibold text-gray-900">Klinikai checklist</h3>
        </div>
        <div className="flex items-center gap-2 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <Loader2 className="w-5 h-5 text-gray-600 flex-shrink-0 animate-spin" />
          <span className="text-sm font-medium text-gray-700">Dokumentumok betöltése...</span>
        </div>
      </div>
    );
  }

  // Error state (non-blocking: still show checklist, but indicate error)
  const hasError = error !== null;

  if (status.isComplete && !hasError) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <ClipboardList className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-900">Klinikai checklist</h3>
        </div>
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
          <span className="text-sm font-medium text-green-800">Kész - minden kötelező adat és dokumentum megvan</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <ClipboardList className="w-5 h-5 text-amber-600" />
        <h3 className="text-lg font-semibold text-gray-900">Klinikai checklist</h3>
      </div>

      {/* Error Banner (non-blocking) */}
      {hasError && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span className="text-sm text-amber-800">{error}</span>
          </div>
        </div>
      )}

      {/* Summary Status */}
      <div className={`p-4 rounded-lg border mb-4 ${
        status.hasErrors 
          ? 'bg-red-50 border-red-200' 
          : status.hasWarnings 
          ? 'bg-amber-50 border-amber-200' 
          : 'bg-blue-50 border-blue-200'
      }`}>
        <div className="flex items-center gap-2">
          {status.hasErrors ? (
            <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          )}
          <span className={`text-sm font-medium ${
            status.hasErrors ? 'text-red-800' : 'text-amber-800'
          }`}>
            Hiányos - {status.missingFields.length} mező és {status.missingDocs.length} dokumentum hiányzik
          </span>
        </div>
      </div>

      {/* Missing Fields Section */}
      {status.missingFields.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Kötelező mezők
          </h4>
          <div className="space-y-2">
            {status.missingFields.map((field) => (
              <div
                key={field.key}
                className={`flex items-center gap-2 p-2 rounded ${
                  field.severity === 'error' 
                    ? 'bg-red-50 border border-red-200' 
                    : 'bg-amber-50 border border-amber-200'
                }`}
              >
                <XCircle className={`w-4 h-4 flex-shrink-0 ${
                  field.severity === 'error' ? 'text-red-600' : 'text-amber-600'
                }`} />
                <span className={`text-sm ${
                  field.severity === 'error' ? 'text-red-800' : 'text-amber-800'
                }`}>
                  {field.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Documents Section */}
      {status.missingDocs.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Kötelező dokumentumok
          </h4>
          <div className="space-y-2">
            {status.missingDocs.map((rule) => (
              <div
                key={rule.tag}
                className="flex items-center gap-2 p-2 rounded bg-amber-50 border border-amber-200"
              >
                <XCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="text-sm text-amber-800">
                  {rule.label}: {rule.actualCount} / {rule.minCount} db
                  {rule.actualCount > 0 && ` (hiányzik még ${rule.minCount - rule.actualCount} db)`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
