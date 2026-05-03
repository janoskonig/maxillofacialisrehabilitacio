'use client';

/**
 * StatsCsvExport — admin-only "Adatexport" panel.
 *
 * Egy gombnyomással letölthető CSV-k a /admin/stats oldal összes jelenleg
 * megjelenített aggregált "dataframe"-jéről, későbbi R / pandas elemzésre.
 *
 * Adatforrások (mind read-only, már létező admin endpointok):
 *   - prop:  GET /api/admin/stats           (a parent-tól kapott `stats`)
 *   - lazy:  GET /api/admin/stats/medical
 *   - lazy:  GET /api/admin/stats/unsuccessful-attempts?days=0
 *
 * Formátum: UTF-8 + BOM, vesszős, CRLF, RFC 4180. R-ből:
 *   readr::read_csv("file.csv")            # BOM-tolerant
 *   read.csv("file.csv", fileEncoding = "UTF-8-BOM", na.strings = "")
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Download, RefreshCw, AlertTriangle, Info, FileSpreadsheet } from 'lucide-react';
import type { AdminStats } from '@/lib/types/admin-stats';
import type { MedicalStats } from '@/lib/types';
import type { PipelineApiResponse } from '@/components/PipelineStatsSection';
import type { OperationalApiResponse } from '@/components/OperationalStatsSection';
import type { ConsiliumApiResponse } from '@/components/ConsiliumStatsSection';
import {
  type CsvColumn,
  downloadCsv,
  todayIso,
  toCsv,
} from '@/lib/csv-export';

interface UnsuccessfulAttemptsApi {
  days: number;
  doctorFilter: string | null;
  summary: { period: number; allTime: number };
  byDoctor: Array<{ doctor: string; count: number }>;
  availableDoctors: string[];
  byWorkPhase: Array<{ workPhaseCode: string; label: string | null; count: number }>;
  topReasons: Array<{ reason: string; count: number }>;
  reasonsByTemplate: Array<{
    template: string;
    canonical: boolean;
    count: number;
    examples?: Array<{ text: string; count: number }>;
  }>;
  weeklyTrend: Array<{ weekStart: string; count: number }>;
  recent: Array<{
    appointmentId: string;
    patientId: string | null;
    patientName: string | null;
    workPhaseLabel: string | null;
    workPhaseCode: string | null;
    attemptNumber: number;
    appointmentStart: string | null;
    failedAt: string | null;
    failedBy: string | null;
    reason: string | null;
  }>;
  attemptDistribution: Array<{ maxAttempts: number; parosSzam: number }>;
  attemptDistributionSummary: {
    osszesStepInstance: number;
    egyProba: number;
    ketProba: number;
    haromVagyTobbProba: number;
    tobbszorPct: number;
  };
}

type DatasetCategory =
  | 'overview'
  | 'system'
  | 'medical'
  | 'pipeline'
  | 'operational'
  | 'consilium'
  | 'attempts';

type Builder = () => string | null;

interface DatasetDef {
  id: string;
  category: DatasetCategory;
  /** Stem for the file name (without `.csv`). The date stamp is appended. */
  stem: string;
  label: string;
  description: string;
  /** Returns the (estimated) number of rows the CSV will contain. */
  rowCount: number | null;
  /** Build the CSV content; returns `null` if data is not available yet. */
  build: Builder;
}

const CATEGORY_META: Record<DatasetCategory, { title: string; subtitle: string }> = {
  overview: {
    title: 'Áttekintés',
    subtitle: 'Felső kártyák és összesítő számok.',
  },
  system: {
    title: 'Rendszer',
    subtitle: 'Betegek, felhasználók, időpontok, demográfia, üzenetek.',
  },
  pipeline: {
    title: 'Folyamat',
    subtitle: 'Episode élettartam, work-phase pipeline, ragadt lépések.',
  },
  operational: {
    title: 'Operatív SLA',
    subtitle: 'Felhasználói feladatok, megoldási idők.',
  },
  consilium: {
    title: 'Konzílium',
    subtitle: 'Sessions, részvétel, megbeszélt napirendi pontok, prep tokenek és kommentek.',
  },
  medical: {
    title: 'Szakmai',
    subtitle: 'BNO, DMF, fog- és implantátum-pozíciók, OHIP-14, kezelési tervek.',
  },
  attempts: {
    title: 'Sikertelen próbák',
    subtitle: 'Migration 029 alapú audit-aggregátumok.',
  },
};

function buildOverviewKpiCsv(stats: AdminStats): string {
  // One-row "wide" dataframe a felső KPI-okkal — gyors snapshothoz.
  const row = {
    generalt_at: stats.generaltAt,
    betegek_osszes: stats.betegek.osszes,
    betegek_e_honap: stats.betegek.ebbenAHonapban,
    betegek_mult_honap: stats.betegek.multHonapban,
    eletkor_atlag_ev: stats.betegek.eletkor.atlagEv,
    eletkor_median_ev: stats.betegek.eletkor.medianEv,
    eletkor_minta_szam: stats.betegek.eletkor.mintaSzam,
    felhasznalok_osszes: stats.felhasznalok.osszes,
    felhasznalok_aktiv: stats.felhasznalok.aktiv,
    felhasznalok_inaktiv: stats.felhasznalok.inaktiv,
    felhasznalok_uj_30nap: stats.felhasznalok.utolso30Napban,
    idopontok_osszes: stats.idopontfoglalasok.osszes,
    idopontok_jovobeli: stats.idopontfoglalasok.jovobeli,
    idopontok_multbeli: stats.idopontfoglalasok.multbeli,
    idopontok_e_honap: stats.idopontfoglalasok.ebbenAHonapban,
    idopontok_kesesek: stats.idopontfoglalasok.kesesekSzama,
    no_show_arany_pct: stats.idopontfoglalasok.noShowArany,
    lemondasi_arany_pct: stats.idopontfoglalasok.lemondasiArany,
    befejezesi_arany_pct: stats.idopontfoglalasok.befejezesiArany,
    booking_lead_median_napok: stats.idopontfoglalasok.bookingLeadTime.medianNapok,
    booking_lead_atlag_napok: stats.idopontfoglalasok.bookingLeadTime.atlagNapok,
    booking_lead_minta_szam: stats.idopontfoglalasok.bookingLeadTime.mintaSzam,
    idoslotok_osszes: stats.idoslotok.osszes,
    idoslotok_elerheto: stats.idoslotok.elerheto,
    idoslotok_lefoglalt: stats.idoslotok.lefoglalt,
    aktivitas_osszes: stats.aktivitas.osszes,
    aktivitas_7nap: stats.aktivitas.utolso7Nap,
    aktivitas_30nap: stats.aktivitas.utolso30Nap,
    visszajelzesek_osszes: stats.visszajelzesek.osszes,
    dokumentumok_osszes: stats.dokumentumok.osszes,
    dokumentumok_30nap: stats.dokumentumok.utolso30Napban,
    uzenetek_osszes: stats.uzenetek.osszes,
    uzenetek_olvasatlan_osszes: stats.uzenetek.olvasatlanOsszes,
  };
  const cols: CsvColumn<typeof row>[] = (Object.keys(row) as Array<keyof typeof row>).map((k) => ({
    header: k,
    value: k,
  }));
  return toCsv([row], cols);
}

function buildSystemDatasets(stats: AdminStats): DatasetDef[] {
  return [
    {
      id: 'osszesito_kpi',
      category: 'overview',
      stem: 'osszesito_kpi',
      label: 'Összesítő KPI (1 sor)',
      description: 'Egy soros wide-format pillanatkép minden felső KPI-ról.',
      rowCount: 1,
      build: () => buildOverviewKpiCsv(stats),
    },
    {
      id: 'betegek_havi_trend',
      category: 'overview',
      stem: 'betegek_havi_trend',
      label: 'Új betegek — havi trend',
      description: 'Az utolsó 12 hónap új betegek száma havonta (gap-fillelt).',
      rowCount: stats.betegek.havitTrend.length,
      build: () =>
        toCsv(stats.betegek.havitTrend, [
          { header: 'honap', value: 'honap' },
          { header: 'cimke', value: 'cimke' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'aktivitas_napi_trend',
      category: 'overview',
      stem: 'aktivitas_napi_trend',
      label: 'Aktivitás — napi trend',
      description: 'Utolsó 30 nap napi aktivitás-események száma (gap-fillelt).',
      rowCount: stats.aktivitas.napiTrend.length,
      build: () =>
        toCsv(stats.aktivitas.napiTrend, [
          { header: 'datum', value: 'datum' },
          { header: 'cimke', value: 'cimke' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'betegek_nem_szerint',
      category: 'system',
      stem: 'betegek_nem_szerint',
      label: 'Betegek — nem szerint',
      description: 'patients.nem értékek megoszlása.',
      rowCount: stats.betegek.nemSzerint.length,
      build: () =>
        toCsv(stats.betegek.nemSzerint, [
          { header: 'nem', value: 'nem' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'betegek_etiologia_szerint',
      category: 'system',
      stem: 'betegek_etiologia_szerint',
      label: 'Betegek — etiológia szerint',
      description: 'patient_anamnesis.kezelesre_erkezes_indoka megoszlása.',
      rowCount: stats.betegek.etiologiaSzerint.length,
      build: () =>
        toCsv(stats.betegek.etiologiaSzerint, [
          { header: 'etiologia', value: 'etiologia' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'betegek_orvos_szerint_top10',
      category: 'system',
      stem: 'betegek_orvos_szerint_top10',
      label: 'Betegek — kezelőorvos (top 10)',
      description: 'Top 10 kezelőorvos a hozzárendelt betegek száma alapján.',
      rowCount: stats.betegek.orvosSzerint.length,
      build: () =>
        toCsv(stats.betegek.orvosSzerint, [
          { header: 'orvos', value: 'orvos' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'felhasznalok_szerepkor_szerint',
      category: 'system',
      stem: 'felhasznalok_szerepkor_szerint',
      label: 'Felhasználók — szerepkör szerint',
      description: 'users.role összes / aktív bontásban.',
      rowCount: stats.felhasznalok.szerepkorSzerint.length,
      build: () =>
        toCsv(stats.felhasznalok.szerepkorSzerint, [
          { header: 'szerepkor', value: 'szerepkor' },
          { header: 'osszes', value: 'osszes' },
          { header: 'aktiv', value: 'aktiv' },
        ]),
    },
    {
      id: 'idopontok_status_szerint',
      category: 'system',
      stem: 'idopontok_status_szerint',
      label: 'Időpontok — páciens-jóváhagyási státusz',
      description: 'appointments.approval_status megoszlása (NULL = normal).',
      rowCount: stats.idopontfoglalasok.statusSzerint.length,
      build: () =>
        toCsv(stats.idopontfoglalasok.statusSzerint, [
          { header: 'status', value: 'status' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'idopontok_kimenet_szerint',
      category: 'system',
      stem: 'idopontok_kimenet_szerint',
      label: 'Időpontok — kimenet',
      description: 'appointments.appointment_status (completed / no_show / cancelled_*).',
      rowCount: stats.idopontfoglalasok.kimenetSzerint.length,
      build: () =>
        toCsv(stats.idopontfoglalasok.kimenetSzerint, [
          { header: 'kimenet', value: 'kimenet' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'idopontok_csucs_orak',
      category: 'system',
      stem: 'idopontok_csucs_orak',
      label: 'Időpontok — csúcsidők (óránként)',
      description: '0..23 óra szerinti darabszám (Europe/Budapest).',
      rowCount: stats.idopontfoglalasok.csucsOrak.length,
      build: () =>
        toCsv(stats.idopontfoglalasok.csucsOrak, [
          { header: 'ora', value: 'ora' },
          { header: 'cimke', value: 'cimke' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'idopontok_napi_eloszlas',
      category: 'system',
      stem: 'idopontok_napi_eloszlas',
      label: 'Időpontok — hét napjai szerint',
      description: 'ISO hétfő-első nap-index (1..7) szerinti megoszlás.',
      rowCount: stats.idopontfoglalasok.napiEloszlas.length,
      build: () =>
        toCsv(stats.idopontfoglalasok.napiEloszlas, [
          { header: 'nap_idx', value: 'napIdx' },
          { header: 'nap_nev', value: 'napNev' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'aktivitas_muvelet_szerint',
      category: 'system',
      stem: 'aktivitas_muvelet_szerint',
      label: 'Aktivitás — művelet szerint (top 10)',
      description: 'activity_logs.action top 10 leggyakoribb értéke.',
      rowCount: stats.aktivitas.muveletSzerint.length,
      build: () =>
        toCsv(stats.aktivitas.muveletSzerint, [
          { header: 'muvelet', value: 'muvelet' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'aktivitas_felhasznalo_szerint',
      category: 'system',
      stem: 'aktivitas_felhasznalo_szerint',
      label: 'Aktivitás — felhasználó szerint (top 10)',
      description: 'activity_logs.user_email top 10 legaktívabb.',
      rowCount: stats.aktivitas.felhasznaloSzerint.length,
      build: () =>
        toCsv(stats.aktivitas.felhasznaloSzerint, [
          { header: 'felhasznalo', value: 'felhasznalo' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'visszajelzesek_status_szerint',
      category: 'system',
      stem: 'visszajelzesek_status_szerint',
      label: 'Visszajelzések — státusz szerint',
      description: 'feedback.status megoszlása.',
      rowCount: stats.visszajelzesek.statusSzerint.length,
      build: () =>
        toCsv(stats.visszajelzesek.statusSzerint, [
          { header: 'status', value: 'status' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'visszajelzesek_tipus_szerint',
      category: 'system',
      stem: 'visszajelzesek_tipus_szerint',
      label: 'Visszajelzések — típus szerint',
      description: 'feedback.type megoszlása.',
      rowCount: stats.visszajelzesek.tipusSzerint.length,
      build: () =>
        toCsv(stats.visszajelzesek.tipusSzerint, [
          { header: 'tipus', value: 'tipus' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'betegek_eletkor_kohorszok',
      category: 'system',
      stem: 'betegek_eletkor_kohorszok',
      label: 'Betegek — életkor kohorszok',
      description: '10-éves életkor sávok (0-17 .. 80+); csak halal_datum IS NULL.',
      rowCount: stats.betegek.eletkor.kohorszok.length,
      build: () =>
        toCsv(stats.betegek.eletkor.kohorszok, [
          { header: 'kohorsz_idx', value: 'kohorszIdx' },
          { header: 'kohorsz', value: 'kohorsz' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'betegek_eletkor_stat',
      category: 'system',
      stem: 'betegek_eletkor_stat',
      label: 'Betegek — életkor leíró stat (1 sor)',
      description: 'Átlag, medián, min, max élő betegek életkorára.',
      rowCount: 1,
      build: () =>
        toCsv([stats.betegek.eletkor], [
          { header: 'minta_szam', value: 'mintaSzam' },
          { header: 'atlag_ev', value: 'atlagEv' },
          { header: 'median_ev', value: 'medianEv' },
          { header: 'min_ev', value: 'minEv' },
          { header: 'max_ev', value: 'maxEv' },
        ]),
    },
    {
      id: 'betegek_intake_status',
      category: 'system',
      stem: 'betegek_intake_status',
      label: 'Betegek — intake állapot',
      description: 'patients.intake_status megoszlása (élő betegek).',
      rowCount: stats.betegek.intakeStatusSzerint.length,
      build: () =>
        toCsv(stats.betegek.intakeStatusSzerint, [
          { header: 'intake_status', value: 'intakeStatus' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'idopontok_booking_lead_hisztogram',
      category: 'system',
      stem: 'idopontok_booking_lead_hisztogram',
      label: 'Időpontok — booking lead hisztogram',
      description: '<1 / 1-3 / 4-7 / 8-14 / 15-30 / 31-60 / 61-90 / 90+ nap eloszlás.',
      rowCount: stats.idopontfoglalasok.bookingLeadTime.hisztogram.length,
      build: () =>
        toCsv(stats.idopontfoglalasok.bookingLeadTime.hisztogram, [
          { header: 'sav_idx', value: 'savIdx' },
          { header: 'sav', value: 'sav' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'idopontok_booking_lead_stat',
      category: 'system',
      stem: 'idopontok_booking_lead_stat',
      label: 'Időpontok — booking lead leíró stat (1 sor)',
      description: 'Átlag/medián/p25/p75/min/max napokban + minta-méret.',
      rowCount: 1,
      build: () =>
        toCsv([stats.idopontfoglalasok.bookingLeadTime], [
          { header: 'minta_szam', value: 'mintaSzam' },
          { header: 'atlag_napok', value: 'atlagNapok' },
          { header: 'median_napok', value: 'medianNapok' },
          { header: 'p25_napok', value: 'p25Napok' },
          { header: 'p75_napok', value: 'p75Napok' },
          { header: 'min_napok', value: 'minNapok' },
          { header: 'max_napok', value: 'maxNapok' },
        ]),
    },
    {
      id: 'uzenetek_kuldo_tipus_szerint',
      category: 'system',
      stem: 'uzenetek_kuldo_tipus_szerint',
      label: 'Portál üzenetek — küldő típus szerint',
      description: 'messages.sender_type szerint összes + olvasatlan.',
      rowCount: stats.uzenetek.kuldoTipusSzerint.length,
      build: () =>
        toCsv(stats.uzenetek.kuldoTipusSzerint, [
          { header: 'kuldo_tipus', value: 'kuldoTipus' },
          { header: 'osszes', value: 'osszes' },
          { header: 'olvasatlan', value: 'olvasatlan' },
        ]),
    },
  ];
}

function buildMedicalDatasets(med: MedicalStats | null): DatasetDef[] {
  if (!med) return [];
  return [
    {
      id: 'bno_eloszlas',
      category: 'medical',
      stem: 'bno_eloszlas',
      label: 'BNO kódok előfordulása',
      description: 'patient_anamnesis.bno (vesszővel tagolt → unnest) gyakoriság szerint.',
      rowCount: med.bno.data.length,
      build: () =>
        toCsv(med.bno.data, [
          { header: 'kod', value: 'kod' },
          { header: 'nev', value: 'nev' },
          { header: 'elofordulas', value: 'elofordulas' },
        ]),
    },
    {
      id: 'beutalo_orvosok',
      category: 'medical',
      stem: 'beutalo_orvosok',
      label: 'Beutaló orvosok eloszlása',
      description: 'patient_referral.beutalo_orvos gyakoriság szerint.',
      rowCount: med.referringDoctors.data.length,
      build: () =>
        toCsv(med.referringDoctors.data, [
          { header: 'orvos', value: 'orvos' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'dmf_eloszlas',
      category: 'medical',
      stem: 'dmf_eloszlas',
      label: 'DMF index — eloszlás',
      description: 'Hányadik DMF értéknél hány beteg található (per-betegszámolás).',
      rowCount: med.dmfDistribution.data.length,
      build: () =>
        toCsv(med.dmfDistribution.data, [
          { header: 'dmft', value: 'dmft' },
          { header: 'beteg_szama', value: 'betegSzama' },
        ]),
    },
    {
      id: 'dmf_stats',
      category: 'medical',
      stem: 'dmf_stats',
      label: 'DMF index — leíró stat (1 sor)',
      description: 'Átlag, medián, szórás, min, max — egy soros összefoglaló.',
      rowCount: 1,
      build: () =>
        toCsv([med.dmfDistribution.stats], [
          { header: 'atlag', value: 'atlag' },
          { header: 'median', value: 'median' },
          { header: 'szoras', value: 'szoras' },
          { header: 'min', value: 'min' },
          { header: 'max', value: 'max' },
        ]),
    },
    {
      id: 'fog_poziciok',
      category: 'medical',
      stem: 'fog_poziciok',
      label: 'Fogak helyzete (Zsigmondy)',
      description: 'Fogszámonként D/F/M/egészséges/összes.',
      rowCount: med.toothPositions.data.length,
      build: () =>
        toCsv(med.toothPositions.data, [
          { header: 'fog_szam', value: 'fogSzam' },
          { header: 'd_szama', value: 'dSzama' },
          { header: 'f_szama', value: 'fSzama' },
          { header: 'm_szama', value: 'mSzama' },
          { header: 'egeszseges', value: 'egeszsSeges' },
          { header: 'osszes', value: 'osszes' },
        ]),
    },
    {
      id: 'implant_poziciok',
      category: 'medical',
      stem: 'implant_poziciok',
      label: 'Implantátumok helyzete (Zsigmondy)',
      description: 'Fogszámonként implantátumok darabszáma.',
      rowCount: med.implantPositions.data.length,
      build: () =>
        toCsv(med.implantPositions.data, [
          { header: 'fog_szam', value: 'fogSzam' },
          { header: 'implantatum_szama', value: 'implantatumSzama' },
        ]),
    },
    {
      id: 'varakozasi_ido',
      category: 'medical',
      stem: 'varakozasi_ido',
      label: 'Várakozási idő (1 sor)',
      description: 'Átlag / medián / szórás / min / max napokban + minta-méret.',
      rowCount: 1,
      build: () =>
        toCsv([med.waitingTime], [
          { header: 'atlag_napokban', value: 'atlagNapokban' },
          { header: 'median_napokban', value: 'medianNapokban' },
          { header: 'szoras_napokban', value: 'szorasNapokban' },
          { header: 'min_napokban', value: 'minNapokban' },
          { header: 'max_napokban', value: 'maxNapokban' },
          { header: 'beteg_szama_idoponttal', value: 'betegSzamaIdoponttal' },
        ]),
    },
    {
      id: 'orvos_leterheltseg',
      category: 'medical',
      stem: 'orvos_leterheltseg',
      label: 'Orvosok leterheltsége',
      description: 'Jövőbeli foglalt / elérhető / múltbeli foglalt slot-szám orvosonként.',
      rowCount: med.doctorWorkload.data.length,
      build: () =>
        toCsv(med.doctorWorkload.data, [
          { header: 'orvos_nev', value: 'orvosNev' },
          { header: 'orvos_email', value: 'orvosEmail' },
          { header: 'jovobeli_idopontok_szama', value: 'jovobeliIdopontokSzama' },
          { header: 'elerheto_idopontok_szama', value: 'elerhetoIdopontokSzama' },
          { header: 'multbeli_idopontok_szama', value: 'multbeliIdopontokSzama' },
        ]),
    },
    {
      id: 'ohip14_idopontok',
      category: 'medical',
      stem: 'ohip14_idopontok',
      label: 'OHIP-14 időpontok szerint',
      description: 'T0..T3 időpontonként kitöltések száma + átlag/medián total score.',
      rowCount: med.ohip14.idopontokSzerint.length,
      build: () =>
        toCsv(med.ohip14.idopontokSzerint, [
          { header: 'timepoint', value: 'timepoint' },
          { header: 'kitoltesek_szama', value: 'kitoltesekSzama' },
          { header: 'betegek_szama', value: 'betegekSzama' },
          { header: 'atlag_total_score', value: 'atlagTotalScore' },
          { header: 'median_total_score', value: 'medianTotalScore' },
        ]),
    },
    {
      id: 'kezelesi_terv_osszesito',
      category: 'medical',
      stem: 'kezelesi_terv_osszesito',
      label: 'Kezelési tervek — összesítő (1 sor)',
      description: 'Felső / alsó / arcot érintő tervsorok és elkészült darabok.',
      rowCount: 1,
      build: () =>
        toCsv([med.treatmentPlans], [
          { header: 'betegek_kiosztott_tervvel', value: 'betegekKiosztottTervvel' },
          { header: 'osszes_terv_sor_felson', value: 'osszesTervSorAFelson' },
          { header: 'osszes_terv_sor_also', value: 'osszesTervSorAlso' },
          { header: 'osszes_terv_sor_arcot_erinto', value: 'osszesTervSorArcotErinto' },
          { header: 'elkeszult_felson', value: 'elkeszultFelson' },
          { header: 'elkeszult_also', value: 'elkeszultAlso' },
          { header: 'elkeszult_arcot_erinto', value: 'elkeszultArcotErinto' },
        ]),
    },
    {
      id: 'kezelesi_terv_fogpotlas_tipus',
      category: 'medical',
      stem: 'kezelesi_terv_fogpotlas_tipus',
      label: 'Kezelési tervek — fogpótlás típus szerint',
      description: 'felső + alsó tervsorok aggregálva treatment_types kód szerint.',
      rowCount: med.treatmentPlans.fogpotlasTipusSzerint.length,
      build: () =>
        toCsv(med.treatmentPlans.fogpotlasTipusSzerint, [
          { header: 'kod', value: 'kod' },
          { header: 'label_hu', value: 'labelHu' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'kezelesi_terv_arcot_tipus',
      category: 'medical',
      stem: 'kezelesi_terv_arcot_tipus',
      label: 'Kezelési tervek — arcot érintő típus szerint',
      description: 'kezelesi_terv_arcot_erinto típus mező megoszlása.',
      rowCount: med.treatmentPlans.arcotErintoTipusSzerint.length,
      build: () =>
        toCsv(med.treatmentPlans.arcotErintoTipusSzerint, [
          { header: 'tipus', value: 'tipus' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'ohip14_t0t3_delta_stat',
      category: 'medical',
      stem: 'ohip14_t0t3_delta_stat',
      label: 'OHIP-14 T0→T3 delta — leíró stat (1 sor)',
      description: 'Átlag/medián/szórás Δ + javulók/változatlanok/romlók száma.',
      rowCount: 1,
      build: () =>
        toCsv([med.ohip14.t0t3Delta], [
          { header: 'paros_szam', value: 'parosSzam' },
          { header: 'atlag_delta', value: 'atlagDelta' },
          { header: 'median_delta', value: 'medianDelta' },
          { header: 'szoras_delta', value: 'szorasDelta' },
          { header: 'min_delta', value: 'minDelta' },
          { header: 'max_delta', value: 'maxDelta' },
          { header: 'javulok_szama', value: 'javulokSzama' },
          { header: 'valtozatlanok_szama', value: 'valtozatlanokSzama' },
          { header: 'romlok_szama', value: 'romlokSzama' },
        ]),
    },
    {
      id: 'ohip14_t0t3_delta_hisztogram',
      category: 'medical',
      stem: 'ohip14_t0t3_delta_hisztogram',
      label: 'OHIP-14 T0→T3 delta — hisztogram',
      description: 'Δ score sávok (≤-20 nagy javulás .. ≥20 nagy romlás).',
      rowCount: med.ohip14.t0t3Delta.hisztogram.length,
      build: () =>
        toCsv(med.ohip14.t0t3Delta.hisztogram, [
          { header: 'sav_idx', value: 'savIdx' },
          { header: 'sav', value: 'sav' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'kezelesi_terv_keszultseg',
      category: 'medical',
      stem: 'kezelesi_terv_keszultseg',
      label: 'Kezelési terv — készültség per beteg',
      description: 'Felső / alsó / arcot rácsra: minta + átlag % + medián % + teljesen kész.',
      rowCount: 3,
      build: () => {
        const rows = (['felso', 'also', 'arcot'] as const).map((key) => {
          const r = med.treatmentPlans.keszultseg[key];
          return {
            racs: key,
            minta_szam: r.mintaSzam,
            atlag_pct: r.atlagPct,
            median_pct: r.medianPct,
            teljesen_kesz: r.teljesenKesz,
          };
        });
        return toCsv(rows, [
          { header: 'racs', value: 'racs' },
          { header: 'minta_szam', value: 'minta_szam' },
          { header: 'atlag_pct', value: 'atlag_pct' },
          { header: 'median_pct', value: 'median_pct' },
          { header: 'teljesen_kesz', value: 'teljesen_kesz' },
        ]);
      },
    },
  ];
}

function buildAttemptsDatasets(attempts: UnsuccessfulAttemptsApi | null): DatasetDef[] {
  if (!attempts) return [];
  return [
    {
      id: 'sikertelen_orvos_szerint',
      category: 'attempts',
      stem: 'sikertelen_orvos_szerint',
      label: 'Sikertelen próbák — orvos szerint (top 10)',
      description: 'attempt_failed_by mezőre csoportosítva.',
      rowCount: attempts.byDoctor.length,
      build: () =>
        toCsv(attempts.byDoctor, [
          { header: 'orvos', value: 'doctor' },
          { header: 'darab', value: 'count' },
        ]),
    },
    {
      id: 'sikertelen_munkafazis_szerint',
      category: 'attempts',
      stem: 'sikertelen_munkafazis_szerint',
      label: 'Sikertelen próbák — munkafázis (top 10)',
      description: 'work_phase_code + label gyakoriság szerint.',
      rowCount: attempts.byWorkPhase.length,
      build: () =>
        toCsv(attempts.byWorkPhase, [
          { header: 'work_phase_code', value: 'workPhaseCode' },
          { header: 'label', value: 'label' },
          { header: 'darab', value: 'count' },
        ]),
    },
    {
      id: 'sikertelen_top_indokok',
      category: 'attempts',
      stem: 'sikertelen_top_indokok',
      label: 'Sikertelen próbák — top indokok',
      description: 'attempt_failed_reason top 10 leggyakoribb szöveg.',
      rowCount: attempts.topReasons.length,
      build: () =>
        toCsv(attempts.topReasons, [
          { header: 'indok', value: 'reason' },
          { header: 'darab', value: 'count' },
        ]),
    },
    {
      id: 'sikertelen_indok_template',
      category: 'attempts',
      stem: 'sikertelen_indok_template',
      label: 'Sikertelen próbák — kanonikus sablon szerint',
      description: 'Kanonikus chip-sablonok + "Egyéb" gyűjtő.',
      rowCount: attempts.reasonsByTemplate.length,
      build: () =>
        toCsv(attempts.reasonsByTemplate, [
          { header: 'template', value: 'template' },
          { header: 'kanonikus', value: 'canonical' },
          { header: 'darab', value: 'count' },
        ]),
    },
    {
      id: 'sikertelen_heti_trend',
      category: 'attempts',
      stem: 'sikertelen_heti_trend',
      label: 'Sikertelen próbák — heti trend (max 26 hét)',
      description: 'date_trunc(week, attempt_failed_at) szerint csoportosítva.',
      rowCount: attempts.weeklyTrend.length,
      build: () =>
        toCsv(attempts.weeklyTrend, [
          { header: 'het_kezdete', value: 'weekStart' },
          { header: 'darab', value: 'count' },
        ]),
    },
    {
      id: 'sikertelen_recent_minta',
      category: 'attempts',
      stem: 'sikertelen_recent_minta',
      label: 'Sikertelen próbák — friss minta (10 sor)',
      description: 'A 10 legfrissebb sikertelen jelölés (audit context).',
      rowCount: attempts.recent.length,
      build: () =>
        toCsv(attempts.recent, [
          { header: 'failed_at', value: 'failedAt' },
          { header: 'failed_by', value: 'failedBy' },
          { header: 'beteg_id', value: 'patientId' },
          { header: 'beteg_nev', value: 'patientName' },
          { header: 'work_phase_code', value: 'workPhaseCode' },
          { header: 'work_phase_label', value: 'workPhaseLabel' },
          { header: 'attempt_number', value: 'attemptNumber' },
          { header: 'appointment_id', value: 'appointmentId' },
          { header: 'appointment_start', value: 'appointmentStart' },
          { header: 'reason', value: 'reason' },
        ]),
    },
    {
      id: 'sikertelen_attempt_eloszlas',
      category: 'attempts',
      stem: 'sikertelen_attempt_eloszlas',
      label: 'Attempt-number eloszlás (összes idejű)',
      description: 'Hány (episode_id, step_code) pár igényelt N próbát.',
      rowCount: attempts.attemptDistribution.length,
      build: () =>
        toCsv(attempts.attemptDistribution, [
          { header: 'max_attempts', value: 'maxAttempts' },
          { header: 'paros_szam', value: 'parosSzam' },
        ]),
    },
    {
      id: 'sikertelen_attempt_osszesito',
      category: 'attempts',
      stem: 'sikertelen_attempt_osszesito',
      label: 'Attempt-number összesítő (1 sor)',
      description: 'Step-instance-ek 1 / 2 / 3+ próba bontásban + többszörös arány.',
      rowCount: 1,
      build: () =>
        toCsv([attempts.attemptDistributionSummary], [
          { header: 'osszes_step_instance', value: 'osszesStepInstance' },
          { header: 'egy_proba', value: 'egyProba' },
          { header: 'ket_proba', value: 'ketProba' },
          { header: 'harom_vagy_tobb_proba', value: 'haromVagyTobbProba' },
          { header: 'tobbszor_pct', value: 'tobbszorPct' },
        ]),
    },
  ];
}

function buildPipelineDatasets(pipeline: PipelineApiResponse | null): DatasetDef[] {
  if (!pipeline) return [];
  return [
    {
      id: 'episode_status',
      category: 'pipeline',
      stem: 'episode_status',
      label: 'Episode-ok státusz szerint',
      description: 'patient_episodes.status (open / closed / paused) megoszlás.',
      rowCount: pipeline.episodeStatus.length,
      build: () =>
        toCsv(pipeline.episodeStatus, [
          { header: 'status', value: 'status' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'episode_lifetime_lezart',
      category: 'pipeline',
      stem: 'episode_lifetime_lezart',
      label: 'Episode élettartam (lezárt) — leíró stat (1 sor)',
      description: 'Átlag/medián/IQR/min/max napokban + minta-méret.',
      rowCount: 1,
      build: () =>
        toCsv([pipeline.episodeLifetime.lezart], [
          { header: 'minta_szam', value: 'mintaSzam' },
          { header: 'atlag_napok', value: 'atlagNapok' },
          { header: 'median_napok', value: 'medianNapok' },
          { header: 'p25_napok', value: 'p25Napok' },
          { header: 'p75_napok', value: 'p75Napok' },
          { header: 'min_napok', value: 'minNapok' },
          { header: 'max_napok', value: 'maxNapok' },
        ]),
    },
    {
      id: 'episode_lifetime_nyitott',
      category: 'pipeline',
      stem: 'episode_lifetime_nyitott',
      label: 'Episode élettartam (nyitott) — leíró stat (1 sor)',
      description: 'Nyitott episode-ok jelenlegi kor-statisztikája.',
      rowCount: 1,
      build: () =>
        toCsv([pipeline.episodeLifetime.nyitott], [
          { header: 'minta_szam', value: 'mintaSzam' },
          { header: 'atlag_napok', value: 'atlagNapok' },
          { header: 'median_napok', value: 'medianNapok' },
          { header: 'p75_napok', value: 'p75Napok' },
          { header: 'max_napok', value: 'maxNapok' },
        ]),
    },
    {
      id: 'workphase_totals',
      category: 'pipeline',
      stem: 'workphase_totals',
      label: 'Munkafázis összesítő (top 15 kód)',
      description: 'work_phase_code per össz / kész / pending / scheduled / skipped + kész %.',
      rowCount: pipeline.workPhaseTotals.length,
      build: () =>
        toCsv(pipeline.workPhaseTotals, [
          { header: 'work_phase_code', value: 'workPhaseCode' },
          { header: 'label_hu', value: 'labelHu' },
          { header: 'osszes', value: 'osszes' },
          { header: 'kesz', value: 'kesz' },
          { header: 'pending', value: 'pending' },
          { header: 'scheduled', value: 'scheduled' },
          { header: 'skipped', value: 'skipped' },
          { header: 'kesz_pct', value: 'keszPct' },
        ]),
    },
    {
      id: 'workphase_matrix',
      category: 'pipeline',
      stem: 'workphase_matrix',
      label: 'Munkafázis × státusz mátrix (long format)',
      description: 'Top 15 work_phase_code × status long-format dataframe.',
      rowCount: pipeline.workPhaseMatrix.length,
      build: () =>
        toCsv(pipeline.workPhaseMatrix, [
          { header: 'work_phase_code', value: 'workPhaseCode' },
          { header: 'label_hu', value: 'labelHu' },
          { header: 'status', value: 'status' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'workphase_stuck_top',
      category: 'pipeline',
      stem: 'workphase_stuck_top',
      label: `"Ragadt" munkafázisok (>${pipeline.stuckDaysThreshold} nap, top 10)`,
      description: 'Pending/scheduled work-phase-ek > kuszob nappal létrehozva.',
      rowCount: pipeline.stuckWorkPhases.top.length,
      build: () =>
        toCsv(pipeline.stuckWorkPhases.top, [
          { header: 'work_phase_code', value: 'workPhaseCode' },
          { header: 'label_hu', value: 'labelHu' },
          { header: 'status', value: 'status' },
          { header: 'darab', value: 'darab' },
          { header: 'legidosebb_napok', value: 'legidosebbNapok' },
        ]),
    },
  ];
}

function buildOperationalDatasets(ops: OperationalApiResponse | null): DatasetDef[] {
  if (!ops) return [];
  return [
    {
      id: 'user_tasks_osszesito',
      category: 'operational',
      stem: 'user_tasks_osszesito',
      label: 'Felhasználói feladatok — összesítő (1 sor)',
      description: 'Összes / nyitott / kész / törölt / lejárt + medián megoldási idő.',
      rowCount: 1,
      build: () =>
        toCsv([ops.userTasks.osszesito], [
          { header: 'osszes', value: 'osszes' },
          { header: 'nyitott', value: 'nyitott' },
          { header: 'kesz', value: 'kesz' },
          { header: 'torolt', value: 'torolt' },
          { header: 'lejart', value: 'lejart' },
          { header: 'median_megoldasi_napok', value: 'medianMegoldasiNapok' },
        ]),
    },
    {
      id: 'user_tasks_tipus_szerint',
      category: 'operational',
      stem: 'user_tasks_tipus_szerint',
      label: 'Felhasználói feladatok — típus szerint',
      description: 'task_type × {össz, nyitott, kész, törölt, medián megoldás}.',
      rowCount: ops.userTasks.tipusSzerint.length,
      build: () =>
        toCsv(ops.userTasks.tipusSzerint, [
          { header: 'task_type', value: 'taskType' },
          { header: 'osszes', value: 'osszes' },
          { header: 'nyitott', value: 'nyitott' },
          { header: 'kesz', value: 'kesz' },
          { header: 'torolt', value: 'torolt' },
          { header: 'median_megoldasi_napok', value: 'medianMegoldasiNapok' },
        ]),
    },
    {
      id: 'user_tasks_assignee_kind',
      category: 'operational',
      stem: 'user_tasks_assignee_kind',
      label: 'Felhasználói feladatok — címzett típus szerint',
      description: 'staff vs patient delegálás összes + nyitott bontás.',
      rowCount: ops.userTasks.assigneeKindSzerint.length,
      build: () =>
        toCsv(ops.userTasks.assigneeKindSzerint, [
          { header: 'assignee_kind', value: 'assigneeKind' },
          { header: 'osszes', value: 'osszes' },
          { header: 'nyitott', value: 'nyitott' },
        ]),
    },
    {
      id: 'user_tasks_lejarat',
      category: 'operational',
      stem: 'user_tasks_lejarat',
      label: 'Felhasználói feladatok — lejárat (1 sor)',
      description: 'Legrégebben nyitva napok + lejárt feladatok átlag túl-napjai.',
      rowCount: 1,
      build: () =>
        toCsv([ops.userTasks.lejarat], [
          { header: 'legregebben_nyitva_napok', value: 'legregebbenNyitvaNapok' },
          { header: 'lejart_atlag_napok', value: 'lejartAtlagNapok' },
        ]),
    },
  ];
}

function buildConsiliumDatasets(consilium: ConsiliumApiResponse | null): DatasetDef[] {
  if (!consilium) return [];
  return [
    {
      id: 'consilium_sessions_osszesito',
      category: 'consilium',
      stem: 'consilium_sessions_osszesito',
      label: 'Konzílium ülések — összesítő (1 sor)',
      description: 'Összes / múltbeli / jövőbeli + status × {draft, active, closed} + átl. napirendi pont.',
      rowCount: 1,
      build: () =>
        toCsv([consilium.sessions.summary], [
          { header: 'osszes', value: 'osszes' },
          { header: 'multbeli', value: 'multbeli' },
          { header: 'jovobeli', value: 'jovobeli' },
          { header: 'draft', value: 'draft' },
          { header: 'active', value: 'active' },
          { header: 'closed', value: 'closed' },
          { header: 'atlag_napirendi_pont', value: 'atlagNapirendiPont' },
        ]),
    },
    {
      id: 'consilium_sessions_status_szerint',
      category: 'consilium',
      stem: 'consilium_sessions_status_szerint',
      label: 'Konzílium ülések — státusz szerint',
      description: 'consilium_sessions.status megoszlás.',
      rowCount: consilium.sessions.statusSzerint.length,
      build: () =>
        toCsv(consilium.sessions.statusSzerint, [
          { header: 'status', value: 'status' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'consilium_sessions_heti_trend',
      category: 'consilium',
      stem: 'consilium_sessions_heti_trend',
      label: 'Konzílium ülések — heti trend',
      description: 'Utolsó 26 hét + 12 hét előretekintés (scheduled_at szerint).',
      rowCount: consilium.sessions.hetiTrend.length,
      build: () =>
        toCsv(consilium.sessions.hetiTrend, [
          { header: 'het_kezdete', value: 'hetKezdete' },
          { header: 'darab', value: 'darab' },
        ]),
    },
    {
      id: 'consilium_coverage',
      category: 'consilium',
      stem: 'consilium_coverage',
      label: 'Konzílium item coverage (1 sor)',
      description: 'Discussed item-ek aránya: discussed/összes + per-session átlag/medián %.',
      rowCount: 1,
      build: () => {
        const row = {
          osszes_item: consilium.coverage.osszesItem,
          discussed_item: consilium.coverage.discussedItem,
          coverage_pct: consilium.coverage.coveragePct,
          per_session_szam: consilium.coverage.perSession.sessionSzam,
          per_session_atlag_pct: consilium.coverage.perSession.atlagCoveragePct,
          per_session_median_pct: consilium.coverage.perSession.medianCoveragePct,
        };
        return toCsv([row], [
          { header: 'osszes_item', value: 'osszes_item' },
          { header: 'discussed_item', value: 'discussed_item' },
          { header: 'coverage_pct', value: 'coverage_pct' },
          { header: 'per_session_szam', value: 'per_session_szam' },
          { header: 'per_session_atlag_pct', value: 'per_session_atlag_pct' },
          { header: 'per_session_median_pct', value: 'per_session_median_pct' },
        ]);
      },
    },
    {
      id: 'consilium_attendance_osszesito',
      category: 'consilium',
      stem: 'consilium_attendance_osszesito',
      label: 'Konzílium részvétel — összesítő (1 sor)',
      description: 'Bejelentett vs jelen-lévő tagok session-ként; részvételi arány.',
      rowCount: consilium.attendance.available ? 1 : 0,
      build: () =>
        toCsv([consilium.attendance.summary], [
          { header: 'session_szam', value: 'sessionSzam' },
          { header: 'atlag_bejelentett', value: 'atlagBejelentett' },
          { header: 'median_bejelentett', value: 'medianBejelentett' },
          { header: 'atlag_jelen', value: 'atlagJelen' },
          { header: 'median_jelen', value: 'medianJelen' },
          { header: 'osszes_bejelentett', value: 'osszesBejelentett' },
          { header: 'osszes_jelen', value: 'osszesJelen' },
          { header: 'reszveteli_arany_pct', value: 'reszveteliAranyPct' },
        ]),
    },
    {
      id: 'consilium_top_attendees',
      category: 'consilium',
      stem: 'consilium_top_attendees',
      label: 'Konzílium top 15 résztvevő',
      description: 'Név alapján csoportosítva: meghívás × jelenlét.',
      rowCount: consilium.attendance.topAttendees.length,
      build: () =>
        toCsv(consilium.attendance.topAttendees, [
          { header: 'attendee_id', value: 'attendeeId' },
          { header: 'attendee_name', value: 'attendeeName' },
          { header: 'osszes_meghivas', value: 'osszesMeghivas' },
          { header: 'osszes_jelen', value: 'osszesJelen' },
        ]),
    },
    {
      id: 'consilium_prep_tokens',
      category: 'consilium',
      stem: 'consilium_prep_tokens',
      label: 'Konzílium prep tokenek (1 sor)',
      description: 'Kiállított / aktív / visszavont / lejárt + tokent kapott napirendi pont szám.',
      rowCount: consilium.prepTokens.available ? 1 : 0,
      build: () =>
        toCsv([consilium.prepTokens], [
          { header: 'kiallitott', value: 'kiallitott' },
          { header: 'aktiv', value: 'aktiv' },
          { header: 'visszavont', value: 'visszavont' },
          { header: 'lejart', value: 'lejart' },
          { header: 'tokenezett_item_szam', value: 'tokenezettItemSzam' },
        ]),
    },
    {
      id: 'consilium_prep_comments_osszesito',
      category: 'consilium',
      stem: 'consilium_prep_comments_osszesito',
      label: 'Konzílium prep kommentek (1 sor)',
      description: 'Összes komment + kommentelt item szám + átlag/medián per kommentelt item.',
      rowCount: consilium.prepComments.available ? 1 : 0,
      build: () =>
        toCsv([consilium.prepComments], [
          { header: 'osszes_komment', value: 'osszesKomment' },
          { header: 'kommentelt_item_szam', value: 'kommenteltItemSzam' },
          { header: 'atlag_komment_per_kommentelt_item', value: 'atlagKommentPerKommenteltItem' },
          { header: 'median_komment_per_kommentelt_item', value: 'medianKommentPerKommenteltItem' },
        ]),
    },
    {
      id: 'consilium_top_authors',
      category: 'consilium',
      stem: 'consilium_top_authors',
      label: 'Konzílium top 10 kommentelő',
      description: 'author_display szerint: kommentszám + érintett item szám.',
      rowCount: consilium.prepComments.topAuthors.length,
      build: () =>
        toCsv(consilium.prepComments.topAuthors, [
          { header: 'author_display', value: 'authorDisplay' },
          { header: 'komment_szam', value: 'kommentSzam' },
          { header: 'erintett_item_szam', value: 'erintettItemSzam' },
        ]),
    },
  ];
}

interface StatsCsvExportProps {
  /** A parent által már lekért rendszer-statisztika (kötelező). */
  stats: AdminStats | null;
  /** Pipeline endpoint válasza (parent szekciója fetcheli; opcionális). */
  pipeline?: PipelineApiResponse | null;
  /** Operatív SLA endpoint válasza (parent szekciója fetcheli; opcionális). */
  operational?: OperationalApiResponse | null;
  /** Konzílium endpoint válasza (parent szekciója fetcheli; opcionális). */
  consilium?: ConsiliumApiResponse | null;
}

/** Sleep so that sequential downloads don't trigger a "túl sok letöltés" prompt. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function StatsCsvExport({
  stats,
  pipeline = null,
  operational = null,
  consilium = null,
}: StatsCsvExportProps) {
  const [medical, setMedical] = useState<MedicalStats | null>(null);
  const [medicalLoading, setMedicalLoading] = useState(false);
  const [medicalError, setMedicalError] = useState<string | null>(null);

  const [attempts, setAttempts] = useState<UnsuccessfulAttemptsApi | null>(null);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const [attemptsUnavailable, setAttemptsUnavailable] = useState(false);

  const [bulkRunning, setBulkRunning] = useState(false);

  const loadMedical = useCallback(async () => {
    setMedicalLoading(true);
    setMedicalError(null);
    try {
      const res = await fetch('/api/admin/stats/medical', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as MedicalStats;
        setMedical(data);
      } else {
        const body = await res.json().catch(() => ({}));
        setMedicalError(body?.error || `Hiba (HTTP ${res.status})`);
      }
    } catch {
      setMedicalError('Hálózati hiba a szakmai statisztikák betöltésekor');
    } finally {
      setMedicalLoading(false);
    }
  }, []);

  const loadAttempts = useCallback(async () => {
    setAttemptsLoading(true);
    setAttemptsError(null);
    setAttemptsUnavailable(false);
    try {
      // days=0 → minden idejű adat (legjobb R-elemzéshez).
      const res = await fetch('/api/admin/stats/unsuccessful-attempts?days=0', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as UnsuccessfulAttemptsApi;
        setAttempts(data);
      } else if (res.status === 503) {
        setAttemptsUnavailable(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setAttemptsError(body?.error || `Hiba (HTTP ${res.status})`);
      }
    } catch {
      setAttemptsError('Hálózati hiba a sikertelen próbák betöltésekor');
    } finally {
      setAttemptsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMedical();
    loadAttempts();
  }, [loadMedical, loadAttempts]);

  const datasets = useMemo<DatasetDef[]>(() => {
    if (!stats) return [];
    return [
      ...buildSystemDatasets(stats),
      ...buildPipelineDatasets(pipeline),
      ...buildOperationalDatasets(operational),
      ...buildConsiliumDatasets(consilium),
      ...buildMedicalDatasets(medical),
      ...buildAttemptsDatasets(attempts),
    ];
  }, [stats, pipeline, operational, consilium, medical, attempts]);

  const grouped = useMemo(() => {
    const order: DatasetCategory[] = [
      'overview',
      'system',
      'pipeline',
      'operational',
      'consilium',
      'medical',
      'attempts',
    ];
    return order.map((cat) => ({
      cat,
      meta: CATEGORY_META[cat],
      items: datasets.filter((d) => d.category === cat),
    }));
  }, [datasets]);

  const triggerOne = useCallback((dataset: DatasetDef) => {
    const csv = dataset.build();
    if (csv == null) return;
    const filename = `${dataset.stem}_${todayIso()}.csv`;
    downloadCsv(filename, csv);
  }, []);

  const triggerAll = useCallback(async () => {
    if (datasets.length === 0) return;
    setBulkRunning(true);
    try {
      for (const ds of datasets) {
        triggerOne(ds);
        // ~120 ms között a böngésző még megengedi a sorozatos letöltéseket
        // anélkül hogy "Engedélyezi több fájl letöltését?" promptot dobna.
        await sleep(150);
      }
    } finally {
      setBulkRunning(false);
    }
  }, [datasets, triggerOne]);

  const totalRows = datasets.reduce((s, d) => s + (d.rowCount ?? 0), 0);

  return (
    <section
      id="stats-export"
      className="card scroll-mt-28 border-emerald-200/80 shadow-soft-md"
      aria-labelledby="stats-export-heading"
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-emerald-100 p-2 text-emerald-700">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 id="stats-export-heading" className="text-lg font-semibold text-gray-900">
              Adatexport (CSV)
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Aggregált dataframe-ek letöltése későbbi R / pandas elemzésre — UTF-8
              + BOM, vesszős, CRLF (RFC 4180).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={triggerAll}
            disabled={bulkRunning || datasets.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 shadow-soft transition-colors hover:bg-emerald-100 disabled:opacity-50"
            title="Minden dataframe egyenkénti letöltése"
          >
            {bulkRunning ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Mind letöltése ({datasets.length})
          </button>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs text-emerald-900">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p>
              Az aktuális rendszer-statisztika oldal frissítésekor látott aggregátumok kerülnek
              exportálásra ({totalRows.toLocaleString('hu-HU')} sor összesen). R-ben:
            </p>
            <pre className="overflow-x-auto rounded bg-white/80 px-2 py-1 font-mono text-[11px] text-emerald-900">
{`# tidyverse:
df <- readr::read_csv("betegek_havi_trend_${todayIso()}.csv")

# base R (BOM-tudatosan):
df <- read.csv("betegek_havi_trend_${todayIso()}.csv",
               fileEncoding = "UTF-8-BOM", na.strings = "")`}
            </pre>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {grouped.map(({ cat, meta, items }) => {
          const isMedical = cat === 'medical';
          const isAttempts = cat === 'attempts';
          const loading = (isMedical && medicalLoading) || (isAttempts && attemptsLoading);
          const errorMsg = (isMedical && medicalError) || (isAttempts && attemptsError) || null;
          const unavailable = isAttempts && attemptsUnavailable;

          return (
            <div
              key={cat}
              className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-white to-gray-50/40 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{meta.title}</h3>
                  <p className="mt-0.5 text-xs text-gray-500">{meta.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  {loading ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Betöltés…
                    </span>
                  ) : null}
                  {(isMedical || isAttempts) && !loading ? (
                    <button
                      type="button"
                      onClick={isMedical ? loadMedical : loadAttempts}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      title="Adat újratöltése"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Újratöltés
                    </button>
                  ) : null}
                </div>
              </div>

              {errorMsg ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              ) : unavailable ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    A 029-es migráció még nem futott le ezen az adatbázison — a sikertelen
                    próbák statisztika nem érhető el.
                  </span>
                </div>
              ) : items.length === 0 && !loading ? (
                <p className="text-xs text-gray-500">Nincs elérhető dataframe.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {items.map((ds) => (
                    <li
                      key={ds.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                          <p className="truncate text-sm font-medium text-gray-900" title={ds.label}>
                            {ds.label}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{ds.description}</p>
                        <p className="mt-1 font-mono text-[11px] text-gray-400">
                          {ds.stem}_{todayIso()}.csv
                          {ds.rowCount != null ? ` · ${ds.rowCount} sor` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => triggerOne(ds)}
                        disabled={ds.rowCount === 0}
                        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 shadow-soft transition-colors hover:bg-gray-50 disabled:opacity-50"
                        title="CSV letöltése"
                      >
                        <Download className="h-3.5 w-3.5" />
                        CSV
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
