/**
 * Cron Routes
 * Scheduled jobs triggered by Vercel Cron or an external cron service.
 *
 * Available endpoints:
 *   GET /api/cron/remind-inactive
 *     — Sends SMS reminders to users inactive for ≥ 7 days.
 *     — Secured by CRON_SECRET environment variable.
 *       Add  Authorization: Bearer <CRON_SECRET>  header in the cron caller,
 *       OR pass  ?secret=<CRON_SECRET>  as a query parameter.
 */

const express = require('express');
const router = express.Router();
const supabase = require('../services/database.js');
const { sendInactivityReminderSms } = require('../services/smsService.js');
const { runPendingMatchEventsCycle } = require('../services/matchScheduler');

/**
 * Verify the incoming cron request is authorized.
 * Vercel auto-generates CRON_SECRET and sends it as  Authorization: Bearer <secret>
 * when invoking cron jobs. For manual/external calls pass the same header.
 */
function authorizeCron(req, res) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) {
    // No secret available — allow in dev, block in production
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({ success: false, message: 'Cron not configured.' });
      return false;
    }
    return true;
  }

  const authHeader = (req.headers['authorization'] || '').trim();
  const querySecret = (req.query.secret || '').trim();

  if (authHeader === `Bearer ${secret}` || querySecret === secret) {
    return true;
  }

  res.status(401).json({ success: false, message: 'Unauthorized' });
  return false;
}

/**
 * GET /api/cron/remind-inactive
 *
 * Queries users who have not logged in for >= 7 days and sends them
 * a reminder SMS. Only users with a phone number receive the message.
 *
 * Recommended schedule: once a week  (e.g. every Monday at 09:00 EAT)
 * Vercel cron format (UTC):  0 6 * * 1   (06:00 UTC = 09:00 EAT)
 */
router.get('/remind-inactive', async (req, res) => {
  if (!authorizeCron(req, res)) return;

  try {
    console.log('\n⏰ [CRON] Inactivity reminder job started');

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Users who logged in before 7 days ago (last_login_at column set by login route)
    const { data: inactiveByLogin, error: loginError } = await supabase
      .from('users')
      .select('id, username, phone_number, last_login_at, created_at')
      .not('phone_number', 'is', null)
      .neq('phone_number', '')
      .lt('last_login_at', sevenDaysAgo);

    // Users who never logged in (last_login_at IS NULL) but registered > 3 days ago
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: neverLoggedIn, error: neverError } = await supabase
      .from('users')
      .select('id, username, phone_number, last_login_at, created_at')
      .not('phone_number', 'is', null)
      .neq('phone_number', '')
      .is('last_login_at', null)
      .lt('created_at', threeDaysAgo);

    if (loginError) {
      console.warn('⚠️ [CRON] Error querying inactive users (by login):', loginError.message);
    }
    if (neverError) {
      console.warn('⚠️ [CRON] Error querying never-logged-in users:', neverError.message);
    }

    // Merge and deduplicate by user ID
    const seen = new Set();
    const eligible = [];
    for (const u of [...(inactiveByLogin || []), ...(neverLoggedIn || [])]) {
      if (!seen.has(u.id)) {
        seen.add(u.id);
        eligible.push(u);
      }
    }

    console.log(`📋 [CRON] Eligible users for reminder: ${eligible.length}`);

    let sent = 0;
    let failed = 0;

    for (const user of eligible) {
      const name = user.username || 'there';
      const ok = await sendInactivityReminderSms(user.phone_number, name);
      if (ok) {
        sent++;
      } else {
        failed++;
      }
      // Small delay between messages to respect API rate limits
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`✅ [CRON] Inactivity reminders: ${sent} sent, ${failed} failed`);

    res.json({
      success: true,
      eligible: eligible.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error('❌ [CRON] remind-inactive error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cron/match-events-tick
 *
 * Executes all due scheduled match events. This is the production-safe
 * scheduler path for Vercel serverless deployments.
 */
router.get('/match-events-tick', async (req, res) => {
  if (!authorizeCron(req, res)) return;

  try {
    console.log('\n⏰ [CRON] Match events tick started');
    const result = await runPendingMatchEventsCycle();

    if (!result.success) {
      return res.status(500).json(result);
    }

    console.log(`✅ [CRON] Match events tick completed: ${result.processedGames} games, ${result.dueEvents} due events`);
    res.json(result);
  } catch (error) {
    console.error('❌ [CRON] match-events-tick error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
