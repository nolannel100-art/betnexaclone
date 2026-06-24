# Betslip Short Code Sharing Implementation

## Overview
This implementation changes the betslip sharing format from `https://betnexa.co.ke/?picks=base64_encoded` to `https://betnexa.co.ke/nnnnn` where `nnnnn` is a 6-character random alphanumeric code (mix of uppercase, lowercase, and numbers).

## Changes Made

### Backend Changes
1. **New Endpoint: POST `/api/bets/share-betslip`**
   - Accepts: `{ selections: BetSlipItem[] }`
   - Generates: Random 6-character alphanumeric code
   - Stores: Betslip data in `betslip_shares` table
   - Returns: `{ success: true, code: "abc123", link: "https://betnexa.co.ke/abc123" }`
   - Location: `server/routes/bets.routes.js` and `server/server/routes/bets.routes.js`

2. **New Endpoint: GET `/api/bets/betslip/:code`**
   - Retrieves: Betslip selections by code
   - Returns: `{ success: true, code: "abc123", selections: [...] }`
   - Features:
     - Validates code format (5-7 alphanumeric characters)
     - Checks expiration (7 days from creation)
     - Returns 410 Gone status if expired
     - Returns 404 Not Found if code doesn't exist

### Frontend Changes
1. **Updated: `src/lib/shareableLinks.ts`**
   - `generateShareableLink()`: Now async, calls POST endpoint instead of Base64 encoding
   - `getPicksFromUrl()`: Now async, detects code from URL path and fetches from backend
   - Maintains backwards compatibility with old `?picks=` query parameter format

2. **Updated: `src/components/BettingSlip.tsx`**
   - Share button now handles async `generateShareableLink()` call
   - Shows loading state during link generation
   - Displays the generated link in toast notification

3. **Updated: `src/pages/Index.tsx`**
   - Updated useEffect to handle async `getPicksFromUrl()`

4. **Updated: `src/App.tsx`**
   - Added catch-all route `/:code` to handle betslip short codes
   - Route params are extracted and processed by `getPicksFromUrl()`

### Database Changes
1. **New Table: `betslip_shares`**
   - Columns:
     - `id`: Primary key (auto-increment)
     - `code`: Unique 10-char code
     - `selections`: JSONB array of betslip items
     - `created_at`: Creation timestamp
     - `expires_at`: Expiration timestamp (7 days)
     - `accessed_count`: Number of times accessed
     - `last_accessed_at`: Last access timestamp
   - Indexes:
     - `idx_betslip_shares_code`: Fast code lookups
     - `idx_betslip_shares_expires_at`: Fast expiration cleanup
   - RLS Policy: Public read access (anyone can view shared betslips)

## Setup Instructions

### 1. Create Database Table

Run the following SQL in your Supabase SQL Editor:
```sql
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
```

Location: https://supabase.com/dashboard/project/eaqogmybihiqzivuwyav/sql/new

### 2. Deploy Backend
Deploy the backend changes to `betnexaclone` Vercel project:
```bash
git push origin master
```

Verify deployment: Check that the endpoints are accessible at:
- `https://betnexaclone-clone-masters.vercel.app/api/bets/share-betslip`
- `https://betnexaclone-clone-masters.vercel.app/api/bets/betslip/{code}`

### 3. Deploy Frontend
After backend is deployed, deploy frontend to `betnexaclonefinal` project:
```bash
# Frontend will automatically pull updated code from GitHub
```

Verify: Visit `https://www.betnexa.co.ke` and test admin betslip sharing

## Testing

### Test Flow
1. **Admin shares betslip:**
   - Select bets in betting slip
   - Click "Share" button
   - Toast shows generated link (e.g., `https://betnexa.co.ke/aB3xYz`)
   - Link is copied to clipboard

2. **User opens shared link:**
   - Visit `https://betnexa.co.ke/aB3xYz`
   - Betting slip auto-populates with shared selections
   - Can place bet or share again

3. **Expired link:**
   - Links expire after 7 days
   - Visiting expired link shows empty betslip
   - Console shows "Betslip not found" error

## Environment Variables

Ensure the following are set in frontend `.env`:

```env
VITE_API_URL=https://betnexaclone-clone-masters.vercel.app
```

This is used by `generateShareableLink()` and `getPicksFromUrl()` to call the backend API.

## Backwards Compatibility

The old `?picks=base64` format is still supported:
- `getPicksFromUrl()` checks for `?picks` query parameter
- If found, decodes using old Base64 method
- Falls back to code detection if not present

## Important Notes

⚠️ **CRITICAL DEPLOYMENT ORDER:**
1. Create database table first
2. Deploy backend second
3. Deploy frontend third

Deploying frontend before backend will cause 404 errors when sharing betslips.

## Code Locations

- Backend endpoints: 
  - `server/routes/bets.routes.js` (lines with POST and GET betslip routes)
  - `server/server/routes/bets.routes.js` (backup copy)
- Frontend utilities: `src/lib/shareableLinks.ts`
- Frontend component: `src/components/BettingSlip.tsx` (share button)
- Frontend pages: `src/pages/Index.tsx` (picks loading)
- Frontend routing: `src/App.tsx` (/:code route)
- Database migration: `migrations/create_betslip_shares_table.sql`
- Setup script: `setup-betslip-table.js` (informational)

## Git Commits

Commit hash: `731f68f`
- Implements full short code betslip sharing feature
- All backend and frontend changes included
- Database migration provided
