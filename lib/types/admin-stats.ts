/**
 * Shape of the JSON returned by `GET /api/admin/stats`.
 *
 * Extracted from `app/admin/stats/page.tsx` so that auxiliary components
 * (e.g. CSV exporter) can share the same type without duplicating it.
 */
export type AdminStats = {
  generaltAt: string;
  betegek: {
    osszes: number;
    ebbenAHonapban: number;
    multHonapban: number;
    nemSzerint: Array<{ nem: string; darab: number }>;
    etiologiaSzerint: Array<{ etiologia: string; darab: number }>;
    orvosSzerint: Array<{ orvos: string; darab: number }>;
    havitTrend: Array<{ honap: string; cimke: string; darab: number }>;
    eletkor: {
      mintaSzam: number;
      atlagEv: number | null;
      medianEv: number | null;
      minEv: number | null;
      maxEv: number | null;
      kohorszok: Array<{ kohorsz: string; kohorszIdx: number; darab: number }>;
    };
    intakeStatusSzerint: Array<{ intakeStatus: string; darab: number }>;
  };
  felhasznalok: {
    osszes: number;
    aktiv: number;
    inaktiv: number;
    utolso30Napban: number;
    szerepkorSzerint: Array<{ szerepkor: string; osszes: number; aktiv: number }>;
  };
  idopontfoglalasok: {
    osszes: number;
    jovobeli: number;
    multbeli: number;
    ebbenAHonapban: number;
    statusSzerint: Array<{ status: string; darab: number }>;
    kimenetSzerint: Array<{ kimenet: string; darab: number }>;
    kesesekSzama: number;
    noShowArany: number;
    lemondasiArany: number;
    befejezesiArany: number;
    csucsOrak: Array<{ ora: number; cimke: string; darab: number }>;
    napiEloszlas: Array<{ napIdx: number; napNev: string; darab: number }>;
    bookingLeadTime: {
      mintaSzam: number;
      atlagNapok: number | null;
      medianNapok: number | null;
      p25Napok: number | null;
      p75Napok: number | null;
      minNapok: number | null;
      maxNapok: number | null;
      hisztogram: Array<{ sav: string; savIdx: number; darab: number }>;
    };
  };
  idoslotok: {
    osszes: number;
    elerheto: number;
    lefoglalt: number;
  };
  aktivitas: {
    osszes: number;
    utolso7Nap: number;
    utolso30Nap: number;
    muveletSzerint: Array<{ muvelet: string; darab: number }>;
    felhasznaloSzerint: Array<{ felhasznalo: string; darab: number }>;
    napiTrend: Array<{ datum: string; cimke: string; darab: number }>;
  };
  visszajelzesek: {
    osszes: number;
    statusSzerint: Array<{ status: string; darab: number }>;
    tipusSzerint: Array<{ tipus: string; darab: number }>;
  };
  dokumentumok: {
    osszes: number;
    utolso30Napban: number;
  };
  uzenetek: {
    osszes: number;
    olvasatlanOsszes: number;
    kuldoTipusSzerint: Array<{ kuldoTipus: string; olvasatlan: number; osszes: number }>;
  };
};
