--
-- PostgreSQL database dump
--

\restrict DdQBYSmZkhoHpM9FJvUmDbUdOXKisWC3oSlAxaWEWj6QwTcdrt7YqQqgY318VNg

-- Dumped from database version 16.14 (Homebrew)
-- Dumped by pg_dump version 16.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: node_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.node_migrations (name, run_at) FROM stdin;
001_baseline.sql	2026-07-03 22:54:54.532347+02
002_dmft_materialized_view.sql	2026-07-03 22:54:54.552477+02
003_unused_index_audit.sql	2026-07-03 22:54:54.554814+02
004_performance_indexes.sql	2026-07-03 22:58:06.039647+02
005_normalize_patients.sql	2026-07-03 23:00:51.712048+02
006_episode_pathway_jaw.sql	2026-07-03 23:00:51.714944+02
007_tooth_treatment_implantacio.sql	2026-07-03 23:00:51.717233+02
008_episode_steps_tooth_treatment_merge.sql	2026-07-03 23:00:51.724843+02
009_sebeszorvos_to_beutalo_orvos.sql	2026-07-03 23:00:51.726918+02
010_episode_forecast_cache_next_step_length.sql	2026-07-03 23:00:51.728005+02
011_consilium_sessions.sql	2026-07-03 23:00:51.734373+02
012_consilium_discussed_attendees.sql	2026-07-03 23:00:51.736187+02
013_drop_consilium_presenter_notes.sql	2026-07-03 23:00:51.737292+02
014_user_tasks.sql	2026-07-03 23:00:51.74201+02
015_consilium_prep_share.sql	2026-07-03 23:00:51.747295+02
015_patient_document_annotations.sql	2026-07-03 23:00:51.75263+02
016_work_phase_canonical.sql	2026-07-03 23:00:51.771525+02
017_episode_work_phases_id_default.sql	2026-07-03 23:00:51.773629+02
018_episode_work_phase_audit.sql	2026-07-03 23:00:51.778431+02
019_consilium_prep_token_raw.sql	2026-07-03 23:00:51.779681+02
020_user_tasks_viewed_at.sql	2026-07-03 23:00:51.781906+02
021_episode_plan_migration_phase1.sql	2026-07-03 23:00:51.795633+02
022_patient_treatment_plan_json_quarantine.sql	2026-07-03 23:00:51.799194+02
023_appointment_plan_link_audit.sql	2026-07-03 23:00:51.803697+02
024_appointment_chain_reservation.sql	2026-07-03 23:00:51.806133+02
025_appointment_work_phase_link.sql	2026-07-03 23:00:51.811648+02
026_assert_appointment_status_check.sql	2026-07-03 23:00:51.814302+02
027_kezeleoorvos_user_id.sql	2026-07-03 23:00:51.816995+02
028_one_hard_next_optional.sql	2026-07-03 23:00:51.818383+02
029_appointment_attempts.sql	2026-07-03 23:00:51.823736+02
030_user_tasks_staff_registration_review.sql	2026-07-03 23:00:51.824616+02
031_consilium_session_invitations.sql	2026-07-03 23:00:51.828769+02
032_outbound_email_log.sql	2026-07-03 23:00:51.832102+02
033_tmk_compliance_foundation.sql	2026-07-03 23:00:51.842031+02
034_tmk_crf_quality_engine.sql	2026-07-03 23:00:51.851388+02
035_tmk_export_lineage.sql	2026-07-03 23:00:51.860426+02
036_tmk_governance_protocol.sql	2026-07-03 23:00:51.876351+02
037_research_consent_flow.sql	2026-07-03 23:00:51.881115+02
038_remove_tmk_branding.sql	2026-07-03 23:00:51.88254+02
039_episode_plan_start_date.sql	2026-07-03 23:00:51.88337+02
040_consilium_session_tracking.sql	2026-07-03 23:00:51.889013+02
041_message_replies.sql	2026-07-03 23:00:51.891164+02
042_message_delivery.sql	2026-07-03 23:00:51.896033+02
046_message_context_links.sql	2026-07-03 23:00:51.90093+02
047_message_fts.sql	2026-07-03 23:00:51.910302+02
048_missing_data_reminders.sql	2026-07-03 23:00:51.914185+02
049_consent_reminders.sql	2026-07-03 23:00:51.917141+02
049_patient_field_na.sql	2026-07-03 23:00:51.920632+02
050_legal_hardening.sql	2026-07-03 23:00:51.924617+02
050_referrer_user_id.sql	2026-07-03 23:00:51.926606+02
051_anamnesis_derived_numerics.sql	2026-07-03 23:00:51.927855+02
051_kezeleoorvos_sticky_assignment.sql	2026-07-03 23:00:51.930117+02
052_completeness_snapshot.sql	2026-07-03 23:00:51.931354+02
053_episode_plan_approval.sql	2026-07-03 23:00:51.933909+02
054_message_conversation_indexes.sql	2026-07-03 23:00:51.935878+02
055_perio_charts.sql	2026-07-03 23:00:51.938909+02
056_dental_status_snapshots.sql	2026-07-03 23:00:51.941881+02
056_feedback_admin_response.sql	2026-07-03 23:00:51.943291+02
057_feedback_ai_draft.sql	2026-07-03 23:00:51.945899+02
058_widen_step_code_to_80.sql	2026-07-03 23:00:51.948814+02
059_no_show_releases_work_phase.sql	2026-07-03 23:00:51.951916+02
060_appointment_type_extend_and_label.sql	2026-07-03 23:00:51.953714+02
061_completeness_gate_overrides.sql	2026-07-03 23:00:51.956793+02
062_updated_at_skip_flag.sql	2026-07-03 23:00:51.9577+02
063_backfill_missing_patient_subtable_rows.sql	2026-07-03 23:00:51.959261+02
064_doctor_messages_unresolved_mentions.sql	2026-07-03 23:00:51.960365+02
065_patient_duplicate_check_indexes.sql	2026-07-03 23:00:51.962543+02
066_portal_display_scale.sql	2026-07-03 23:00:51.963771+02
067_referral_institutions.sql	2026-07-03 23:00:51.967184+02
068_field_na_reason_codes.sql	2026-07-03 23:00:51.970087+02
069_snapshot_publication_ready.sql	2026-07-03 23:00:51.97097+02
070_patient_selffill_reminder_log.sql	2026-07-03 23:00:51.973138+02
071_patient_data_access_log.sql	2026-07-04 07:30:44.370231+02
072_privacy_notice_v12_editorial_backfill.sql	2026-07-04 07:30:44.433028+02
073_research_consent_v2_pseudonym_wording.sql	2026-07-04 07:30:44.499261+02
074_ohip14_t4_t5_timepoints.sql	2026-08-10 12:17:25.048713+02
075_remove_control_steps_from_pathway_templates.sql	2026-08-13 12:58:54.499403+02
076_patients_full_torvenyes_kepviselo.sql	2026-08-13 13:13:23.770177+02
077_patient_episode_auto_created.sql	2026-08-13 13:14:22.728923+02
078_work_phase_delete_unblock.sql	2026-08-20 07:18:07.359413+02
079_protetikai_szerepek.sql	2026-08-20 17:05:12.081361+02
080_deceased_patient_episode_guard.sql	2026-08-20 17:05:12.108474+02
081_recall_workflow.sql	2026-08-21 12:03:06.477416+02
082_feedback_triage.sql	2026-08-21 15:16:26.594798+02
083_feedback_triage_worker.sql	2026-08-21 16:36:42.196462+02
\.


--
-- PostgreSQL database dump complete
--

\unrestrict DdQBYSmZkhoHpM9FJvUmDbUdOXKisWC3oSlAxaWEWj6QwTcdrt7YqQqgY318VNg

