'use client';

import type { NeakExportPlan } from '@/lib/neak-export';

interface Props {
  plan: NeakExportPlan;
  loading: boolean;
  onDownload: () => void;
  onClose: () => void;
  onUpload?: () => void;
}

export function NeakExportPreview({ plan, loading, onDownload, onClose, onUpload }: Props) {
  return (
    <section aria-label="NEAK export ellenőrzése" className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-4">
        <h5 className="font-semibold">NEAK export ellenőrzése</h5>
        <button type="button" onClick={onClose} disabled={loading} className="text-sm underline">Bezárás</button>
      </div>
      <p className="my-2 text-sm">{plan.isReady ? 'A rögzített adatok alapján a csomag előállítható.' : 'Az export előtt pótolja az alábbi hiányokat.'}</p>
      {plan.missingFields.length > 0 && (
        <div className="mb-3 text-sm text-red-700 dark:text-red-300">
          <p className="font-semibold">Hiányzó betegadatok</p>
          <ul className="list-disc pl-5">{plan.missingFields.map((field) => <li key={field.key}>{field.label}</li>)}</ul>
          <p className="mt-1">Pótolja és mentse az adatokat a beteg adatlapján, majd ellenőrizze újra az exportot.</p>
        </div>
      )}
      {plan.missingDocRules.length > 0 && (
        <div className="mb-3 text-sm text-red-700 dark:text-red-300">
          <p className="font-semibold">Hiányzó dokumentumok</p>
          <ul className="list-disc pl-5">{plan.missingDocRules.map((rule) => <li key={rule.tag}>{rule.label}: {rule.actualCount} / {rule.minCount} db</li>)}</ul>
          {onUpload && <button type="button" onClick={onUpload} className="mt-2 underline">Dokumentum feltöltése</button>}
        </div>
      )}
      {plan.limitErrors.map((error) => <p key={error.code} className="mb-2 text-sm text-red-700 dark:text-red-300">{error.message}</p>)}
      {plan.dentalContent && (
        <details className="mb-3 text-sm">
          <summary className="cursor-pointer font-semibold">Fogazati státusz tartalma</summary>
          <p className="my-2">{plan.dentalContent.notes[0]}</p>
          <ul className="list-disc pl-5">
            {plan.dentalContent.rows.filter((row) => row.explicit).map((row) => <li key={row.number}>{row.number}. fog: {row.detail}</li>)}
          </ul>
          <p className="mt-2">{plan.dentalContent.notes[1]}</p>
          <p className="mt-1">A PDF a meglévő fogpótlások és implantátumok rögzített adatait is tartalmazza.</p>
        </details>
      )}
      {plan.treatmentContent && (
        <details className="mb-3 text-sm" open>
          <summary className="cursor-pointer font-semibold">Kezelési terv tartalma</summary>
          {plan.treatmentContent.sections.map((section) => (
            <div key={section.title} className="mt-2">
              <p className="font-semibold">{section.title}</p>
              <ul className="list-disc pl-5">{section.lines.map((line, index) => <li key={index} className="whitespace-pre-wrap break-words">{line}</li>)}</ul>
            </div>
          ))}
        </details>
      )}
      <div className="mb-3 text-sm text-amber-800 dark:text-amber-300">
        <p className="font-semibold">Ellenőrizendő</p>
        <ul className="list-disc pl-5">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </div>
      <details className="mb-3 text-sm" open>
        <summary className="cursor-pointer font-semibold">Kiválasztott mellékletek ({plan.includedDocuments.length})</summary>
        {plan.includedDocuments.length === 0 ? <p>Nincs kiválasztott melléklet.</p> : (
          <ul className="mt-1 list-disc pl-5 break-words">{plan.includedDocuments.map((doc) => <li key={doc.id}>{doc.filename || 'Névtelen dokumentum'} ({(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB)</li>)}</ul>
        )}
        <p className="mt-2">Mellékletek becsült összmérete: {(plan.estimatedTotalBytes / 1024 / 1024).toFixed(2)} MB. A generált iratok mérete ezen felül számít.</p>
        <p className="mt-1">Az árajánlatok közül a legfrissebb kerül a csomagba. A kötelező és külön megjelölt mellékleteket a rendszer szintén csatolja.</p>
      </details>
      <details className="mb-3 text-sm">
        <summary className="cursor-pointer font-semibold">Generált iratok ({plan.generatedFiles.length})</summary>
        <ul className="mt-1 list-disc pl-5">{plan.generatedFiles.map((file) => <li key={file}>{file}</li>)}</ul>
      </details>
      <button type="button" onClick={onDownload} disabled={loading || !plan.isReady} className="btn-primary disabled:opacity-50">
        {loading ? 'Csomag összeállítása…' : 'NEAK csomag letöltése'}
      </button>
    </section>
  );
}
