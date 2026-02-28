export type MedicalStats = {
  bno: {
    data: Array<{ kod: string; elofordulas: number }>;
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
  waitingPatients: {
    osszes: number;
    pending: number;
    nincsIdopont: number;
    betegek: Array<{
      id: string;
      nev: string | null;
      taj: string | null;
      kezeleoorvos: string | null;
      betegLetrehozva: string;
      status: 'pending' | 'nincs_idopont';
    }>;
  };
};
