import type { FooterConfig } from './layout';

/**
 * A Fogpótlástani Klinika elérhetőségei a kimenő PDF-ek láblécéhez.
 * Egy helyen karbantartva — a fogstátusz és az árajánlatkérő PDF is ezt használja.
 */
export const CLINIC_FOOTER: FooterConfig = {
  address: 'Cím: 1088 Budapest, Szentkirályi utca 47.',
  postalAddress: 'Postacím: 1085 Budapest, Üllői út 26.; 1428 Budapest Pf. 2.',
  email: 'E-mail: fogpotlastan@dent.semmelweis-univ.hu',
  phone: 'Tel: 06-1 338-4380, 06-1 459-1500/59326',
  fax: 'Fax: (06-1) 317-5270',
  website: 'web: semmelweis.hu/fogpotlastan',
};
