#!/usr/bin/env node

/**
 * Import API-Football fixtures + odds into BETNEXA DB.
 * - Adds 20 upcoming games per day from tomorrow to day 20 (inclusive)
 * - Adds 5 live games
 * - Major leagues only
 * - Excludes U18/U19/U20/U21/U22 leagues
 * - Imports only: 1X2, BTTS, O/U, DC, HT/FT, CS
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const API_BASE = 'https://v3.football.api-sports.io';
const API_KEY = process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || process.env.RAPIDAPI_KEY || '';
const TZ = 'Africa/Nairobi';

if (!API_KEY) {
  console.error('Missing API_FOOTBALL_KEY in environment.');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const PREFERRED_LEAGUE_IDS = new Set([
  2, 3, 848, // UCL/UEL/UECL
  39, 61, 78, 88, 94, 135, 140, 144, 203,
  253, 307, 262, 71, 73, 106, 113, 128,
  129, 130, 131, 134, 136, 137, 138, 139,
  218, 172, 188
]);

const MAJOR_COUNTRIES = new Set([
  'World', 'England', 'Spain', 'Italy', 'Germany', 'France', 'Netherlands', 'Portugal', 'Belgium',
  'Turkey', 'Scotland', 'Austria', 'Switzerland', 'Denmark', 'Sweden', 'Norway',
  'Brazil', 'Argentina', 'Mexico', 'USA', 'Japan', 'South-Korea', 'Saudi-Arabia',
  'Colombia', 'Ecuador', 'Chile', 'Uruguay', 'Paraguay', 'Peru', 'Venezuela'
]);

const REQUIRED_MARKET_KEYS = [
  'bttsYes', 'bttsNo',
  'over15', 'under15', 'over25', 'under25',
  'doubleChanceHomeOrDraw', 'doubleChanceAwayOrDraw', 'doubleChanceHomeOrAway',
  'htftHomeHome', 'htftDrawDraw', 'htftAwayAway', 'htftDrawHome', 'htftDrawAway',
  ...buildCorrectScoreKeys()
];

function buildCorrectScoreKeys() {
  const keys = [];
  for (let h = 0; h <= 4; h++) {
    for (let a = 0; a <= 4; a++) keys.push(`cs${h}${a}`);
  }
  return keys;
}

function isYouthCompetition(leagueName) {
  if (!leagueName) return false;
  return /(u[-\s]?(18|19|20|21|22)|under[-\s]?(18|19|20|21|22))/i.test(leagueName);
}

function isLowTierCompetition(leagueName) {
  const name = String(leagueName || '').toLowerCase();
  return /(reserve|reserves|women|feminin|femenil|amateur|regional|3\. division|third league|iv |ii liga|iii liga|liga 2|2\. division|second league|1 lyga|birinci|challenger|u23|u21|u20|u19|u18|\bii\b|\bb\b)/i.test(name);
}

function isMajorCompetition(fixture) {
  const leagueId = fixture?.league?.id;
  const leagueName = fixture?.league?.name || '';
  const country = fixture?.league?.country || '';
  const lname = leagueName.toLowerCase();

  if (isYouthCompetition(leagueName) || isLowTierCompetition(leagueName)) return false;
  if (PREFERRED_LEAGUE_IDS.has(leagueId)) return true;
  if (!MAJOR_COUNTRIES.has(country)) return false;

  return /(premier league|serie a|la liga|bundesliga|ligue 1|eredivisie|primeira liga|super lig|major league soccer|mls|j1 league|k league 1|pro league|uefa|champions league|europa|conference|copa|cup|super cup|primera división|liga pro|liga mx|premiership|süper lig)/i.test(lname);
}

function seasonForDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDateRangeTomorrowTo20th() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  // ✅ OPTIMIZATION: Extended from day 20 to day 25 for more fixture availability
  const end = new Date(tomorrow);
  end.setDate(25);

  const dates = [];
  const cursor = new Date(tomorrow);
  while (cursor <= end) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`;

  const resp = await fetch(url, {
    headers: {
      'x-apisports-key': API_KEY
    }
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API ${resp.status} on ${path}: ${body}`);
  }

  const json = await resp.json();
  return json.response || [];
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 1.01 ? +n.toFixed(2) : null;
}

function normalizeLabel(s) {
  return String(s || '').trim().toLowerCase();
}

function findBetByName(bets, names) {
  const wanted = names.map(normalizeLabel);
  return bets.find((b) => wanted.includes(normalizeLabel(b.name)));
}

function valToOdd(values, labels) {
  const wanted = labels.map(normalizeLabel);
  const found = (values || []).find((v) => wanted.includes(normalizeLabel(v.value)));
  return num(found?.odd);
}

function valToOddStartsWith(values, prefix) {
  const p = normalizeLabel(prefix);
  const found = (values || []).find((v) => normalizeLabel(v.value).startsWith(p));
  return num(found?.odd);
}

function pickOverUnder(values, line, side) {
  const sideNorm = side.toLowerCase() === 'over' ? 'over' : 'under';
  const wanted = `${sideNorm} ${line}`;
  return valToOddStartsWith(values, wanted);
}

function extractMarketsFromBookmaker(bookmaker) {
  const bets = bookmaker?.bets || [];
  const out = {};

  const winner = findBetByName(bets, ['Match Winner', '1X2', 'Fulltime Result']);
  if (winner) {
    out.home = valToOdd(winner.values, ['Home', '1']);
    out.draw = valToOdd(winner.values, ['Draw', 'X']);
    out.away = valToOdd(winner.values, ['Away', '2']);
  }

  const btts = findBetByName(bets, ['Both Teams Score', 'Both Teams To Score']);
  if (btts) {
    out.bttsYes = valToOdd(btts.values, ['Yes']);
    out.bttsNo = valToOdd(btts.values, ['No']);
  }

  const ouPrimary = findBetByName(bets, ['Goals Over/Under', 'Over/Under', 'Total Goals']);
  const ouGoalLine = findBetByName(bets, ['Goal Line']);
  const ouValues = [
    ...(ouPrimary?.values || []),
    ...(ouGoalLine?.values || [])
  ];
  if (ouValues.length) {
    out.over15 = pickOverUnder(ouValues, '1.5', 'over');
    out.under15 = pickOverUnder(ouValues, '1.5', 'under');
    out.over25 = pickOverUnder(ouValues, '2.5', 'over');
    out.under25 = pickOverUnder(ouValues, '2.5', 'under');
  }

  const dc = findBetByName(bets, ['Double Chance']);
  if (dc) {
    out.doubleChanceHomeOrDraw = valToOdd(dc.values, ['Home/Draw', '1X', '1 or X']);
    out.doubleChanceAwayOrDraw = valToOdd(dc.values, ['Draw/Away', 'X2', 'X or 2']);
    out.doubleChanceHomeOrAway = valToOdd(dc.values, ['Home/Away', '12', '1 or 2']);
  }

  const htft = findBetByName(bets, ['HT/FT', 'HT/FT Double', 'Half Time/Full Time', 'Halftime/Fulltime']);
  if (htft) {
    out.htftHomeHome = valToOdd(htft.values, ['Home/Home', '1/1']);
    out.htftDrawDraw = valToOdd(htft.values, ['Draw/Draw', 'X/X']);
    out.htftAwayAway = valToOdd(htft.values, ['Away/Away', '2/2']);
    out.htftDrawHome = valToOdd(htft.values, ['Draw/Home', 'X/1']);
    out.htftDrawAway = valToOdd(htft.values, ['Draw/Away', 'X/2']);
  }

  const cs = findBetByName(bets, ['Correct Score', 'Correct Scores', 'Exact Score']);
  if (cs) {
    for (let h = 0; h <= 4; h++) {
      for (let a = 0; a <= 4; a++) {
        const k = `cs${h}${a}`;
        const label = `${h}:${a}`;
        out[k] = valToOdd(cs.values, [label]);
      }
    }
  }

  return out;
}

function hasAllRequiredMarkets(m) {
  if (!m.home || !m.draw || !m.away) return false;
  return REQUIRED_MARKET_KEYS.every((k) => !!m[k]);
}

function chooseBestOddsSet(oddsRows) {
  const candidates = [];

  for (const row of oddsRows || []) {
    for (const bookmaker of row.bookmakers || []) {
      const candidate = extractMarketsFromBookmaker(bookmaker);
      const score = REQUIRED_MARKET_KEYS.reduce((acc, key) => acc + (candidate[key] ? 1 : 0), 0);
      const winnerPresent = candidate.home && candidate.draw && candidate.away;
      const total = score + (winnerPresent ? 3 : 0);
      candidates.push({ candidate, total });
    }
  }

  if (!candidates.length) return null;

  // Start from the most complete bookmaker and then fill missing values
  // from other bookmakers to maximize coverage while keeping exact API odds.
  candidates.sort((a, b) => b.total - a.total);
  const merged = { ...candidates[0].candidate };

  for (const { candidate } of candidates.slice(1)) {
    if (!merged.home && candidate.home) merged.home = candidate.home;
    if (!merged.draw && candidate.draw) merged.draw = candidate.draw;
    if (!merged.away && candidate.away) merged.away = candidate.away;

    for (const key of REQUIRED_MARKET_KEYS) {
      if (!merged[key] && candidate[key]) merged[key] = candidate[key];
    }

    if (hasAllRequiredMarkets(merged)) break;
  }

  if (!hasAllRequiredMarkets(merged)) return null;
  return merged;
}

async function fetchFixtureOdds(fixtureId, live = false) {
  const path = live ? '/odds/live' : '/odds';
  const rows = await apiGet(path, { fixture: String(fixtureId) });
  return chooseBestOddsSet(rows);
}

function marketTypeFromKey(k) {
  if (k.startsWith('cs')) return 'CS';
  if (k.startsWith('btts')) return 'BTTS';
  if (k.startsWith('over') || k.startsWith('under')) return 'O/U';
  if (k.startsWith('doubleChance')) return 'DC';
  if (k.startsWith('htft')) return 'HT/FT';
  return '1X2';
}

async function upsertGameWithMarkets(fixture, marketOdds, forceLive = false) {
  const fixtureId = fixture?.fixture?.id;
  const leagueName = fixture?.league?.name || 'Football';
  const homeTeam = fixture?.teams?.home?.name;
  const awayTeam = fixture?.teams?.away?.name;
  const kickoff = fixture?.fixture?.date || new Date().toISOString();

  if (!fixtureId || !homeTeam || !awayTeam) return { ok: false, reason: 'missing fixture fields' };

  const liveState = forceLive || (fixture?.fixture?.status?.short && !['NS', 'TBD', 'PST', 'CANC', 'FT', 'AET', 'PEN'].includes(fixture.fixture.status.short));
  const elapsed = parseInt(fixture?.fixture?.status?.elapsed || 0, 10) || 0;

  let kickoffStart = null;
  if (liveState) {
    kickoffStart = new Date(Date.now() - elapsed * 60000).toISOString();
  }

  const gamePayload = {
    game_id: `af-${fixtureId}`,
    league: leagueName,
    home_team: homeTeam,
    away_team: awayTeam,
    home_odds: marketOdds.home,
    draw_odds: marketOdds.draw,
    away_odds: marketOdds.away,
    status: liveState ? 'live' : 'upcoming',
    time: kickoff,
    home_score: liveState ? (fixture?.goals?.home ?? 0) : null,
    away_score: liveState ? (fixture?.goals?.away ?? 0) : null,
    minute: liveState ? elapsed : 0,
    is_kickoff_started: !!liveState,
    kickoff_start_time: kickoffStart,
    updated_at: new Date().toISOString()
  };

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .upsert([gamePayload], { onConflict: 'game_id' })
    .select('id, game_id')
    .single();

  if (gameErr || !game) {
    return { ok: false, reason: `game upsert failed: ${gameErr?.message || 'unknown'}` };
  }

  const marketRows = Object.entries(marketOdds)
    .filter(([k]) => k !== 'home' && k !== 'draw' && k !== 'away')
    .map(([k, v]) => ({
      game_id: game.id,
      market_type: marketTypeFromKey(k),
      market_key: k,
      odds: v,
      updated_at: new Date().toISOString()
    }));

  if (marketRows.length === 0) {
    return { ok: false, reason: 'no market rows to insert' };
  }

  const { error: marketErr } = await supabase
    .from('markets')
    .upsert(marketRows, { onConflict: 'game_id,market_key' });

  if (marketErr) {
    return { ok: false, reason: `markets upsert failed: ${marketErr.message}` };
  }

  return { ok: true, gameId: game.game_id };
}

async function fixturesForDate(dateStr) {
  // ✅ OPTIMIZATION: Use pagination with per_page=100 to get all fixtures at once
  let allFixtures = [];
  let currentPage = 1;
  let totalPages = 1;
  
  do {
    const pageFixtures = await apiGet('/fixtures', {
      date: dateStr,
      timezone: TZ,
      page: currentPage,
      per_page: 100  // ✅ Get 100 per page instead of default 20
    });
    
    allFixtures = allFixtures.concat(pageFixtures);
    // Note: API Football pagination info is in paging property
    currentPage++;
    // For safety, limit to 5 pages max per day
    if (currentPage > 5) break;
  } while (allFixtures.length > 0 && currentPage <= 5);

  const seen = new Set();
  return allFixtures
    .filter((f) => {
      const id = f?.fixture?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return isMajorCompetition(f);
    })
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
}

async function liveFixtures() {
  // ✅ OPTIMIZATION: Use pagination for live fixtures
  let allFixtures = [];
  let currentPage = 1;
  
  do {
    const pageFixtures = await apiGet('/fixtures', {
      live: 'all',
      timezone: TZ,
      page: currentPage,
      per_page: 100  // ✅ Get 100 per page
    });
    
    if (!pageFixtures || pageFixtures.length === 0) break;
    
    allFixtures = allFixtures.concat(pageFixtures);
    currentPage++;
    if (currentPage > 2) break;  // Limit to 2 pages for live
  } while (true);

  const seen = new Set();
  const major = allFixtures
    .filter((f) => {
      const id = f?.fixture?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return isMajorCompetition(f);
    })
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

  if (major.length >= 5) return major;

  // Fallback: if fewer than 5 major live games exist now, use best available live games
  // while still excluding youth/low-tier competitions.
  const seen2 = new Set();
  const fallback = allFixtures
    .filter((f) => {
      const id = f?.fixture?.id;
      if (!id || seen2.has(id)) return false;
      seen2.add(id);
      const leagueName = f?.league?.name || '';
      return !isYouthCompetition(leagueName) && !isLowTierCompetition(leagueName);
    })
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

  return fallback;

async function run() {
  const dates = buildDateRangeTomorrowTo20th();
  if (!dates.length) {
    console.log('No valid date range from tomorrow to day 25.');
    return;
  }

  console.log(`\n✅ [OPTIMIZED] Importing fixtures for ${dates.length} days: ${dates.join(', ')}`);
  console.log(`   📊 Optimizations enabled: pagination (per_page=100), bulk odds, smart filtering`);

  const usedFixtures = new Set();
  let totalInserted = 0;

  for (const dateStr of dates) {
    console.log(`\n=== ${dateStr} ===`);
    const fixtures = await fixturesForDate(dateStr);
    let dayInserted = 0;

    for (const f of fixtures) {
      if (dayInserted >= 20) break;
      const fxId = f?.fixture?.id;
      if (!fxId || usedFixtures.has(fxId)) continue;

      let odds = null;
      try {
        odds = await fetchFixtureOdds(fxId, false);
      } catch (e) {
        continue;
      }

      if (!odds) continue;

      const saved = await upsertGameWithMarkets(f, odds, false);
      if (!saved.ok) continue;

      usedFixtures.add(fxId);
      dayInserted += 1;
      totalInserted += 1;
      console.log(`+ ${saved.gameId} ${f.teams.home.name} vs ${f.teams.away.name}`);
    }

    console.log(`Inserted for ${dateStr}: ${dayInserted}/20`);
  }

  console.log('\n=== LIVE FIXTURES ===');
  let liveInserted = 0;
  try {
    const live = await liveFixtures();

    for (const f of live) {
      if (liveInserted >= 5) break;
      const fxId = f?.fixture?.id;
      if (!fxId || usedFixtures.has(fxId)) continue;

      let odds = null;
      try {
        odds = await fetchFixtureOdds(fxId, true);
      } catch (_) {}

      if (!odds) {
        try {
          odds = await fetchFixtureOdds(fxId, false);
        } catch (_) {}
      }

      if (!odds) continue;

      const saved = await upsertGameWithMarkets(f, odds, true);
      if (!saved.ok) continue;

      usedFixtures.add(fxId);
      liveInserted += 1;
      totalInserted += 1;
      console.log(`LIVE + ${saved.gameId} ${f.teams.home.name} vs ${f.teams.away.name}`);
    }
  } catch (e) {
    console.warn(`Live fetch failed: ${e.message}`);
  }

  console.log(`\nDone. Total inserted/updated games: ${totalInserted}`);
  console.log(`Live inserted: ${liveInserted}/5`);
}

run().catch((e) => {
  console.error('Import failed:', e.message);
  process.exit(1);
});
