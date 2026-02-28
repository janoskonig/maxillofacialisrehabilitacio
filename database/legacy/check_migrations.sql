-- Script to check if migrations have been applied
-- Run with: psql -d <db> -f database/check_migrations.sql

-- Check if mentioned_patient_ids column exists
SELECT 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'doctor_messages' 
  AND column_name = 'mentioned_patient_ids';

-- Check if index exists for mentioned_patient_ids
SELECT 
    indexname, 
    indexdef
FROM pg_indexes 
WHERE tablename = 'doctor_messages' 
  AND indexname LIKE '%mentioned%';

-- Check if group_id column exists
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'doctor_messages' 
  AND column_name = 'group_id';

-- Check if doctor_message_groups table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'doctor_message_groups'
) as groups_table_exists;

-- Check if doctor_message_group_participants table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'doctor_message_group_participants'
) as participants_table_exists;

