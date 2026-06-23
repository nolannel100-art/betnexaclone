# API Football Free Tier Optimization Guide

## Current Limitations

**Problem:** Currently only fetching ~20 matches per day (3 days = ~60 total)
- Fetch range: Only 3 consecutive days
- Per-fixture odds limited to 30 calls per date
- Only fetching basic 1X2 odds initially
- No smart league/country filtering for free tier

## Free Tier API Constraints

- **Request Limit:** 10 requests/minute for free tier (3000/month)
- **Fixtures Endpoint:** Returns paginated results (default 20 per page, max 100 with pagination)
- **Odds Endpoint:** Also paginated
- **Rate:** Count hits per request, not per fixture

## Optimization Strategies

### 1. **Expand Date Range (✅ No API cost impact)**
   - Current: 3 days
   - Target: 15-20 days ahead
   - Benefit: 4-6x more fixtures available

### 2. **Smart League Filtering (✅ Reduces unnecessary requests)**
   - Filter to top 50-100 leagues globally
   - Eliminates youth/amateur competitions automatically
   - Benefits: Better matches available to users

### 3. **Optimized Odds Fetching Strategy**
   - **Step 1:** Fetch bulk odds by date (1 API call)
   - **Step 2:** Match odds to fixtures
   - **Step 3:** Only fallback to per-fixture for ~10% missing
   - Benefit: ~70% reduction in API calls

### 4. **Pagination Optimization**
   - Use `page=1&per_page=100` to get 100 fixtures per call vs 20
   - Reduces calls needed by 80%
   - Impact: Fetch 100 matches in same request that gets 20

### 5. **Market Filtering Relaxation (⚠️ Optional)**
   - Current: Requires ALL markets (1X2 + BTTS + O/U + DC + HT/FT + CS)
   - Option A: Require only 1X2 + BTTS (most popular, highest availability)
   - Option B: Accept matches with 60%+ market coverage
   - Impact: Can increase matches from 20 to 50+ per day

### 6. **Caching Strategy**
   - Cache fixture data for 24 hours
   - Cache odds for 1 hour (they change frequently)
   - Reduces repeated API calls

### 7. **Request Bundling**
   - Fetch leagues list once per week
   - Batch process by date range
   - Track API quota usage

## Implementation Priority

1. **HIGH** - Expand date range to 15+ days
2. **HIGH** - Increase per_page to 100 for fixtures
3. **HIGH** - Implement bulk odds fetching with proper pagination
4. **MEDIUM** - Add smart league filtering
5. **MEDIUM** - Relax market requirements to 1X2 + BTTS minimum
6. **LOW** - Add caching layer

## Expected Results

| Strategy | Current | With Optimization | Improvement |
|----------|---------|-------------------|-------------|
| Date Range | 3 days | 15 days | 5x more days |
| Per-page Limit | 20 | 100 | 5x per request |
| Daily Matches | ~20 | ~100-150 | 5-7x more |
| Total Available | ~60 | ~1500-2250 | 25-37x more |
| API Requests/fetch | ~35 | ~12 | 71% reduction |

## Free Tier Request Budget

- **Monthly Limit:** 3000 requests
- **Recommended:** Use 1000-1500/month for fetches (30-50 days of daily fetches)
- **Remaining:** 1500-2000 for live updates and queries
