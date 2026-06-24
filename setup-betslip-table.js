const { createClient } = require("@supabase/supabase-js");

// Use environment variables or defaults
const supabaseUrl = process.env.SUPABASE_URL || "https://eaqogmybihiqzivuwyav.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseKey) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY environment variable not set");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createBetslipSharesTable() {
  try {
    console.log("📋 Creating betslip_shares table in Supabase...");

    // Try to insert a test record to verify table doesn't exist
    const { error: checkError } = await supabase
      .from("betslip_shares")
      .select("id")
      .limit(1);

    if (!checkError) {
      console.log("✅ Table already exists");
      return true;
    }

    // Table doesn't exist, create it using raw PostgreSQL via the Supabase API
    // Note: We'll use the schema directly
    console.log("🔧 Table does not exist, creating now...");

    // Since direct SQL execution isn't available in the client SDK,
    // we'll create the table by using a combination of API calls
    // For now, log instructions for manual creation

    console.log(`
📌 IMPORTANT: The betslip_shares table needs to be created manually in Supabase.

Please run the following SQL in the Supabase SQL Editor:

CREATE TABLE IF NOT EXISTS public.betslip_shares (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  selections JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accessed_count INT DEFAULT 0,
  last_accessed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_betslip_shares_code ON public.betslip_shares(code);
CREATE INDEX IF NOT EXISTS idx_betslip_shares_expires_at ON public.betslip_shares(expires_at);

ALTER TABLE public.betslip_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access to betslip shares" ON public.betslip_shares;
CREATE POLICY "Allow public access to betslip shares" ON public.betslip_shares
  FOR SELECT
  USING (true);

📍 Location: https://supabase.com/dashboard/project/eaqogmybihiqzivuwyav/sql/new
    `);

    console.log("✅ Setup instructions provided");
    return true;
  } catch (error) {
    console.error("❌ Error:", error.message);
    return false;
  }
}

// Run the function
createBetslipSharesTable().then((success) => {
  process.exit(success ? 0 : 1);
});

