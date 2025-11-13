-- Feedback table for bug reports and error logs
-- Run with: psql -d <db> -f database/migration_feedback.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT,
    type VARCHAR(50) NOT NULL CHECK (type IN ('bug', 'error', 'crash', 'suggestion', 'other')),
    title VARCHAR(255),
    description TEXT NOT NULL,
    error_log TEXT, -- Full error log for crashes/errors
    error_stack TEXT, -- Stack trace if available
    user_agent TEXT, -- Browser/user agent info
    url TEXT, -- Page URL where error occurred
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_email ON feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(type);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_feedback_updated_at
    BEFORE UPDATE ON feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_feedback_updated_at();

-- Comments
COMMENT ON TABLE feedback IS 'Felhasználói visszajelzések, bug jelentések és error logok';
COMMENT ON COLUMN feedback.type IS 'Visszajelzés típusa: bug, error, crash, suggestion, other';
COMMENT ON COLUMN feedback.error_log IS 'Teljes error log crash/error esetén';
COMMENT ON COLUMN feedback.error_stack IS 'Stack trace ha elérhető';




