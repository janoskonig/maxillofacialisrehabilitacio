import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { PortalSignInForm } from '@/components/patient-portal/PortalSignInForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Belépés – Páciens portál',
  // Native POST needs Origin; strict-origin omits the token path and query.
  referrer: 'strict-origin',
};

export default function PatientPortalSignInPage({
  searchParams,
}: {
  searchParams: { token?: string | string[]; mode?: string | string[] };
}) {
  const token = searchParams.token;
  if (!token) redirect('/patient-portal?error=missing_token');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    redirect('/patient-portal?error=invalid_token');
  }

  const verifyEmail = searchParams.mode === 'email';
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-sm border dark:border-gray-800 p-6 sm:p-8">
        <div className="flex justify-center mb-6"><Logo width={50} height={58} /></div>
        <h1 className="text-xl font-bold text-medical-primary text-center">Páciens portál</h1>
        <p className="mt-4 text-gray-700 dark:text-gray-300 text-center">
          {verifyEmail
            ? 'Az email címe megerősítéséhez és a belépéshez nyomja meg az alábbi gombot.'
            : 'A belépéshez nyomja meg az alábbi gombot. Ezután megtekintheti az időpontjait és a feladatait.'}
        </p>
        <PortalSignInForm token={token} verifyEmail={verifyEmail} />
        <a href="/patient-portal" className="block mt-5 text-center text-sm text-medical-primary hover:underline">
          Új bejelentkezési link kérése
        </a>
      </div>
    </main>
  );
}
