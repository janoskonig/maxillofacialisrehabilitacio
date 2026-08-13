import { describe, it, expect } from 'vitest';
import {
  inferIntakeEpisodeReason,
  buildIntakeChiefComplaint,
  buildIntakeCaseTitle,
  DEFAULT_INTAKE_CHIEF_COMPLAINT,
} from '@/lib/patient-intake-episode';

describe('inferIntakeEpisodeReason', () => {
  it('az explicit „kezelésre érkezés indoka" nyer', () => {
    expect(
      inferIntakeEpisodeReason({
        kezelesreErkezesIndoka: 'traumás sérülés',
        veleszuletettRendellenessegek: ['ajakhasadék'],
      })
    ).toBe('traumás sérülés');
  });

  it('ismeretlen/üres indokot nem fogad el', () => {
    expect(inferIntakeEpisodeReason({ kezelesreErkezesIndoka: '' })).toBe(
      'onkológiai kezelés utáni állapot'
    );
    expect(inferIntakeEpisodeReason({ kezelesreErkezesIndoka: 'egyéb' })).toBe(
      'onkológiai kezelés utáni állapot'
    );
  });

  it('veleszületett rendellenességből következtet', () => {
    expect(
      inferIntakeEpisodeReason({ veleszuletettRendellenessegek: ['állcsonthasadék'] })
    ).toBe('veleszületett rendellenesség');
    expect(
      inferIntakeEpisodeReason({ veleszuletettMutetekLeirasa: 'Hasadékzárás 2019-ben' })
    ).toBe('veleszületett rendellenesség');
  });

  it('baleseti adatokból traumát következtet', () => {
    expect(inferIntakeEpisodeReason({ balesetIdopont: '2024-05-01' })).toBe('traumás sérülés');
    expect(inferIntakeEpisodeReason({ balesetEtiologiaja: 'közlekedési baleset' })).toBe(
      'traumás sérülés'
    );
  });

  it('a veleszületett erősebb jel, mint a baleseti', () => {
    expect(
      inferIntakeEpisodeReason({
        veleszuletettRendellenessegek: ['ajakhasadék'],
        balesetIdopont: '2024-05-01',
      })
    ).toBe('veleszületett rendellenesség');
  });

  it('adat híján onkológiai a fallback', () => {
    expect(inferIntakeEpisodeReason({})).toBe('onkológiai kezelés utáni állapot');
  });
});

describe('buildIntakeChiefComplaint', () => {
  it('a beutaló indokolását preferálja', () => {
    expect(
      buildIntakeChiefComplaint({
        beutaloIndokolas: 'Protetikai rehabilitáció kérése',
        diagnozis: 'C03.0',
      })
    ).toBe('Protetikai rehabilitáció kérése');
  });

  it('indokolás híján a diagnózisokra esik vissza', () => {
    expect(buildIntakeChiefComplaint({ diagnozis: 'Maxilla defektus' })).toBe('Maxilla defektus');
    expect(buildIntakeChiefComplaint({ szovettaniDiagnozis: 'Planocelluláris carcinoma' })).toBe(
      'Planocelluláris carcinoma'
    );
    expect(buildIntakeChiefComplaint({ bno: 'C03.0' })).toBe('C03.0');
  });

  it('sosem ad üres szöveget (a DB oszlop NOT NULL)', () => {
    expect(buildIntakeChiefComplaint({})).toBe(DEFAULT_INTAKE_CHIEF_COMPLAINT);
    expect(buildIntakeChiefComplaint({ beutaloIndokolas: '   ' })).toBe(
      DEFAULT_INTAKE_CHIEF_COMPLAINT
    );
  });

  it('500 karakterre vág (VARCHAR(500))', () => {
    const result = buildIntakeChiefComplaint({ beutaloIndokolas: 'a'.repeat(900) });
    expect(result).toHaveLength(500);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('buildIntakeCaseTitle', () => {
  it('a beutaló orvosból és intézményből áll össze', () => {
    expect(
      buildIntakeCaseTitle({ beutaloOrvos: 'Dr. Kiss Anna', beutaloIntezmeny: 'Semmelweis Egyetem' })
    ).toBe('Beutaló: Dr. Kiss Anna – Semmelweis Egyetem');
  });

  it('egyik adat is elég', () => {
    expect(buildIntakeCaseTitle({ beutaloOrvos: 'Dr. Kiss Anna' })).toBe('Beutaló: Dr. Kiss Anna');
    expect(buildIntakeCaseTitle({ beutaloIntezmeny: 'Semmelweis Egyetem' })).toBe(
      'Beutaló: Semmelweis Egyetem'
    );
  });

  it('beutaló adat híján null', () => {
    expect(buildIntakeCaseTitle({})).toBeNull();
    expect(buildIntakeCaseTitle({ beutaloOrvos: '  ', beutaloIntezmeny: null })).toBeNull();
  });
});
