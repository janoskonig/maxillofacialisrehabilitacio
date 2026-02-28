-- Up: Audit view for unused indexes (run SELECT * FROM v_unused_indexes to review)
-- Unused indexes slow down INSERT/UPDATE operations without providing query benefits.

CREATE OR REPLACE VIEW v_unused_indexes AS
SELECT
  schemaname,
  indexrelname AS index_name,
  relname AS table_name,
  idx_scan AS times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  pg_relation_size(indexrelid) AS index_size_bytes
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Down: DROP VIEW IF EXISTS v_unused_indexes;
