-- Better Auth 1.7 expects OAuth token columns on accounts.
ALTER TABLE accounts ADD COLUMN idToken TEXT;
ALTER TABLE accounts ADD COLUMN refreshTokenExpiresAt INTEGER;
