'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileText, ClipboardList } from 'lucide-react';
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

  // Load documents if patientId is provided
  useEffect(() => {
    if (!patientId) {
      setDocuments([]);
      return;
    }

    const loadDocuments = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/patients/${patientId}/documents`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setDocuments(data.documents || []);
        }
      } catch (error) {
        console.error('Error loading documents for checklist:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDocuments();
  }, [patientId]);

  const status = getChecklistStatus(patient, documents);

  if (status.isComplete) {
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
            {status.missingDocs.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-2 p-2 rounded bg-amber-50 border border-amber-200"
              >
                <XCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="text-sm text-amber-800">
                  {tag.toUpperCase()} tag dokumentum
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
