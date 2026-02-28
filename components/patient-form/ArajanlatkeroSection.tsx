'use client';

import { Dispatch, SetStateAction } from 'react';
import { formatDateForInput } from '@/lib/dateUtils';
import { FileText, Download, Send, Trash2, Plus } from 'lucide-react';
import { DatePicker } from '../DatePicker';

interface ArajanlatkeroSectionProps {
  isViewOnly: boolean;
  patientId: string | null;
  userRole: string;
  labQuoteRequests: Array<{ id: string; szoveg: string; datuma: string }>;
  setLabQuoteRequests: Dispatch<SetStateAction<Array<{ id: string; szoveg: string; datuma: string }>>>;
  newQuoteSzoveg: string;
  setNewQuoteSzoveg: Dispatch<SetStateAction<string>>;
  newQuoteDatuma: Date | null;
  setNewQuoteDatuma: Dispatch<SetStateAction<Date | null>>;
  currentPatientName: string | null | undefined;
  confirmDialog: (message: string, options?: { title?: string; confirmText?: string; cancelText?: string; type?: 'danger' | 'warning' | 'info' }) => Promise<boolean>;
  showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => string;
}

export function ArajanlatkeroSection({
  isViewOnly,
  patientId,
  userRole,
  labQuoteRequests,
  setLabQuoteRequests,
  newQuoteSzoveg,
  setNewQuoteSzoveg,
  newQuoteDatuma,
  setNewQuoteDatuma,
  currentPatientName,
  confirmDialog,
  showToast,
}: ArajanlatkeroSectionProps) {
  return (
    <div className="card">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <FileText className="w-5 h-5 mr-2 text-medical-primary" />
        Árajánlatkérő laborba
      </h4>
      <div className="space-y-4">
        {/* Árajánlatkérők listája */}
        {labQuoteRequests.length > 0 && (
          <div className="space-y-2">
            <label className="form-label">Mentett árajánlatkérők</label>
            {labQuoteRequests.map((quote) => (
              <div key={quote.id} className="bg-gray-50 p-3 rounded-md border border-gray-200 flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {new Date(quote.datuma).toLocaleDateString('hu-HU')}
                  </div>
                  <div className="text-xs text-gray-600 mt-1 line-clamp-2">
                    {quote.szoveg.substring(0, 100)}{quote.szoveg.length > 100 ? '...' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const response = await fetch(`/api/patients/${patientId}/generate-lab-quote-request-pdf?quoteId=${quote.id}`, {
                          method: 'GET',
                          credentials: 'include',
                        });

                        if (!response.ok) {
                          const errorData = await response.json();
                          throw new Error(errorData.error || 'PDF generálási hiba');
                        }

                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Arajanlatkero_${currentPatientName || 'Beteg'}_${Date.now()}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        showToast('PDF sikeresen generálva és letöltve', 'success');
                      } catch (error) {
                        console.error('PDF generálási hiba:', error);
                        showToast(
                          error instanceof Error ? error.message : 'Hiba történt a PDF generálása során',
                          'error'
                        );
                      }
                    }}
                    className="btn-secondary text-xs px-3 py-1 flex items-center gap-1"
                    title="PDF generálása"
                  >
                    <Download className="w-3 h-3" />
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmed = await confirmDialog(
                        'Biztosan elküldi az árajánlatkérőt emailben a laboratóriumnak?',
                        {
                          title: 'Email küldése',
                          confirmText: 'Igen, elküldöm',
                          cancelText: 'Mégse',
                          type: 'info'
                        }
                      );
                      if (!confirmed) return;

                      try {
                        showToast('Email küldése folyamatban...', 'info');
                        const response = await fetch(`/api/patients/${patientId}/lab-quote-requests/${quote.id}/send-email`, {
                          method: 'POST',
                          credentials: 'include',
                        });

                        if (!response.ok) {
                          const errorData = await response.json();
                          throw new Error(errorData.error || 'Email küldési hiba');
                        }

                        showToast('Email sikeresen elküldve a laboratóriumnak', 'success');
                      } catch (error) {
                        console.error('Email küldési hiba:', error);
                        showToast(
                          error instanceof Error ? error.message : 'Hiba történt az email küldése során',
                          'error'
                        );
                      }
                    }}
                    className="btn-secondary text-xs px-3 py-1 flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                    title="Email küldése a laboratóriumnak"
                  >
                    <Send className="w-3 h-3" />
                    Email
                  </button>
                  {!isViewOnly && (userRole === 'admin' || userRole === 'editor') && (
                    <button
                      type="button"
                      onClick={async () => {
                        const confirmed = await confirmDialog(
                          'Biztosan törölni szeretné ezt az árajánlatkérőt?',
                          {
                            title: 'Árajánlatkérő törlése',
                            confirmText: 'Igen, törlöm',
                            cancelText: 'Mégse',
                            type: 'warning'
                          }
                        );
                        if (!confirmed) return;

                        try {
                          const response = await fetch(`/api/patients/${patientId}/lab-quote-requests/${quote.id}`, {
                            method: 'DELETE',
                            credentials: 'include',
                          });

                          if (!response.ok) {
                            const errorData = await response.json();
                            throw new Error(errorData.error || 'Törlési hiba');
                          }

                          const reloadResponse = await fetch(`/api/patients/${patientId}/lab-quote-requests`, {
                            credentials: 'include',
                          });
                          if (reloadResponse.ok) {
                            const data = await reloadResponse.json();
                            setLabQuoteRequests(data.quoteRequests || []);
                          }
                          showToast('Árajánlatkérő sikeresen törölve', 'success');
                        } catch (error) {
                          console.error('Törlési hiba:', error);
                          showToast(
                            error instanceof Error ? error.message : 'Hiba történt a törlés során',
                            'error'
                          );
                        }
                      }}
                      className="btn-secondary text-xs px-3 py-1 text-red-600 hover:text-red-700"
                      title="Törlés"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Új árajánlatkérő létrehozása */}
        {!isViewOnly && (
          <div className={`${labQuoteRequests.length > 0 ? 'border-t pt-4' : ''}`}>
            <h5 className="text-md font-semibold text-gray-900 mb-3">Új árajánlatkérő</h5>
            <div className="space-y-4">
              <div>
                <label className="form-label">
                  Árajánlatkérő szöveg
                </label>
                <textarea
                  value={newQuoteSzoveg}
                  onChange={(e) => setNewQuoteSzoveg(e.target.value)}
                  className="form-input min-h-[150px]"
                  placeholder="Írja be az árajánlatkérő szövegét..."
                  rows={6}
                />
              </div>

              <div>
                <label className="form-label">
                  Árajánlatkérő dátuma (egy héttel az ajánlatkérés után)
                </label>
                <DatePicker
                  selected={newQuoteDatuma}
                  onChange={(date: Date | null) => {
                    setNewQuoteDatuma(date);
                  }}
                  placeholder="Válasszon dátumot"
                  minDate={new Date()}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!newQuoteSzoveg.trim()) {
                      showToast('Az árajánlatkérő szöveg kötelező', 'error');
                      return;
                    }

                    if (!newQuoteDatuma) {
                      showToast('Az árajánlatkérő dátuma kötelező', 'error');
                      return;
                    }

                    try {
                      const datuma = formatDateForInput(newQuoteDatuma.toISOString().split('T')[0]);
                      const response = await fetch(`/api/patients/${patientId}/lab-quote-requests`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        credentials: 'include',
                        body: JSON.stringify({
                          szoveg: newQuoteSzoveg.trim(),
                          datuma,
                        }),
                      });

                      if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Létrehozási hiba');
                      }

                      const reloadResponse = await fetch(`/api/patients/${patientId}/lab-quote-requests`, {
                        credentials: 'include',
                      });
                      if (reloadResponse.ok) {
                        const data = await reloadResponse.json();
                        setLabQuoteRequests(data.quoteRequests || []);
                      }

                      setNewQuoteSzoveg('');
                      setNewQuoteDatuma(null);

                      showToast('Árajánlatkérő sikeresen létrehozva', 'success');
                    } catch (error) {
                      console.error('Létrehozási hiba:', error);
                      showToast(
                        error instanceof Error ? error.message : 'Hiba történt a létrehozás során',
                        'error'
                      );
                    }
                  }}
                  className="btn-primary flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Árajánlatkérő mentése
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
