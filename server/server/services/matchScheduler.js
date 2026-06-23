/**
 * Match Event Scheduler
 * Background service that checks and executes pending match events
 * Runs every 5-10 seconds to trigger events at the correct time
 */

const supabase = require('./database');
const { checkAndExecutePendingEvents } = require('./matchEventService');

let schedulerActive = false;
let schedulerInterval = null;

async function runPendingMatchEventsCycle() {
  try {
    const now = new Date().toISOString();

    // Scan due events directly so kickoff can fire for upcoming matches.
    const { data: dueEvents, error } = await supabase
      .from('match_events')
      .select('game_id, event_type, scheduled_at')
      .eq('is_active', true)
      .is('executed_at', null)
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(100);

    if (error) {
      console.warn('⚠️ Error fetching due match events for scheduler:', error.message);
      return { success: false, error: error.message, processedGames: 0 };
    }

    if (!dueEvents || dueEvents.length === 0) {
      return { success: true, processedGames: 0, dueEvents: 0, results: [] };
    }

    const uniqueGameIds = [...new Set(dueEvents.map((event) => event.game_id).filter(Boolean))];
    const results = [];

    for (const gameId of uniqueGameIds) {
      const result = await checkAndExecutePendingEvents(gameId);
      results.push({ gameId, ...result });
    }

    return {
      success: true,
      processedGames: uniqueGameIds.length,
      dueEvents: dueEvents.length,
      results,
    };
  } catch (err) {
    console.error('❌ Exception in match event scheduler cycle:', err.message);
    return { success: false, error: err.message, processedGames: 0 };
  }
}

/**
 * Start the background match event scheduler
 * @param {number} intervalMs - How often to check for pending events (default: 5000ms)
 */
function startMatchEventScheduler(intervalMs = 5000) {
  if (schedulerActive) {
    console.log('⚠️ Match event scheduler already running');
    return;
  }

  console.log(`✅ Starting Match Event Scheduler (checking every ${intervalMs}ms)`);
  schedulerActive = true;

  schedulerInterval = setInterval(async () => {
    await runPendingMatchEventsCycle();
  }, intervalMs);

  console.log('🎯 Match Event Scheduler started successfully');
}

/**
 * Stop the background match event scheduler
 */
function stopMatchEventScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    schedulerActive = false;
    console.log('⛔ Match Event Scheduler stopped');
  }
}

/**
 * Check if scheduler is currently running
 */
function isSchedulerActive() {
  return schedulerActive;
}

/**
 * Execute pending events for a specific game (manual trigger)
 */
async function executePendingEventsManually(gameId) {
  console.log(`⚡ Manual trigger of pending events for game ${gameId}`);
  return await checkAndExecutePendingEvents(gameId);
}

module.exports = {
  startMatchEventScheduler,
  stopMatchEventScheduler,
  isSchedulerActive,
  executePendingEventsManually,
  runPendingMatchEventsCycle,
};
