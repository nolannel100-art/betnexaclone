-- Create betslip_shares table for storing shared betslip links
CREATE TABLE IF NOT EXISTS betslip_shares (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  selections JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accessed_count INT DEFAULT 0,
  last_accessed_at TIMESTAMPTZ
);

-- Create index on code for faster lookups
CREATE INDEX idx_betslip_shares_code ON betslip_shares(code);

-- Create index on expires_at to help with cleanup of expired records
CREATE INDEX idx_betslip_shares_expires_at ON betslip_shares(expires_at);

-- Optional: Add a policy for Row Level Security (if using Supabase RLS)
-- This allows anyone to read betslip shares (they're meant to be public links)
ALTER TABLE betslip_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access to betslip shares" ON betslip_shares
  FOR SELECT
  USING (true);

-- Optional: Create a function to clean up expired betslip shares
CREATE OR REPLACE FUNCTION cleanup_expired_betslip_shares()
RETURNS void AS $$
BEGIN
  DELETE FROM betslip_shares
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- You can schedule this function to run periodically using a cron job in Supabase
-- SELECT cron.schedule('cleanup_expired_betslip_shares', '0 2 * * *', 'SELECT cleanup_expired_betslip_shares()');
