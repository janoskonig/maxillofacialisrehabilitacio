// READ-ONLY descriptive statistics for the congress deck
const fs = require("fs"), path = require("path");
const url = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g, "");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });

const out = {};
async function q(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    out[label] = r.rows;
    return r.rows;
  } catch (e) {
    out[label] = { error: e.message };
    return null;
  }
}

(async () => {
  // 1. patients
  await q("patients_total", `SELECT count(*)::int n, count(*) FILTER (WHERE halal_datum IS NULL)::int alive, count(*) FILTER (WHERE halal_datum IS NOT NULL)::int deceased FROM patients`);
  await q("patients_gender", `SELECT COALESCE(nem,'(nincs)') nem, count(*)::int n FROM patients GROUP BY 1 ORDER BY 2 DESC`);
  await q("patients_age", `SELECT round(avg(extract(year from age(szuletesi_datum))))::int mean_age, round(min(extract(year from age(szuletesi_datum))))::int min_age, round(max(extract(year from age(szuletesi_datum))))::int max_age, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(year from age(szuletesi_datum)))::int median_age FROM patients WHERE szuletesi_datum IS NOT NULL`);
  await q("patients_intake", `SELECT COALESCE(intake_status,'(nincs)') s, count(*)::int n FROM patients GROUP BY 1 ORDER BY 2 DESC`);
  await q("consent_status", `SELECT COALESCE(consent_status,'(nincs)') s, count(*)::int n FROM patients GROUP BY 1 ORDER BY 2 DESC`);

  // 2. episodes
  await q("episodes_total", `SELECT count(*)::int n, count(DISTINCT patient_id)::int patients FROM patient_episodes`);
  await q("episodes_status", `SELECT COALESCE(status,'(nincs)') s, count(*)::int n FROM patient_episodes GROUP BY 1 ORDER BY 2 DESC`);
  await q("episodes_reason", `SELECT COALESCE(reason,'(nincs)') r, count(*)::int n FROM patient_episodes GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);

  // 3. anamnesis / clinical classification
  await q("anam_reason", `SELECT COALESCE(kezelesre_erkezes_indoka::text,'(nincs)') r, count(*)::int n FROM patient_anamnesis GROUP BY 1 ORDER BY 2 DESC`);
  await q("maxilla_defect", `SELECT count(*) FILTER (WHERE maxilladefektus_van IS TRUE)::int with_defect, count(*) FILTER (WHERE brown_fuggoleges_osztaly IS NOT NULL)::int brown_v, count(*) FILTER (WHERE brown_vizszintes_komponens IS NOT NULL)::int brown_h FROM patient_anamnesis`);
  await q("brown_v_dist", `SELECT brown_fuggoleges_osztaly::text v, count(*)::int n FROM patient_anamnesis WHERE brown_fuggoleges_osztaly IS NOT NULL GROUP BY 1 ORDER BY 1`);
  await q("mandible_defect", `SELECT count(*) FILTER (WHERE mandibuladefektus_van IS TRUE)::int with_defect, count(*) FILTER (WHERE kovacs_dobak_osztaly IS NOT NULL)::int kd FROM patient_anamnesis`);
  await q("kd_dist", `SELECT kovacs_dobak_osztaly::text v, count(*)::int n FROM patient_anamnesis WHERE kovacs_dobak_osztaly IS NOT NULL GROUP BY 1 ORDER BY 1`);
  await q("radiotherapy", `SELECT count(*) FILTER (WHERE radioterapia IS TRUE)::int rt_yes, count(*) FILTER (WHERE chemoterapia IS TRUE)::int chemo_yes, round(avg(radioterapia_dozis_gy)::numeric,1) mean_gy, count(*) FILTER (WHERE tnm_staging IS NOT NULL AND tnm_staging<>'')::int tnm_present FROM patient_anamnesis`);
  await q("fabian_felso", `SELECT COALESCE(fabian_fejerdy_protetikai_osztaly_felso::text,'(nincs)') c, count(*)::int n FROM patient_anamnesis GROUP BY 1 ORDER BY 2 DESC`);

  // 4. OHIP-14
  await q("ohip_total", `SELECT count(*)::int responses, count(DISTINCT patient_id)::int patients FROM ohip14_responses`);
  await q("ohip_by_tp", `SELECT timepoint, count(*)::int n, round(avg(total_score)::numeric,1) mean_total, round(stddev_samp(total_score)::numeric,1) sd_total FROM ohip14_responses WHERE total_score IS NOT NULL GROUP BY 1 ORDER BY 1`);
  await q("ohip_multi_tp", `SELECT count(*)::int patients_with_2plus FROM (SELECT patient_id FROM ohip14_responses GROUP BY patient_id HAVING count(DISTINCT timepoint)>=2) z`);
  await q("ohip_paired_t0_t2", `
    WITH t0 AS (SELECT patient_id, min(total_score) s FROM ohip14_responses WHERE timepoint='T0' AND total_score IS NOT NULL GROUP BY patient_id),
         t2 AS (SELECT patient_id, min(total_score) s FROM ohip14_responses WHERE timepoint='T2' AND total_score IS NOT NULL GROUP BY patient_id)
    SELECT count(*)::int n_pairs, round(avg(t0.s)::numeric,1) mean_t0, round(avg(t2.s)::numeric,1) mean_t2, round(avg(t0.s - t2.s)::numeric,1) mean_improvement
    FROM t0 JOIN t2 USING (patient_id)`);

  // 5. appointments
  await q("appt_total", `SELECT count(*)::int n, count(DISTINCT patient_id)::int patients FROM appointments`);
  await q("appt_status", `SELECT COALESCE(appointment_status,'(függő)') s, count(*)::int n FROM appointments GROUP BY 1 ORDER BY 2 DESC`);
  await q("appt_pool", `SELECT COALESCE(pool,'(nincs)') p, count(*)::int n FROM appointments GROUP BY 1 ORDER BY 2 DESC`);
  await q("noshow_rate", `SELECT count(*) FILTER (WHERE appointment_status='no_show')::int no_show, count(*) FILTER (WHERE appointment_status IN ('completed','no_show','unsuccessful'))::int realized, round(avg(no_show_risk)::numeric,3) mean_risk FROM appointments`);

  // 6. consilium
  await q("consilium_sessions", `SELECT COALESCE(status,'(nincs)') s, count(*)::int n FROM consilium_sessions GROUP BY 1 ORDER BY 2 DESC`);
  await q("consilium_items", `SELECT count(*)::int items, count(DISTINCT patient_id)::int patients, count(DISTINCT session_id)::int sessions FROM consilium_session_items`);

  // 7. completeness
  await q("completeness_latest", `SELECT snapshot_date, total, avg_score, clinical_complete, research_ready, with_warnings FROM data_completeness_snapshot ORDER BY snapshot_date DESC LIMIT 1`);
  await q("eqs_completeness", `SELECT round(avg(completeness_score)::numeric,1) mean_score, count(*) FILTER (WHERE completeness_score>=90)::int ge90, count(*)::int n FROM entity_quality_state WHERE entity_type='patient' AND completeness_score IS NOT NULL`);

  // 8. documents
  await q("documents", `SELECT count(*)::int n, count(DISTINCT patient_id)::int patients FROM patient_documents`);

  // 9. care pathways / treatment plans
  await q("care_pathways", `SELECT count(*)::int n FROM care_pathways`);
  await q("treatment_plans", `SELECT count(*)::int patients_with_plan FROM patient_treatment_plans WHERE kezelesi_terv_felso IS NOT NULL OR kezelesi_terv_also IS NOT NULL OR kezelesi_terv_arcot_erinto IS NOT NULL`);

  // data span
  await q("data_span", `SELECT min(felvetel_datuma) first_intake, max(felvetel_datuma) last_intake FROM patients WHERE felvetel_datuma IS NOT NULL`);

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
