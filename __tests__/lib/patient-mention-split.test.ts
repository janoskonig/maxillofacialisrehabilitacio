import { describe, it, expect } from 'vitest';
import {
  recognizePatientsInText,
  splitDetectionsForSend,
  type PatientRosterEntry,
} from '@/lib/patient-name-recognition';

/**
 * A küldéskori szétválasztás (egyértelmű → auto-hivatkozott; kétértelmű, fel nem
 * oldott → feloldatlan) a 064-es „utólag is választható" funkció magja. Ez köti
 * a klinikai adatot a beteghez, ezért tisztán (DB nélkül) teszteljük.
 */
describe('splitDetectionsForSend', () => {
  const kovacsJanos1: PatientRosterEntry = { id: 'p1', nev: 'Kovács János', taj: '111111111' };
  const kovacsJanos2: PatientRosterEntry = { id: 'p2', nev: 'Kovács János', taj: '222222222' };
  const nagyEva: PatientRosterEntry = { id: 'p3', nev: 'Nagy Éva', taj: '333333333' };

  it('egyértelmű találat automatikusan hivatkozott, nincs feloldatlan', () => {
    const roster = [kovacsJanos1, nagyEva];
    const detections = recognizePatientsInText('Megbeszéltem Nagy Évával a kontrollt', roster);
    const { autoMentioned, unresolved } = splitDetectionsForSend(detections, new Set());

    expect(autoMentioned).toEqual(['p3']);
    expect(unresolved).toEqual([]);
  });

  it('kétértelmű, fel nem oldott találat feloldatlan marad (nem tippelünk)', () => {
    const roster = [kovacsJanos1, kovacsJanos2];
    const detections = recognizePatientsInText('Kovács Jánossal egyeztettem', roster);
    const { autoMentioned, unresolved } = splitDetectionsForSend(detections, new Set());

    expect(autoMentioned).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].candidateIds.sort()).toEqual(['p1', 'p2']);
    expect(unresolved[0].matchedText.toLowerCase()).toContain('kovács jános');
  });

  it('kétértelmű, de a composerben kiválasztott jelölt feloldottnak számít', () => {
    const roster = [kovacsJanos1, kovacsJanos2];
    const detections = recognizePatientsInText('Kovács Jánossal egyeztettem', roster);
    const { autoMentioned, unresolved } = splitDetectionsForSend(detections, new Set(['p2']));

    expect(autoMentioned).toEqual(['p2']);
    expect(unresolved).toEqual([]);
  });

  it('vegyes szöveg: egyértelmű auto, kétértelmű feloldatlan', () => {
    const roster = [kovacsJanos1, kovacsJanos2, nagyEva];
    const detections = recognizePatientsInText(
      'Nagy Éva és Kovács János is jött ma',
      roster,
    );
    const { autoMentioned, unresolved } = splitDetectionsForSend(detections, new Set());

    expect(autoMentioned).toEqual(['p3']);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].candidateIds.sort()).toEqual(['p1', 'p2']);
  });
});
