import { describe, it, expect } from 'vitest';
import { buildStepperItems, isBackwardMove, stageLabelFor } from '@/lib/stage-stepper';
import type { StageCatalogEntry } from '@/lib/types/episode';

const catalog: StageCatalogEntry[] = [
  { code: 'STAGE_0', reason: 'onkológiai kezelés utáni állapot', labelHu: 'Első konzultációra vár', orderIndex: 0, isTerminal: false },
  { code: 'STAGE_1', reason: 'onkológiai kezelés utáni állapot', labelHu: 'Státuszfelvétel + dokumentáció', orderIndex: 1, isTerminal: false },
  { code: 'STAGE_2', reason: 'onkológiai kezelés utáni állapot', labelHu: 'Hosszú távú terv + etapok', orderIndex: 2, isTerminal: false },
  { code: 'STAGE_7', reason: 'onkológiai kezelés utáni állapot', labelHu: 'Gondozás', orderIndex: 7, isTerminal: true },
];

describe('buildStepperItems', () => {
  it('jelöli a múltbeli, jelenlegi és jövőbeli szakaszokat', () => {
    const items = buildStepperItems(catalog, 'STAGE_2');
    expect(items.map((i) => i.state)).toEqual(['past', 'past', 'current', 'future']);
  });

  it('első stádiumnál nincs múltbeli elem', () => {
    const items = buildStepperItems(catalog, 'STAGE_0');
    expect(items.map((i) => i.state)).toEqual(['current', 'future', 'future', 'future']);
  });

  it('ismeretlen jelenlegi kódnál minden elem future, nincs current', () => {
    const items = buildStepperItems(catalog, 'STAGE_X');
    expect(items.every((i) => i.state === 'future')).toBe(true);
  });

  it('null jelenlegi kódnál minden elem future', () => {
    const items = buildStepperItems(catalog, null);
    expect(items.every((i) => i.state === 'future')).toBe(true);
  });

  it('a javasolt stádiumot megjelöli', () => {
    const items = buildStepperItems(catalog, 'STAGE_0', 'STAGE_1');
    expect(items.find((i) => i.entry.code === 'STAGE_1')?.suggested).toBe(true);
    expect(items.filter((i) => i.suggested)).toHaveLength(1);
  });

  it('a jelenlegivel egyező javaslatot elnyomja', () => {
    const items = buildStepperItems(catalog, 'STAGE_1', 'STAGE_1');
    expect(items.some((i) => i.suggested)).toBe(false);
  });

  it('duplikált kódú (több-etiológiás, szűretlen) katalógusnál az első találat a current', () => {
    const duplicated: StageCatalogEntry[] = [
      ...catalog,
      { code: 'STAGE_0', reason: 'traumás sérülés', labelHu: 'Akut utáni beutalás', orderIndex: 0, isTerminal: false },
      { code: 'STAGE_1', reason: 'traumás sérülés', labelHu: 'Státuszfelvétel', orderIndex: 1, isTerminal: false },
    ];
    const items = buildStepperItems(duplicated, 'STAGE_1');
    expect(items.filter((i) => i.state === 'current')).toHaveLength(1);
    expect(items.findIndex((i) => i.state === 'current')).toBe(1);
  });
});

describe('isBackwardMove', () => {
  it('korábbi stádiumra lépésnél true', () => {
    expect(isBackwardMove(catalog, 'STAGE_2', 'STAGE_0')).toBe(true);
  });

  it('előre lépésnél false', () => {
    expect(isBackwardMove(catalog, 'STAGE_0', 'STAGE_2')).toBe(false);
  });

  it('ismeretlen kódoknál false (nem tudunk irányt megállapítani)', () => {
    expect(isBackwardMove(catalog, 'STAGE_X', 'STAGE_0')).toBe(false);
    expect(isBackwardMove(catalog, null, 'STAGE_0')).toBe(false);
  });
});

describe('stageLabelFor', () => {
  it('katalógus-címkét ad vissza', () => {
    expect(stageLabelFor(catalog, 'STAGE_7')).toBe('Gondozás');
  });

  it('ismeretlen kódnál a nyers kódot adja vissza', () => {
    expect(stageLabelFor(catalog, 'STAGE_9')).toBe('STAGE_9');
  });

  it('null kódnál gondolatjelet ad', () => {
    expect(stageLabelFor(catalog, null)).toBe('—');
  });
});
