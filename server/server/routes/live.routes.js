/**
 * Live data routes — real-time scores and odds from API-Football.
 *
 * GET /api/live/sync  — Fetch live fixtures from API-Football, update scores + odds in DB.
 * GET /api/live/games — Return all live games with current scores and markets.
 */

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const API_BASE = 'https://v3.football.api-sports.io';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  );
}

function getApiKey() {
  return process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || '';
}

// ── Market parsing helpers (mirrors import-api-football-games.js) ──────────────

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
  return valToOddStartsWith(values, `${sideNorm} ${line}`);
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
  const ouValues = [...(ouPrimary?.values || []), ...(ouGoalLine?.values || [])];
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
        out[`cs${h}${a}`] = valToOdd(cs.values, [`${h}:${a}`]);
      }
    }
  }

  return out;
}

function chooseBestOddsSet(oddsRows) {
  const candidates = [];
  for (const row of oddsRows || []) {
    for (const bookmaker of row.bookmakers || []) {
      const candidate = extractMarketsFromBookmaker(bookmaker);
      const score = Object.values(candidate).filter(Boolean).length;
      candidates.push({ candidate, total: score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.total - a.total);
  const merged = { ...candidates[0].candidate };
  for (const { candidate } of candidates.slice(1)) {
    for (const key of Object.keys(candidate)) {
      if (!merged[key] && candidate[key]) merged[key] = candidate[key];
    }
  }
  return merged;
}

function marketTypeFromKey(k) {
  if (k.startsWith('cs')) return 'CS';
  if (k.startsWith('btts')) return 'BTTS';
  if (k.startsWith('over') || k.startsWith('under')) return 'O/U';
  if (k.startsWith('doubleChance')) return 'DC';
  if (k.startsWith('htft')) return 'HT/FT';
  return '1X2';
}

async function apiGet(path, params, apiKey) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
  const resp = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!resp.ok) throw new Error(`API-Football ${resp.status} at ${path}`);
  const json = await resp.json();
  return json.response || [];
}

function isFinishedStatus(short) {
  return ['FT', 'AET', 'PEN', 'CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(String(short || '').toUpperCase());
}

function isBreakStatus(short) {
  return ['HT', 'BT', 'INT'].includes(String(short || '').toUpperCase());
}

function isUpcomingStatus(short) {
  return ['NS', 'TBD', 'PST'].includes(String(short || '').toUpperCase());
}

function isLiveStatus(short) {
  const normalized = String(short || '').toUpperCase();
  return !!normalized && !isUpcomingStatus(normalized) && !isFinishedStatus(normalized);
}

const TZ = 'Africa/Nairobi';
const TARGET_MATCHES_PER_DAY = 100;

const PREFERRED_LEAGUE_IDS = new Set([
  2, 3, 848,
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

function formatDateInTZ(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function isYouthCompetition(leagueName) {
  if (!leagueName) return false;
  return /(u[-\s]?(18|19|20|21|22)|under[-\s]?(18|19|20|21|22))/i.test(leagueName);
}

function isLowTierCompetition(leagueName) {
  const name = String(leagueName || '').toLowerCase();
  return /(reserve|reserves|women|feminin|femenil|amateur|regional|3\. division|third league|iv |ii liga|iii liga|liga 2|2\. division|second league|1 lyga|birinci|challenger|u23|u21|u20|u19|u18)/i.test(name);
}

function isMajorCompetition(fixture) {
  const leagueId = fixture?.league?.id;
  const leagueName = fixture?.league?.name || '';

  if (isYouthCompetition(leagueName) || isLowTierCompetition(leagueName)) return false;
  if (PREFERRED_LEAGUE_IDS.has(leagueId)) return true;
  return true;
}

function classifyGameDateInTZ(isoString) {
  if (!isoString) return null;
  const dt = new Date(isoString);
  if (isNaN(dt.getTime())) return null;
  return formatDateInTZ(dt);
}

function isUpcomingFixtureForSchedule(fixture, targetDate) {
  const short = String(fixture?.fixture?.status?.short || '').toUpperCase();
  if (!isUpcomingStatus(short)) return false;

  const kickoffMs = new Date(fixture?.fixture?.date || 0).getTime();
  if (isNaN(kickoffMs)) return false;

  const today = formatDateInTZ(new Date());
  if (targetDate === today) {
    return kickoffMs > Date.now();
  }

  return true;
}

const REQUIRED_MARKET_KEYS = [
  'bttsYes', 'bttsNo',
  'over15', 'under15', 'over25', 'under25',
  'doubleChanceHomeOrDraw', 'doubleChanceAwayOrDraw', 'doubleChanceHomeOrAway',
  'htftHomeHome', 'htftDrawDraw', 'htftAwayAway', 'htftDrawHome', 'htftDrawAway',
  ...Array.from({ length: 25 }, (_, i) => `cs${Math.floor(i / 5)}${i % 5}`)
];

function hasAllRequiredMarkets(m) {
  if (!m?.home || !m?.draw || !m?.away) return false;
  return REQUIRED_MARKET_KEYS.every((k) => !!m[k]);
}

function hasBasic1X2Markets(m) {
  return !!(m?.home && m?.draw && m?.away);
}

async function upsertScheduleGameWithMarkets(supabase, fixture, marketOdds) {
  const fixtureId = fixture?.fixture?.id;
  const leagueName = fixture?.league?.name || 'Football';
  const homeTeam = fixture?.teams?.home?.name;
  const awayTeam = fixture?.teams?.away?.name;
  const kickoff = fixture?.fixture?.date || new Date().toISOString();

  if (!fixtureId || !homeTeam || !awayTeam) return { ok: false };

  const gamePayload = {
    game_id: `af-${fixtureId}`,
    league: leagueName,
    home_team: homeTeam,
    away_team: awayTeam,
    home_odds: marketOdds.home,
    draw_odds: marketOdds.draw,
    status: 'upcoming',
    time: kickoff,
    home_score: null,
    away_score: null,
    minute: 0,
    is_kickoff_started: false,
    kickoff_start_time: null,
    game_paused: false,
    kickoff_paused_at: null,
    is_halftime: false,
    updated_at: new Date().toISOString()
  };

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .upsert([gamePayload], { onConflict: 'game_id' })
    .select('id, game_id')
    .single();

  if (gameErr || !game) return { ok: false };

  const marketRows = Object.entries(marketOdds)
    .filter(([k, v]) => k !== 'home' && k !== 'draw' && k !== 'away' && v)
    .map(([k, v]) => ({
      game_id: game.id,
      market_type: marketTypeFromKey(k),
      market_key: k,
      odds: v,
      manually_edited_at: null, // API-managed markets, not manually edited
      updated_at: new Date().toISOString()
    }));

  if (marketRows.length > 0) {
    await supabase
      .from('markets')
      .upsert(marketRows, { onConflict: 'game_id,market_key' });
  }

  return { ok: true, gameId: game.game_id };
}

// ── GET /api/live/bootstrap-schedule ──────────────────────────────────────────
// ⛔ DISABLED — Games added via API fetch now persist until admin deletes them.
// This endpoint previously deleted and re-imported af- games, causing games to disappear.
router.get('/bootstrap-schedule', async (req, res) => {
  return res.json({
    success: true,
    refreshed: false,
    message: 'bootstrap-schedule is disabled. Games persist until admin deletes them.',
  });
});

// ── GET /api/live/sync ─────────────────────────────────────────────────────────
// Fetches live-fixture data from API-Football and updates scores + live odds in DB.
router.get('/sync', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'API_FOOTBALL_KEY not configured' });
  }

  const supabase = getSupabase();
  const updated = [];
  const errors = [];
  let finished = 0;

  try {
    // Step 1: get all currently live fixtures from API-Football
    const liveFixtures = await apiGet('/fixtures', { live: 'all' }, apiKey);

    // Build lookup: fixtureId (number) → fixture object
    const liveMap = {};
    for (const f of liveFixtures) {
      const id = f?.fixture?.id;
      if (id) liveMap[id] = f;
    }

    // Step 2: load af-* games from DB that are live or upcoming
    const { data: dbGames, error: dbError } = await supabase
      .from('games')
      .select('id, game_id, status, time, kickoff_start_time, game_paused, kickoff_paused_at')
      .like('game_id', 'af-%')
      .in('status', ['live', 'upcoming']);

    if (dbError) {
      return res.status(500).json({ success: false, message: dbError.message });
    }

    const overdueDates = Array.from(new Set(
      (dbGames || [])
        .filter((g) => g.status === 'upcoming')
        .filter((g) => {
          const kickoffMs = new Date(g.time || 0).getTime();
          return !isNaN(kickoffMs) && kickoffMs <= Date.now();
        })
        .map((g) => classifyGameDateInTZ(g.time))
        .filter(Boolean)
    ));

    const scheduledFixtureMap = {};
    for (const dateStr of overdueDates) {
      try {
        const fixtures = await apiGet('/fixtures', { date: dateStr, timezone: TZ }, apiKey);
        for (const fixture of fixtures || []) {
          const fixtureId = fixture?.fixture?.id;
          if (fixtureId) scheduledFixtureMap[fixtureId] = fixture;
        }
      } catch (e) {
        errors.push({ scheduleDate: dateStr, scheduleSyncError: String(e?.message || e) });
      }
    }

    // Step 3: update each DB game that is currently live in the API
    for (const dbGame of dbGames || []) {
      const fixtureId = parseInt(dbGame.game_id.replace('af-', ''), 10);
      if (!fixtureId) continue;

      const liveFixture = liveMap[fixtureId];
      if (!liveFixture) continue; // Not live right now — skip

      const statusShort = liveFixture?.fixture?.status?.short || '';
      const isHalftime = isBreakStatus(statusShort);
      const elapsed = parseInt(liveFixture?.fixture?.status?.elapsed || 0, 10) || 0;
      const homeScore = liveFixture?.goals?.home ?? 0;
      const awayScore = liveFixture?.goals?.away ?? 0;
      const nowIso = new Date().toISOString();

      let kickoffStartTime = dbGame.kickoff_start_time;
      let gamePaused = !!dbGame.game_paused;
      let kickoffPausedAt = dbGame.kickoff_paused_at || null;

      // Ensure kickoff_start_time exists for timer-based live display.
      if (!kickoffStartTime) {
        kickoffStartTime = new Date(Date.now() - elapsed * 60000).toISOString();
      }

      // If API says halftime, pause the clock once. If match resumes, shift kickoff
      // forward by the break duration so the timer resumes correctly.
      if (isHalftime) {
        if (!gamePaused) {
          gamePaused = true;
          kickoffPausedAt = nowIso;
        }
      } else if (gamePaused && kickoffPausedAt && kickoffStartTime) {
        const pausedAtMs = new Date(kickoffPausedAt).getTime();
        const kickoffStartMs = new Date(kickoffStartTime).getTime();
        if (!isNaN(pausedAtMs) && !isNaN(kickoffStartMs)) {
          const pauseDurationMs = Math.max(0, Date.now() - pausedAtMs);
          kickoffStartTime = new Date(kickoffStartMs + pauseDurationMs).toISOString();
        }
        gamePaused = false;
        kickoffPausedAt = null;
      } else if (!isHalftime) {
        gamePaused = false;
        kickoffPausedAt = null;
      }

      // 3a. Update scores, minute, status in games table
      const { error: gameErr } = await supabase
        .from('games')
        .update({
          home_score: homeScore,
          away_score: awayScore,
          minute: elapsed,
          status: 'live',
          is_kickoff_started: true,
          kickoff_start_time: kickoffStartTime,
          is_halftime: isHalftime,
          game_paused: gamePaused,
          kickoff_paused_at: kickoffPausedAt,
          updated_at: nowIso,
        })
        .eq('id', dbGame.id);

      if (gameErr) {
        errors.push({ gameId: dbGame.game_id, error: gameErr.message });
        continue;
      }

      // 3b. Fetch live odds and update markets table
      try {
        const liveOddsRows = await apiGet('/odds/live', { fixture: String(fixtureId) }, apiKey);
        const marketOdds = chooseBestOddsSet(liveOddsRows);

        // Get existing markets to preserve manually-edited ones.
        // Fallback gracefully if manually_edited_at column is not yet migrated.
        let existingMarkets = [];
        let manualEditProtectionEnabled = true;
        const existingWithManual = await supabase
          .from('markets')
          .select('id, market_key, manually_edited_at')
          .eq('game_id', dbGame.id)
          .in('market_type', ['1X2', 'BTTS', 'O/U', 'DC', 'HT/FT', 'CS']);

        if (existingWithManual.error && /manually_edited_at|column .* does not exist/i.test(existingWithManual.error.message || '')) {
          manualEditProtectionEnabled = false;
          const existingFallback = await supabase
            .from('markets')
            .select('id, market_key')
            .eq('game_id', dbGame.id)
            .in('market_type', ['1X2', 'BTTS', 'O/U', 'DC', 'HT/FT', 'CS']);
          if (existingFallback.error) {
            errors.push({ gameId: dbGame.game_id, readMarketsError: existingFallback.error.message });
          } else {
            existingMarkets = existingFallback.data || [];
          }
        } else if (existingWithManual.error) {
          errors.push({ gameId: dbGame.game_id, readMarketsError: existingWithManual.error.message });
        } else {
          existingMarkets = existingWithManual.data || [];
        }

        // Track which market keys were manually edited recently (within 60 seconds)
        const manualEditThresholdMs = 60 * 1000; // 60 seconds
        const nowMs = Date.now();
        const manuallyEditedKeys = new Set();
        for (const market of existingMarkets || []) {
          if (!manualEditProtectionEnabled) break;
          if (market.manually_edited_at) {
            const editedAtMs = new Date(market.manually_edited_at).getTime();
            if (nowMs - editedAtMs < manualEditThresholdMs) {
              manuallyEditedKeys.add(market.market_key);
              console.log(`🔒 Skipping update for manually-edited market: ${market.market_key} (edited ${Math.round((nowMs - editedAtMs) / 1000)}s ago)`);
            }
          }
        }

        // Delete old markets ONLY if they weren't manually edited recently
        if (existingMarkets && existingMarkets.length > 0) {
          const marketKeysToDelete = (existingMarkets || [])
            .filter(m => !manuallyEditedKeys.has(m.market_key))
            .map(m => m.id);

          if (marketKeysToDelete.length > 0) {
            const { error: clearErr } = await supabase
              .from('markets')
              .delete()
              .in('id', marketKeysToDelete);

            if (clearErr) {
              errors.push({ gameId: dbGame.game_id, clearMarketsError: clearErr.message });
            } else {
              console.log(`✅ Cleared ${marketKeysToDelete.length} API-managed markets for ${dbGame.game_id}`);
            }
          }
        }

        if (marketOdds) {
          // Store non-1X2 markets as usual (skip if manually edited recently)
          const marketRows = Object.entries(marketOdds)
            .filter(([k, v]) => {
              // Skip if manually edited recently
              if (manuallyEditedKeys.has(k)) {
                console.log(`🔒 Skipping API update for manually-edited market: ${k}`);
                return false;
              }
              return k !== 'home' && k !== 'draw' && k !== 'away' && v;
            })
            .map(([k, v]) => ({
              game_id: dbGame.id,
              market_type: marketTypeFromKey(k),
              market_key: k,
              odds: v,
              updated_at: new Date().toISOString(),
            }));

          // Store API live 1X2 as dedicated market keys so frontend can use them.
          // We deliberately do NOT overwrite games.home_odds so that the pre-match
          // odds remain available as the Poisson model baseline.
          if (marketOdds.home && !manuallyEditedKeys.has('liveHome')) {
            marketRows.push({ 
              game_id: dbGame.id, 
              market_type: '1X2', 
              market_key: 'liveHome', 
              odds: marketOdds.home, 
              updated_at: new Date().toISOString() 
            });
          }
          if (marketOdds.draw && !manuallyEditedKeys.has('liveDraw')) {
            marketRows.push({ 
              game_id: dbGame.id, 
              market_type: '1X2', 
              market_key: 'liveDraw', 
              odds: marketOdds.draw, 
              updated_at: new Date().toISOString() 
            });
          }
          if (marketOdds.away && !manuallyEditedKeys.has('liveAway')) {
            marketRows.push({ 
              game_id: dbGame.id, 
              market_type: '1X2', 
              market_key: 'liveAway', 
              odds: marketOdds.away, 
              updated_at: new Date().toISOString() 
            });
          }

          const finalMarketRows = manualEditProtectionEnabled
            ? marketRows.map((row) => ({ ...row, manually_edited_at: null }))
            : marketRows;

          if (finalMarketRows.length > 0) {
            const { error: upsertErr } = await supabase
              .from('markets')
              .upsert(finalMarketRows, { onConflict: 'game_id,market_key' });

            if (upsertErr) {
              errors.push({ gameId: dbGame.game_id, upsertMarketsError: upsertErr.message });
            } else {
              console.log(`✅ Upserted ${finalMarketRows.length} markets for ${dbGame.game_id} (preserved ${manuallyEditedKeys.size} manually-edited)`);
            }
          }
        }
      } catch (oddsErr) {
        // Odds unavailable is non-fatal — score was already updated
        errors.push({ gameId: dbGame.game_id, oddsError: String(oddsErr.message) });
      }

      updated.push({ gameId: dbGame.game_id, homeScore, awayScore, minute: elapsed });
    }

    // Step 4: mark any upcoming games that are now live in the API
    for (const [fixtureIdStr, liveFixture] of Object.entries(liveMap)) {
      const gameId = `af-${fixtureIdStr}`;
      const alreadyProcessed = dbGames?.some((g) => g.game_id === gameId);
      if (alreadyProcessed) continue;

      // Game exists in DB as upcoming — flip status to live
      const statusShort = liveFixture?.fixture?.status?.short || '';
      const isHalftime = isBreakStatus(statusShort);
      const elapsed = parseInt(liveFixture?.fixture?.status?.elapsed || 0, 10) || 0;

      await supabase
        .from('games')
        .update({
          status: 'live',
          is_kickoff_started: true,
          kickoff_start_time: new Date(Date.now() - elapsed * 60000).toISOString(),
          home_score: liveFixture?.goals?.home ?? 0,
          away_score: liveFixture?.goals?.away ?? 0,
          minute: elapsed,
          is_halftime: isHalftime,
          game_paused: isHalftime,
          kickoff_paused_at: isHalftime ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('game_id', gameId);
    }

    // Step 5: live in DB but no longer in API live feed => check if ended, then mark finished.
    const dbLiveGames = (dbGames || []).filter((g) => g.status === 'live');
    for (const dbGame of dbLiveGames) {
      const fixtureId = parseInt(dbGame.game_id.replace('af-', ''), 10);
      if (!fixtureId || liveMap[fixtureId]) continue;

      try {
        const fixtureRows = await apiGet('/fixtures', { id: String(fixtureId) }, apiKey);
        const fixture = fixtureRows?.[0];
        const short = fixture?.fixture?.status?.short || '';
        if (!isFinishedStatus(short)) continue;

        const elapsed = parseInt(fixture?.fixture?.status?.elapsed || 0, 10) || 0;
        const homeScore = fixture?.goals?.home ?? null;
        const awayScore = fixture?.goals?.away ?? null;

        const { error: finishErr } = await supabase
          .from('games')
          .update({
            status: 'finished',
            minute: elapsed,
            home_score: homeScore,
            away_score: awayScore,
            is_halftime: false,
            game_paused: false,
            kickoff_paused_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbGame.id);

        if (finishErr) {
          errors.push({ gameId: dbGame.game_id, finishError: finishErr.message });
        } else {
          finished += 1;
        }
      } catch (e) {
        errors.push({ gameId: dbGame.game_id, finishCheckError: String(e?.message || e) });
      }
    }

    // Step 6: upcoming in DB but kickoff has passed => reconcile against fixture status.
    const overdueUpcomingGames = (dbGames || []).filter((g) => {
      if (g.status !== 'upcoming') return false;
      const kickoffMs = new Date(g.time || 0).getTime();
      return !isNaN(kickoffMs) && kickoffMs <= Date.now();
    });

    for (const dbGame of overdueUpcomingGames) {
      const fixtureId = parseInt(dbGame.game_id.replace('af-', ''), 10);
      if (!fixtureId || liveMap[fixtureId]) continue;

      const fixture = scheduledFixtureMap[fixtureId];
      if (!fixture) continue;

      const short = fixture?.fixture?.status?.short || '';
      const elapsed = parseInt(fixture?.fixture?.status?.elapsed || 0, 10) || 0;
      const homeScore = fixture?.goals?.home ?? 0;
      const awayScore = fixture?.goals?.away ?? 0;
      const isHalftime = isBreakStatus(short);
      const nowIso = new Date().toISOString();

      if (isFinishedStatus(short)) {
        const { error: finishErr } = await supabase
          .from('games')
          .update({
            status: 'finished',
            minute: elapsed,
            home_score: homeScore,
            away_score: awayScore,
            is_kickoff_started: true,
            is_halftime: false,
            game_paused: false,
            kickoff_paused_at: null,
            updated_at: nowIso,
          })
          .eq('id', dbGame.id);

        if (finishErr) {
          errors.push({ gameId: dbGame.game_id, overdueFinishError: finishErr.message });
        } else {
          finished += 1;
        }
        continue;
      }

      if (!isLiveStatus(short)) continue;

      const kickoffStartTime = new Date(Date.now() - elapsed * 60000).toISOString();
      const { error: liveErr } = await supabase
        .from('games')
        .update({
          status: 'live',
          is_kickoff_started: true,
          kickoff_start_time: kickoffStartTime,
          home_score: homeScore,
          away_score: awayScore,
          minute: elapsed,
          is_halftime: isHalftime,
          game_paused: isHalftime,
          kickoff_paused_at: isHalftime ? nowIso : null,
          updated_at: nowIso,
        })
        .eq('id', dbGame.id);

      if (liveErr) {
        errors.push({ gameId: dbGame.game_id, overdueLiveError: liveErr.message });
      }
    }

    return res.json({
      success: true,
      updated: updated.length,
      finished,
      errors: errors.length,
      games: updated,
      ...(errors.length && { errorDetails: errors }),
    });
  } catch (err) {
    console.error('❌ Live sync error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/live/games ────────────────────────────────────────────────────────
// Returns all currently-live games from DB with their latest scores and market odds.
router.get('/games', async (req, res) => {
  const supabase = getSupabase();
  try {
    const { data: games, error } = await supabase
      .from('games')
      .select(`
        id, game_id, league, home_team, away_team,
        home_odds, draw_odds, away_odds,
        status, time, home_score, away_score, minute,
        is_kickoff_started, kickoff_start_time,
        game_paused, kickoff_paused_at, is_halftime,
        markets ( market_key, odds )
      `)
      .eq('status', 'live')
      .order('time', { ascending: true });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    const result = (games || []).map((g) => {
      const marketsMap = {};
      for (const m of g.markets || []) {
        marketsMap[m.market_key] = parseFloat(m.odds);
      }
      return {
        game_id: g.game_id,
        id: g.id,
        league: g.league,
        home_team: g.home_team,
        away_team: g.away_team,
        home_odds: parseFloat(g.home_odds),
        draw_odds: parseFloat(g.draw_odds),
        away_odds: parseFloat(g.away_odds),
        status: g.status,
        time: g.time,
        home_score: g.home_score ?? 0,
        away_score: g.away_score ?? 0,
        minute: g.minute ?? 0,
        is_kickoff_started: g.is_kickoff_started,
        kickoff_start_time: g.kickoff_start_time,
        game_paused: g.game_paused,
        kickoff_paused_at: g.kickoff_paused_at,
        is_halftime: g.is_halftime,
        markets: marketsMap,
      };
    });

    return res.json({ success: true, games: result });
  } catch (err) {
    console.error('❌ Live games error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
