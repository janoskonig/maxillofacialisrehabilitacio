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
  };
};
