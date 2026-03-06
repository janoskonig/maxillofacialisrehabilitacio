import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

interface DuplicateGroup {
  reason: string;
  patients: Array<{
    id: string;
    nev: string;
    taj: string;
    email: string;
    telefonszam: string;
    szuletesiDatum: string | null;
    createdAt: string;
    kezeleoorvos: string;
  }>;
}

export const GET = roleHandler(['admin'], async (req, { auth }) => {
  const pool = getDbPool();

  const allPatients = await pool.query(`
    SELECT
      p.id,
      p.nev,
      p.taj,
      p.email,
      p.telefonszam,
      p.szuletesi_datum AS "szuletesiDatum",
      p.created_at AS "createdAt",
      p.kezeleoorvos
    FROM patients p
    ORDER BY p.nev, p.created_at
  `);

  const patients = allPatients.rows;
  const groupMap = new Map<string, { reason: string; ids: Set<string>; patients: typeof patients }>();

  function addToGroup(key: string, reason: string, p1: (typeof patients)[0], p2: (typeof patients)[0]) {
    const existing = groupMap.get(key);
    if (existing) {
      if (!existing.ids.has(p1.id)) { existing.ids.add(p1.id); existing.patients.push(p1); }
      if (!existing.ids.has(p2.id)) { existing.ids.add(p2.id); existing.patients.push(p2); }
    } else {
      groupMap.set(key, {
        reason,
        ids: new Set([p1.id, p2.id]),
        patients: [p1, p2],
      });
    }
  }

  // 1. Same TAJ (strongest signal)
  const tajMap = new Map<string, (typeof patients)[0][]>();
  for (const p of patients) {
    const taj = (p.taj || '').replace(/\s+/g, '').trim();
    if (!taj || taj.length < 3) continue;
    const existing = tajMap.get(taj);
    if (existing) { existing.push(p); } else { tajMap.set(taj, [p]); }
  }
  for (const [taj, group] of Array.from(tajMap.entries())) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      addToGroup(`taj:${taj}`, `Azonos TAJ szám: ${taj}`, group[0], group[i]);
    }
  }

  // 2. Name matching (exact or partial) + optional birth date
  const normalizedPatients = patients.map(p => ({ ...p, _norm: normalizeName(p.nev) }));

  for (let i = 0; i < normalizedPatients.length; i++) {
    for (let j = i + 1; j < normalizedPatients.length; j++) {
      const a = normalizedPatients[i];
      const b = normalizedPatients[j];
      if (!a._norm || !b._norm || a._norm.length < 4 || b._norm.length < 4) continue;

      const exact = a._norm === b._norm;
      const partial = !exact && namesPartiallyMatch(a._norm, b._norm);
      if (!exact && !partial) continue;

      const sameDob = a.szuletesiDatum && b.szuletesiDatum &&
        new Date(a.szuletesiDatum).getTime() === new Date(b.szuletesiDatum).getTime();

      if (exact && sameDob) {
        addToGroup(
          `name_dob:${a._norm}:${a.szuletesiDatum}`,
          `Azonos név és születési dátum`,
          a, b,
        );
      } else if (partial && sameDob) {
        const shorter = a.nev.length <= b.nev.length ? a.nev : b.nev;
        const longer = a.nev.length > b.nev.length ? a.nev : b.nev;
        addToGroup(
          `partial_dob:${[a.id, b.id].sort().join(':')}`,
          `Hasonló név („${shorter}" / „${longer}") és azonos születési dátum`,
          a, b,
        );
      } else if (exact) {
        addToGroup(
          `name:${a._norm}`,
          `Azonos név: „${a.nev}"`,
          a, b,
        );
      } else if (partial) {
        const shorter = a.nev.length <= b.nev.length ? a.nev : b.nev;
        const longer = a.nev.length > b.nev.length ? a.nev : b.nev;
        addToGroup(
          `partial:${[a.id, b.id].sort().join(':')}`,
          `Hasonló név: „${shorter}" / „${longer}"`,
          a, b,
        );
      }
    }
  }

  // 4. Same phone number
  const phoneMap = new Map<string, (typeof patients)[0][]>();
  for (const p of patients) {
    const phone = normalizePhone(p.telefonszam);
    if (!phone || phone.length < 6) continue;
    const existing = phoneMap.get(phone);
    if (existing) { existing.push(p); } else { phoneMap.set(phone, [p]); }
  }
  for (const [phone, group] of Array.from(phoneMap.entries())) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      addToGroup(`phone:${phone}`, `Azonos telefonszám`, group[0], group[i]);
    }
  }

  // 5. Same email
  const emailMap = new Map<string, (typeof patients)[0][]>();
  for (const p of patients) {
    const email = (p.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const existing = emailMap.get(email);
    if (existing) { existing.push(p); } else { emailMap.set(email, [p]); }
  }
  for (const [email, group] of Array.from(emailMap.entries())) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      addToGroup(`email:${email}`, `Azonos email cím`, group[0], group[i]);
    }
  }

  // Deduplicate: merge overlapping groups
  const result: DuplicateGroup[] = [];
  const processedIds = new Set<string>();

  // Sort groups by strength: taj > name_dob > name > phone > email
  const sortedEntries = Array.from(groupMap.entries()).sort((a, b) => {
    const order = (k: string) => {
      if (k.startsWith('taj:')) return 0;
      if (k.startsWith('name_dob:')) return 1;
      if (k.startsWith('partial_dob:')) return 2;
      if (k.startsWith('name:')) return 3;
      if (k.startsWith('partial:')) return 4;
      if (k.startsWith('phone:')) return 5;
      return 6;
    };
    return order(a[0]) - order(b[0]);
  });

  for (const [key, group] of sortedEntries) {
    const groupKey = Array.from(group.ids).sort().join(',');
    if (processedIds.has(groupKey)) continue;
    processedIds.add(groupKey);

    const sortedPatients = group.patients.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    result.push({
      reason: group.reason,
      patients: sortedPatients.map(p => ({
        id: p.id,
        nev: p.nev || '',
        taj: p.taj || '',
        email: p.email || '',
        telefonszam: p.telefonszam || '',
        szuletesiDatum: p.szuletesiDatum || null,
        createdAt: p.createdAt,
        kezeleoorvos: p.kezeleoorvos || '',
      })),
    });
  }

  return NextResponse.json({ duplicates: result, total: result.length });
});

function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
}

/**
 * Check if two names partially match:
 * - One name's words are a subset of the other's (e.g. "Lakatos Anna" ⊂ "Lakatos Anna Flora")
 * - Or the family name matches and at least one given name matches
 */
function namesPartiallyMatch(normA: string, normB: string): boolean {
  const wordsA = normA.split(' ').filter(w => w.length > 1);
  const wordsB = normB.split(' ').filter(w => w.length > 1);
  if (wordsA.length < 2 || wordsB.length < 2) return false;
  if (wordsA.length === wordsB.length) return false; // same word count → exact match handles it

  const shorter = wordsA.length < wordsB.length ? wordsA : wordsB;
  const longer = wordsA.length >= wordsB.length ? wordsA : wordsB;

  // All words of the shorter name must appear in the longer name
  const allShorterInLonger = shorter.every(w => longer.includes(w));
  if (allShorterInLonger) return true;

  // Family name (first word) must match, plus at least one other word
  if (shorter[0] === longer[0]) {
    const commonGiven = shorter.slice(1).filter(w => longer.slice(1).includes(w));
    if (commonGiven.length > 0) return true;
  }

  return false;
}

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)\/\+\.]/g, '').replace(/^0036/, '').replace(/^36/, '');
}
