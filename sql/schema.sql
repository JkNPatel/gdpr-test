-- GDPR Deletion Audit Schema
-- This table tracks all GDPR deletion requests for compliance

CREATE TABLE IF NOT EXISTS gdpr_deletion_audit (
    id SERIAL PRIMARY KEY,
    public_id VARCHAR(255) NOT NULL,
    request_id UUID NOT NULL,
    deleted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_by VARCHAR(255) NOT NULL,
    rows_affected INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Ensure we can't delete the same user twice with same request
    UNIQUE(public_id, request_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_gdpr_audit_public_id ON gdpr_deletion_audit(public_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_audit_request_id ON gdpr_deletion_audit(request_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_audit_deleted_at ON gdpr_deletion_audit(deleted_at);

-- Example Product B schema (for reference)
-- You would need to adjust this based on your actual schema

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    public_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255),
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(100),
    event_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    preference_key VARCHAR(100),
    preference_value TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Grant limited permissions to GDPR deletion user
-- CREATE USER gdpr_deletion_user WITH PASSWORD 'secure_password';
-- GRANT SELECT, DELETE ON users, user_events, user_preferences, user_sessions TO gdpr_deletion_user;
-- GRANT INSERT ON gdpr_deletion_audit TO gdpr_deletion_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gdpr_deletion_user;
