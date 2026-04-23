-- Add role column to users table.
-- Built-in roles: user (default), admin.
-- Additional roles can be added by the developer as needed.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
