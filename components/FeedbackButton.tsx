'use client';

import { useState, useEffect } from 'react';
import { MessageCircle, X, Send, AlertCircle } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { getStoredErrors, formatErrorLog, clearStoredErrors, ErrorLog } from '@/lib/errorLogger';

export default function FeedbackButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<'bug' | 'error' | 'crash' | 'suggestion' | 'other'>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasStoredErrors, setHasStoredErrors] = useState(false);
  const [storedErrors, setStoredErrors] = useState<ErrorLog[]>([]);

  useEffect(() => {
    // Check for stored errors
    const errors = getStoredErrors();
    setHasStoredErrors(errors.length > 0);
    setStoredErrors(errors);
    
    // If there are errors, suggest error type
    if (errors.length > 0 && !isOpen) {
      setType('error');
    }
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setSubmitStatus('idle');
    // Refresh stored errors when opening
    const errors = getStoredErrors();
    setHasStoredErrors(errors.length > 0);
    setStoredErrors(errors);
  };

  const handleClose = () => {
    setIsOpen(false);
    setTitle('');
    setDescription('');
    setSubmitStatus('idle');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!description.trim()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      const user = await getCurrentUser();
      const userEmail = user?.email || null;

      // Get the most recent error log if type is error/crash
      let errorLog = '';
      let errorStack = '';
      
      if ((type === 'error' || type === 'crash') && storedErrors.length > 0) {
        const mostRecent = storedErrors[storedErrors.length - 1];
        errorLog = formatErrorLog(mostRecent);
        errorStack = mostRecent.stack || '';
      }

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          type,
          title: title.trim() || undefined,
          description: description.trim(),
          errorLog: errorLog || undefined,
          errorStack: errorStack || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      setSubmitStatus('success');
      
      // Clear stored errors if they were included
      if (type === 'error' || type === 'crash') {
        clearStoredErrors();
        setHasStoredErrors(false);
        setStoredErrors([]);
      }

      // Reset form
      setTitle('');
      setDescription('');
      
      // Close after 2 seconds
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (error) {
      console.error('Error submitting feedback:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const includeErrorLog = type === 'error' || type === 'crash';

  return (
    <>
      {/* Feedback Button - Fixed bottom left */}
      <button
        onClick={handleOpen}
        className="fixed bottom-6 left-6 z-40 bg-medical-primary hover:bg-medical-primary/90 text-white rounded-full p-4 shadow-lg transition-all duration-200 hover:scale-110 flex items-center gap-2 group"
        aria-label="Visszajelzés küldése"
      >
        <MessageCircle className="w-5 h-5" />
        {hasStoredErrors && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            !
          </span>
        )}
        <span className="hidden md:inline-block text-sm font-medium">Visszajelzés</span>
      </button>

      {/* Feedback Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Visszajelzés küldése</h2>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Bezárás"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Típus
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="form-input w-full"
                  required
                >
                  <option value="bug">Bug jelentés</option>
                  <option value="error">Hiba</option>
                  <option value="crash">Crash</option>
                  <option value="suggestion">Javaslat</option>
                  <option value="other">Egyéb</option>
                </select>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cím (opcionális)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="form-input w-full"
                  placeholder="Rövid leírás a problémáról"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Leírás <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="form-input w-full min-h-[150px]"
                  placeholder="Részletesen írja le a problémát..."
                  required
                />
              </div>

              {/* Error Log Info */}
              {includeErrorLog && hasStoredErrors && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-yellow-800">
                        {storedErrors.length} hibát találtunk a rendszerben
                      </p>
                      <p className="text-xs text-yellow-700 mt-1">
                        A legutóbbi hiba logja automatikusan csatolva lesz a jelentéshez.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Status */}
              {submitStatus === 'success' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800">
                    ✓ Visszajelzés sikeresen elküldve! Köszönjük!
                  </p>
                </div>
              )}

              {submitStatus === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800">
                    Hiba történt a küldés során. Kérjük, próbálja újra.
                  </p>
                </div>
              )}

              {/* Submit Button */}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  className="btn-secondary"
                  disabled={isSubmitting}
                >
                  Mégse
                </button>
                <button
                  type="submit"
                  className="btn-primary flex items-center gap-2"
                  disabled={isSubmitting || !description.trim()}
                >
                  {isSubmitting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Küldés...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Küldés
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}






