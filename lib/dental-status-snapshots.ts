import { getDbPool } from '@/lib/db';
import { applyTreatmentOutcome, projectFogakWithTreatments } from '@/lib/tooth-treatment-outcome';

/** pg.Pool és pg.PoolClient is megfelel (mindkettőnek van `query`-je). */
interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

type Fogak = Record<string, unknown>;

export interface DentalStatusSnapshot {
  id: string;
  kind: 'baseline' | 'status';
  effectiveDate: string; // YYYY-MM-DD
  fogak: Fogak;
  note: string | null;
  sourceToothTreatmentId: string | null;
}

export interface DentalStatusTimeline {
  /** Kiindulási (felvételkori) állapot, ha rögzült már. */
  baseline: DentalStatusSnapshot | null;
  /** Datált státuszok időrendben (régebbi → újabb). */
  snapshots: DentalStatusSnapshot[];
  /** A nyitott kezelési igényekből származtatott célállapot (kezelési terv). */
  plan: Fogak;
  /** A jelenlegi élő odontogram (patient_dental_status.meglevo_fogak). */
  current: Fogak;
}

async function getCurrentFogak(db: Queryable, patientId: string): Promise<Fogak> {
  const res = await db.query(
    'SELECT meglevo_fogak AS fogak FROM patient_dental_status WHERE patient_id = $1',
    [patientId],
  );
  const raw = res.rows[0]?.fogak;
  return raw && typeof raw === 'object' ? (raw as Fogak) : {};
}

/**
 * Gondoskodik róla, hogy legyen kiindulási (baseline) felvétel. Ha nincs, a
 * megadott (változás előtti) odontogramot rögzíti felvételkori állapotként, a
 * beteg létrehozási dátumával. A unique index miatt versenyhelyzetben is biztonságos.
 */
async function ensureBaselineSnapshot(
  db: Queryable,
  patientId: string,
  fogak: Fogak,
  userId: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO dental_status_snapshots (patient_id, kind, effective_date, fogak, note, created_by)
     SELECT $1, 'baseline',
            COALESCE((SELECT created_at::date FROM patients WHERE id = $1), CURRENT_DATE),
            $2::jsonb, 'Kiindulási státusz (automatikusan rögzítve)', $3
     WHERE NOT EXISTS (
       SELECT 1 FROM dental_status_snapshots WHERE patient_id = $1 AND kind = 'baseline'
     )`,
    [patientId, JSON.stringify(fogak ?? {}), userId],
  );
}

/**
 * Egy elkészült (`completed`) fogkezelés következményét átvezeti a beteg
 * odontogramján: rögzíti a kiindulási állapotot (ha még nincs), frissíti az élő
 * státuszt a kezelés eredménye szerint, és datált pillanatfelvételt készít.
 *
 * Tranzakción belül kell hívni (a hívó nyitja a BEGIN/COMMIT-et). Ha a kezeléshez
 * nem tartozik automatikus státuszváltás (pl. csiszolás), nem csinál semmit.
 */
export async function applyCompletedTreatmentToDentalStatus(
  client: Queryable,
  args: {
    patientId: string;
    toothNumber: number;
    treatmentCode: string;
    treatmentId: string;
    completedAt: Date | string;
    treatmentLabel?: string | null;
    userId: string | null;
  },
): Promise<{ updated: boolean }> {
  const current = await getCurrentFogak(client, args.patientId);
  const key = String(args.toothNumber);
  const { changed, next } = applyTreatmentOutcome(current[key], args.treatmentCode);
  if (!changed) return { updated: false };

  // 1) Kiindulási állapot rögzítése a változás ELŐTTI odontogramból.
  await ensureBaselineSnapshot(client, args.patientId, current, args.userId);

  // 2) Élő odontogram frissítése.
  const updatedFogak: Fogak = { ...current };
  if (next === undefined) delete updatedFogak[key];
  else updatedFogak[key] = next;

  await client.query(
    `UPDATE patient_dental_status SET meglevo_fogak = $2::jsonb WHERE patient_id = $1`,
    [args.patientId, JSON.stringify(updatedFogak)],
  );

  // 3) Datált státusz-pillanatfelvétel.
  const effective = new Date(args.completedAt);
  const effectiveDate = Number.isNaN(effective.getTime())
    ? new Date().toISOString().slice(0, 10)
    : effective.toISOString().slice(0, 10);
  const label = (args.treatmentLabel ?? args.treatmentCode).trim();
  await client.query(
    `INSERT INTO dental_status_snapshots
       (patient_id, kind, effective_date, fogak, note, source_tooth_treatment_id, created_by)
     VALUES ($1, 'status', $2, $3::jsonb, $4, $5, $6)`,
    [
      args.patientId,
      effectiveDate,
      JSON.stringify(updatedFogak),
      `${args.toothNumber}. fog — ${label} elkészült`,
      args.treatmentId,
      args.userId,
    ],
  );

  return { updated: true };
}

function mapSnapshotRow(r: any): DentalStatusSnapshot {
  return {
    id: r.id,
    kind: r.kind,
    effectiveDate:
      r.effective_date instanceof Date
        ? r.effective_date.toISOString().slice(0, 10)
        : String(r.effective_date).slice(0, 10),
    fogak: r.fogak && typeof r.fogak === 'object' ? r.fogak : {},
    note: r.note ?? null,
    sourceToothTreatmentId: r.source_tooth_treatment_id ?? null,
  };
}

/** Az idővonal összeállítása a viewer/API számára. */
export async function getDentalStatusTimeline(patientId: string): Promise<DentalStatusTimeline> {
  const pool = getDbPool();
  const [snapRes, current, openTxRes] = await Promise.all([
    pool.query(
      `SELECT id, kind, effective_date, fogak, note, source_tooth_treatment_id
         FROM dental_status_snapshots
        WHERE patient_id = $1
        ORDER BY effective_date ASC, created_at ASC`,
      [patientId],
    ),
    getCurrentFogak(pool, patientId),
    pool.query(
      `SELECT tooth_number AS "toothNumber", treatment_code AS "treatmentCode"
         FROM tooth_treatments
        WHERE patient_id = $1 AND status <> 'completed'`,
      [patientId],
    ),
  ]);

  const all = snapRes.rows.map(mapSnapshotRow);
  const baseline = all.find((s) => s.kind === 'baseline') ?? null;
  const snapshots = all.filter((s) => s.kind === 'status');
  const plan = projectFogakWithTreatments(current, openTxRes.rows);

  return { baseline, snapshots, plan, current };
}
