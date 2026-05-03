export type MedicalStats = {
  bno: {
    data: Array<{ kod: string; nev: string | null; elofordulas: number }>;
  };
  referringDoctors: {
    data: Array<{ orvos: string; darab: number }>;
  };
  dmfDistribution: {
    data: Array<{ dmft: number; betegSzama: number }>;
    stats: {
      atlag: number;
      median: number;
      szoras: number;
      min: number;
      max: number;
    };
  };
  toothPositions: {
    data: Array<{
      fogSzam: number;
      dSzama: number;
      fSzama: number;
      mSzama: number;
      egeszsSeges: number;
      osszes: number;
    }>;
  };
  implantPositions: {
    data: Array<{
      fogSzam: number;
      implantatumSzama: number;
    }>;
  };
  waitingTime: {
    atlagNapokban: number;
    medianNapokban: number;
    szorasNapokban: number;
    minNapokban: number;
    maxNapokban: number;
    betegSzamaIdoponttal: number;
  };
  doctorWorkload: {
    data: Array<{
      orvosNev: string;
      orvosEmail: string;
      jovobeliIdopontokSzama: number;
      elerhetoIdopontokSzama: number;
      multbeliIdopontokSzama: number;
    }>;
  };
  ohip14: {
    betegekLegalabbEgyKitoltessel: number;
    osszesKitoltes: number;
    idopontokSzerint: Array<{
      timepoint: string;
      kitoltesekSzama: number;
      betegekSzama: number;
      atlagTotalScore: number | null;
      medianTotalScore: number | null;
    }>;
    /**
     * T0 → T3 delta összegzés (negatív = javulás, pozitív = romlás).
     * Csak (patient_id, episode_id) párok, ahol mindkét timepoint
     * total_score-ja kitöltött.
     */
    t0t3Delta: {
      parosSzam: number;
      atlagDelta: number | null;
      medianDelta: number | null;
      szorasDelta: number | null;
      minDelta: number | null;
      maxDelta: number | null;
      javulokSzama: number;
      valtozatlanokSzama: number;
      romlokSzama: number;
      hisztogram: Array<{ sav: string; savIdx: number; darab: number }>;
    };
  };
  treatmentPlans: {
    betegekKiosztottTervvel: number;
    osszesTervSorAFelson: number;
    osszesTervSorAlso: number;
    osszesTervSorArcotErinto: number;
    elkeszultFelson: number;
    elkeszultAlso: number;
    elkeszultArcotErinto: number;
    fogpotlasTipusSzerint: Array<{ kod: string; labelHu: string | null; darab: number }>;
    arcotErintoTipusSzerint: Array<{ tipus: string; darab: number }>;
    /**
     * Páciens-szintű készültség (csak ahol az adott rácsban van legalább
     * 1 elem). Az "átlag %" / "medián %" a (kész elem / összes elem) per
     * beteg arány aggregátuma.
     */
    keszultseg: {
      felso: { mintaSzam: number; atlagPct: number | null; medianPct: number | null; teljesenKesz: number };
      also: { mintaSzam: number; atlagPct: number | null; medianPct: number | null; teljesenKesz: number };
      arcot: { mintaSzam: number; atlagPct: number | null; medianPct: number | null; teljesenKesz: number };
    };
  };
};
