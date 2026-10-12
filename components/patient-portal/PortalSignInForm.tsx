'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

interface PortalSignInFormProps {
  token: string;
  verifyEmail?: boolean;
}

export function PortalSignInForm({ token, verifyEmail = false }: PortalSignInFormProps) {
  const submissionStarted = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Returning with browser Back may restore the disabled form from the page cache.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        submissionStarted.current = false;
        setSubmitting(false);
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submissionStarted.current) {
      event.preventDefault();
      return;
    }
    submissionStarted.current = true;
    setSubmitting(true);
    // Keep the native POST so login and its cookie work without client-side fetch.
  };

  return (
    <form
      action={verifyEmail ? '/api/patient-portal/auth/verify-email' : '/api/patient-portal/auth/verify'}
      method="post"
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className="mt-6"
    >
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
        {submitting ? 'Belépés...' : verifyEmail ? 'Email cím megerősítése és belépés' : 'Belépés'}
      </button>
    </form>
  );
}
