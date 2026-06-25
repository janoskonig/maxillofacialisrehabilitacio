/**
 * Adat-teljességi hiány → a betegűrlap megfelelő füle + szekció-horgonya.
 *
 * Közös forrás a vezetői adat-teljesség riporthoz
 * (`app/tasks/overview/data-completeness/page.tsx`) és a beteg-fejléc kattintható
 * hiány-checklistjéhez (`components/PatientHeaderBar.tsx`), hogy a két helyen
 * azonos legyen a deep-link célzás. A kulcsok a `getPatientDataCompleteness()`
 * MissingItem.key értékeivel egyeznek.
 */
export const FIELD_TARGET: Record<string, { tab: string; anchor: string }> = {
  nev: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  nem: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  szuletesiDatum: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  taj: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  email: { tab: 'alapadatok', anchor: 'section-alapadatok' },
  'doc:op': { tab: 'adminisztracio', anchor: 'section-adminisztracio' },
  kezelesreErkezesIndoka: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  diagnozis: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  meglevoFogak: { tab: 'anamnezis', anchor: 'section-betegvizsgalat' },
  ohipT0: { tab: 'anamnezis', anchor: 'section-ohip14' },
  tnmStaging: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  brownFuggoleges: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  brownVizszintes: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  kovacsDobak: { tab: 'anamnezis', anchor: 'section-anamnezis' },
  radioterapiaDozis: { tab: 'anamnezis', anchor: 'section-anamnezis' },
};

/** A betegűrlap deep-link URL-je egy adott hiányzó mező-kulcshoz. */
export function completenessEditHref(patientId: string, fieldKey: string): string {
  const target = FIELD_TARGET[fieldKey] ?? { tab: 'anamnezis', anchor: 'section-anamnezis' };
  return `/patients/${patientId}/view?tab=${target.tab}#${target.anchor}`;
}
