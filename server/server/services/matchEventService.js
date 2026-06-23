/**
 * Match Event Service
 * Handles automated scheduling and execution of match events (kickoff, halftime, resume, scores, end)
 */

const supabase = require('./database');

function nowIso() {
  return new Date().toISOString();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a game identifier to its UUID primary key.
 * The frontend stores game.id as the TEXT game_id column (e.g. "g1774435801687"),
 * while the DB match_events.game_id FK references games.id (UUID).
 */
async function resolveGameUuid(gameId) {
  if (UUID_REGEX.test(gameId)) return gameId; // Already a UUID
  const { data, error } = await supabase
    .from('games')
    .select('id')
    .eq('game_id', gameId)
    .single();
  if (error || !data) {
    console.error(`❌ Could not resolve game UUID for game_id "${gameId}": ${error?.message}`);
    return null;
  }
  return data.id;
}

/**
 * Create automated events for a match
 * @param {string} gameId - UUID of the game
 * @param {Array} events - Array of event configs: [{eventType, scheduledAt, eventData}, ...]
 */
async function createMatchEvents(gameId, events) {
  try {
    if (!events || events.length === 0) {
      console.log('ℹ️ No events to create for match');
      return { success: true, eventsCreated: 0 };
    }

    // Resolve TEXT game_id to UUID if needed
    const gameUuid = await resolveGameUuid(gameId);
    if (!gameUuid) {
      return { success: false, error: `Game not found for id: ${gameId}` };
    }

    console.log(`📅 Creating ${events.length} automated events for game ${gameUuid} (resolved from ${gameId})`);

    const eventRecords = events.map((evt) => ({
      game_id: gameUuid,
      event_type: evt.eventType,
      scheduled_at: evt.scheduledAt,
      event_data: evt.eventData || null,
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    }));

    const { data, error } = await supabase
      .from('match_events')
      .insert(eventRecords)
      .select();

    if (error) {
      console.error('❌ Error creating match events:', error.message);
      return { success: false, error: error.message };
    }

    console.log(`✅ Created ${data?.length || 0} match events`);
    return { success: true, eventsCreated: data?.length || 0, events: data };
  } catch (err) {
    console.error('❌ Exception in createMatchEvents:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get pending events for a game that need to execute
 * @param {string} gameId - UUID of the game
 * @returns {Array} Array of pending events
 */
async function getPendingEvents(gameId) {
  try {
    const gameUuid = await resolveGameUuid(gameId);
    if (!gameUuid) {
      console.warn(`⚠️ Game not found for pending events: ${gameId}`);
      return [];
    }

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('kickoff_start_time, is_kickoff_started, status')
      .eq('id', gameUuid)
      .single();

    if (gameError || !game) {
      console.warn(`⚠️ Game not found: ${gameId}`);
      return [];
    }

    if (game.status === 'finished') {
      return [];
    }

    // Get all pending events for this game
    const { data: events, error: eventsError } = await supabase
      .from('match_events')
      .select('*')
      .eq('game_id', gameUuid)
      .eq('is_active', true)
      .is('executed_at', null)
      .order('scheduled_at', { ascending: true });

    if (eventsError) {
      console.warn(`⚠️ Error fetching events: ${eventsError.message}`);
      return [];
    }

    if (!events || events.length === 0) {
      return [];
    }

    // Filter to only events that should execute now.
    const nowMs = Date.now();
    const pendingEvents = [];

    for (const event of events) {
      const scheduledMs = new Date(event.scheduled_at).getTime();
      const canRunBeforeKickoff = event.event_type === 'kickoff';
      if (!game.is_kickoff_started && !canRunBeforeKickoff) {
        continue;
      }

      if (scheduledMs <= nowMs) {
        pendingEvents.push(event);
      }
    }

    return pendingEvents;
  } catch (err) {
    console.error('❌ Exception in getPendingEvents:', err.message);
    return [];
  }
}

/**
 * Execute a single match event
 * @param {Object} event - Event record from database
 * @param {string} gameId - UUID of the game
 */
async function executeEvent(event, gameId) {
  try {
    console.log(`⚡ Executing event: ${event.event_type} for game ${gameId}`);

    // Get current game state
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    if (gameError || !game) {
      console.error(`❌ Game not found for event execution: ${gameId}`);
      return { success: false, error: 'Game not found' };
    }

    let updatePayload = { updated_at: nowIso() };
    let result = { success: true };

    switch (event.event_type) {
      case 'kickoff':
        console.log('🎯 Executing KICKOFF event');
        updatePayload.is_kickoff_started = true;
        updatePayload.status = 'live';
        updatePayload.game_paused = false;
        updatePayload.is_halftime = false;
        updatePayload.kickoff_paused_at = null;
        updatePayload.minute = 0;
        if (!game.kickoff_start_time) {
          updatePayload.kickoff_start_time = nowIso();
        }
        break;

      case 'halftime':
        console.log('⏱️  Executing HALFTIME event');
        updatePayload.is_halftime = true;
        updatePayload.game_paused = true;
        updatePayload.kickoff_paused_at = nowIso();
        if (!game.minute || game.minute < 45) {
          updatePayload.minute = 45;
        }
        break;

      case 'resume':
        console.log('▶️  Executing RESUME event (2nd half)');
        updatePayload.is_halftime = false;
        updatePayload.game_paused = false;
        updatePayload.kickoff_paused_at = null;
        // Calculate new kickoff_start_time so timer shows 45+ minutes
        const now = new Date();
        const secondsIntoSecondHalf = 45 * 60;
        const newKickoffTime = new Date(now.getTime() - secondsIntoSecondHalf * 1000);
        updatePayload.kickoff_start_time = newKickoffTime.toISOString();
        updatePayload.minute = 45;
        break;

      case 'score_update':
        console.log('⚽ Executing SCORE UPDATE event');
        if (event.event_data) {
          const { homeScore, awayScore, minute } = event.event_data;
          if (homeScore !== undefined) updatePayload.home_score = homeScore;
          if (awayScore !== undefined) updatePayload.away_score = awayScore;
          if (minute !== undefined) updatePayload.minute = minute;
        }
        break;

      case 'end':
        console.log('🏁 Executing END event');
        updatePayload.status = 'finished';
        updatePayload.game_paused = false;
        updatePayload.is_halftime = false;
        break;

      default:
        console.warn(`⚠️ Unknown event type: ${event.event_type}`);
        return { success: false, error: `Unknown event type: ${event.event_type}` };
    }

    // Apply the update
    const { data: updatedGame, error: updateError } = await supabase
      .from('games')
      .update(updatePayload)
      .eq('id', gameId)
      .select()
      .single();

    if (updateError) {
      console.error(`❌ Error updating game for event: ${updateError.message}`);
      return { success: false, error: updateError.message };
    }

    console.log(`✅ Event ${event.event_type} executed successfully`);

    // Mark event as executed
    const { error: markError } = await supabase
      .from('match_events')
      .update({ executed_at: nowIso() })
      .eq('id', event.id);

    if (markError) {
      console.warn(`⚠️ Failed to mark event as executed: ${markError.message}`);
    }

    // If this is a score update or end event, trigger bet settlement
    if (event.event_type === 'score_update' || event.event_type === 'end') {
      console.log(`📊 Triggering bet settlement for game ${gameId}`);
      result.settledBets = true; // Flag for caller to trigger settlement logic
    }

    return { success: true, ...result };
  } catch (err) {
    console.error(`❌ Exception in executeEvent: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Check and execute all pending events for a game
 * @param {string} gameId - UUID of the game
 */
async function checkAndExecutePendingEvents(gameId) {
  try {
    const pendingEvents = await getPendingEvents(gameId);

    if (pendingEvents.length === 0) {
      return { success: true, eventsExecuted: 0 };
    }

    console.log(`⚡ Found ${pendingEvents.length} pending events to execute for game ${gameId}`);

    let executedCount = 0;
    const results = [];

    for (const event of pendingEvents) {
      const result = await executeEvent(event, event.game_id || gameId);
      if (result.success) {
        executedCount++;
        results.push({ eventType: event.event_type, executed: true });
      } else {
        results.push({ eventType: event.event_type, executed: false, error: result.error });
      }
    }

    return { success: true, eventsExecuted: executedCount, results };
  } catch (err) {
    console.error('❌ Exception in checkAndExecutePendingEvents:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get all events for a game
 * @param {string} gameId - UUID of the game
 */
async function getMatchEvents(gameId) {
  try {
    // Resolve TEXT game_id to UUID if needed
    const gameUuid = await resolveGameUuid(gameId);
    if (!gameUuid) {
      return { success: false, error: `Game not found for id: ${gameId}` };
    }

    const { data, error } = await supabase
      .from('match_events')
      .select('*')
      .eq('game_id', gameUuid)
      .order('scheduled_at', { ascending: true });

    if (error) {
      console.error('❌ Error fetching match events:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, events: data || [] };
  } catch (err) {
    console.error('❌ Exception in getMatchEvents:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete an event
 * @param {string} eventId - UUID of the event
 */
async function deleteMatchEvent(eventId) {
  try {
    const { error } = await supabase
      .from('match_events')
      .delete()
      .eq('id', eventId);

    if (error) {
      console.error('❌ Error deleting match event:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('❌ Exception in deleteMatchEvent:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Update event timing or data
 * @param {string} eventId - UUID of the event
 * @param {Object} updates - Fields to update
 */
async function updateMatchEvent(eventId, updates) {
  try {
    const { data, error } = await supabase
      .from('match_events')
      .update({ ...updates, updated_at: nowIso() })
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      console.error('❌ Error updating match event:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, event: data };
  } catch (err) {
    console.error('❌ Exception in updateMatchEvent:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  createMatchEvents,
  getPendingEvents,
  executeEvent,
  checkAndExecutePendingEvents,
  getMatchEvents,
  deleteMatchEvent,
  updateMatchEvent,
};
