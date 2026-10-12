import type { Patient } from "@/lib/types";
import { formatDateForDisplay } from "@/lib/dateUtils";

/** Hiányzó regisztrálóból nem következtetünk önregisztrációra (régi importoknál is hiányozhat). */
export function PatientRegistrationDetails({ patient }: { patient: Patient }) {
  const registeredBy = patient.createdBy?.trim();

  return (
    <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
      <p className="font-medium text-gray-800 dark:text-gray-200">
        {registeredBy ? "Más regisztrálta" : "Regisztráló nincs rögzítve"}
      </p>
      {registeredBy && (
        <p className="break-all" title={registeredBy}>
          Regisztráló: {registeredBy}
        </p>
      )}
      <p>
        {patient.createdAt ? (
          <>
            Regisztráció: <time dateTime={patient.createdAt}>{formatDateForDisplay(patient.createdAt)}</time>
          </>
        ) : (
          "A regisztráció dátuma nincs rögzítve"
        )}
      </p>
    </div>
  );
}
