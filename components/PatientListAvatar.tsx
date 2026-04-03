'use client';

import { useState } from 'react';

interface PatientListAvatarProps {
  patientId: string;
  patientName: string | null | undefined;
  portraitDocumentId?: string | null;
  sizeClass?: string;
}

export function PatientListAvatar({
  patientId,
  patientName,
  portraitDocumentId,
  sizeClass = 'h-9 w-9',
}: PatientListAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const monogram = patientName
    ? patientName
        .split(' ')
        .map((n) => n.charAt(0))
        .join('')
        .substring(0, 2)
    : '??';
  const showImg = Boolean(portraitDocumentId && !imgFailed);

  return (
    <div className={`flex-shrink-0 rounded-full overflow-hidden shadow-soft ${sizeClass}`}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/patients/${patientId}/documents/${portraitDocumentId}?inline=true`}
          alt=""
          className={`${sizeClass} object-cover w-full h-full`}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className={`${sizeClass} w-full h-full bg-gradient-to-br from-medical-primary to-medical-primary-light flex items-center justify-center`}
        >
          <span className="text-xs font-semibold text-white">{monogram}</span>
        </div>
      )}
    </div>
  );
}
