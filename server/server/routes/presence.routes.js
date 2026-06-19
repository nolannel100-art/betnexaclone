/**
 * User Presence Tracking Routes
 * Handles real-time user activity tracking and online status
 */

const express = require('express');
const router = express.Router();
const supabase = require('../services/database.js');
const { randomUUID } = require('crypto');
// How long a user stays "active" after their last heartbeat.
// Must be comfortably larger than the heartbeat interval (5 s) to absorb
// network jitter — 30 s gives a 25 s safety margin.
const ACTIVE_WINDOW_MS = 30000;
const memoryPresence = new Map();

const canUseDatabase = () => !!(supabase && typeof supabase.from === 'function');

const toIso = (value) => {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const normalizeUserRow = (user) => ({
  id: user?.id || '',
  username: user?.username || user?.name || '',
  phone_number: user?.phone_number || user?.phone || '',
  phone: user?.phone || user?.phone_number || '',
  email: user?.email || '',
  total_bets: user?.total_bets || 0,
  total_winnings: user?.total_winnings || 0,
  account_balance: user?.account_balance || 0,
});

const fetchUsersForPresence = async (userIds) => {
  if (!canUseDatabase() || !Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  // Try schema with phone_number first.
  let usersResult = await supabase
    .from('users')
    .select('id, username, name, phone_number, email, total_bets, total_winnings, account_balance')
    .in('id', userIds);

  // Fallback for schemas that use phone instead of phone_number.
  if (usersResult.error) {
    usersResult = await supabase
      .from('users')
      .select('id, username, name, phone, email, total_bets, total_winnings, account_balance')
      .in('id', userIds);
  }

  if (usersResult.error || !Array.isArray(usersResult.data)) {
    return new Map();
  }

  return new Map(usersResult.data.map((user) => [user.id, normalizeUserRow(user)]));
};

const upsertMemoryPresence = ({ sessionId, userId, status = 'online', lastActivity, loginTime, userAgent = '', ipAddress = '', username = '', phoneNumber = '' }) => {
  if (!sessionId) return;

  const existing = memoryPresence.get(sessionId);
  memoryPresence.set(sessionId, {
    id: existing?.id || sessionId,
    user_id: userId || existing?.user_id || null,
    session_id: sessionId,
    last_activity: toIso(lastActivity),
    login_time: toIso(loginTime || existing?.login_time || new Date()),
    status,
    user_agent: userAgent || existing?.user_agent || '',
    ip_address: ipAddress || existing?.ip_address || '',
    users: {
      id: userId || existing?.users?.id || '',
      username: username || existing?.users?.username || '',
      phone_number: phoneNumber || existing?.users?.phone_number || '',
      phone: phoneNumber || existing?.users?.phone || existing?.users?.phone_number || '',
      email: existing?.users?.email || '',
      total_bets: existing?.users?.total_bets || 0,
      total_winnings: existing?.users?.total_winnings || 0,
      account_balance: existing?.users?.account_balance || 0,
    },
  });
};

const attachUsersById = async (sessions) => {
  if (!Array.isArray(sessions) || sessions.length === 0 || !canUseDatabase()) {
    return sessions || [];
  }

  const userIds = [...new Set(sessions.map((row) => row.user_id).filter(Boolean))];
  if (userIds.length === 0) {
    return sessions;
  }

  const usersById = await fetchUsersForPresence(userIds);
  if (usersById.size === 0) {
    return sessions;
  }

  return sessions.map((session) => ({
    ...session,
    users: usersById.get(session.user_id) || session.users || undefined,
  }));
};

const getActiveMemorySessions = () => {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  const rows = [];

  for (const [sessionId, session] of memoryPresence.entries()) {
    const activityMs = new Date(session.last_activity).getTime();
    if (!Number.isFinite(activityMs) || activityMs <= cutoff || session.status !== 'online') {
      continue;
    }
    rows.push(session);
  }

  rows.sort((a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime());
  return rows;
};

/**
 * POST /api/presence/login
 * Record user login and create presence session
 */
router.post('/login', async (req, res) => {
  try {
    const { userId, username, phoneNumber, userAgent, ipAddress } = req.body;
    
    console.log('\n👤 [POST /api/presence/login] User login');
    console.log('   User ID:', userId);
    console.log('   Phone:', phoneNumber);

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    const sessionId = randomUUID();
    const nowIso = new Date().toISOString();
    let data = null;
    let usingMemoryFallback = false;

    if (canUseDatabase()) {
      const insertResult = await supabase
        .from('user_presence')
        .insert({
          user_id: userId,
          session_id: sessionId,
          status: 'online',
          user_agent: userAgent || '',
          ip_address: ipAddress || '',
          last_activity: nowIso,
          login_time: nowIso
        })
        .select()
        .single();

      data = insertResult.data;
      if (insertResult.error) {
        usingMemoryFallback = true;
        console.warn('⚠️ Presence DB login insert failed, using memory fallback:', insertResult.error.message);
      }
    } else {
      usingMemoryFallback = true;
    }

    if (usingMemoryFallback) {
      upsertMemoryPresence({
        sessionId,
        userId,
        status: 'online',
        lastActivity: nowIso,
        loginTime: nowIso,
        userAgent,
        ipAddress,
        username,
        phoneNumber,
      });
      data = memoryPresence.get(sessionId);
    }

    console.log(`✅ Presence session created for user ${userId}`);
    res.json({
      success: true,
      sessionId: sessionId,
      source: usingMemoryFallback ? 'memory' : 'database',
      data
    });
  } catch (error) {
    console.error('❌ Login presence error:', error);
    const fallbackSessionId = randomUUID();
    upsertMemoryPresence({
      sessionId: fallbackSessionId,
      userId: req.body?.userId || null,
      status: 'online',
      lastActivity: new Date(),
      loginTime: new Date(),
      userAgent: req.body?.userAgent || '',
      ipAddress: req.body?.ipAddress || '',
      username: req.body?.username || '',
      phoneNumber: req.body?.phoneNumber || '',
    });

    res.json({
      success: true,
      source: 'memory',
      sessionId: fallbackSessionId
    });
  }
});

/**
 * POST /api/presence/heartbeat
 * Update user activity timestamp (send every ~5 seconds)
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }

    const nowIso = new Date().toISOString();
    let data = null;
    let usingMemoryFallback = false;

    if (canUseDatabase()) {
      const updateResult = await supabase
        .from('user_presence')
        .update({
          last_activity: nowIso,
          status: 'online'
        })
        .eq('session_id', sessionId)
        .select()
        .single();

      data = updateResult.data;
      if (updateResult.error) {
        usingMemoryFallback = true;
        console.warn('⚠️ Heartbeat DB update failed, using memory fallback:', updateResult.error.message);
      }
    } else {
      usingMemoryFallback = true;
    }

    if (usingMemoryFallback) {
      upsertMemoryPresence({ sessionId, lastActivity: nowIso, status: 'online' });
      data = memoryPresence.get(sessionId) || null;
    }

    res.json({
      success: true,
      source: usingMemoryFallback ? 'memory' : 'database',
      data
    });
  } catch (error) {
    console.error('❌ Heartbeat error:', error);
    res.json({
      success: true,
      message: 'Heartbeat recorded'
    });
  }
});

/**
 * POST /api/presence/logout
 * Record user logout and delete presence session
 */
router.post('/logout', async (req, res) => {
  try {
    const sessionId = req.body?.sessionId || req.query?.sessionId;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }

    console.log('\n👤 [POST /api/presence/logout] User logout');
    console.log('   Session ID:', sessionId);

    memoryPresence.delete(sessionId);

    if (canUseDatabase()) {
      const { error } = await supabase
        .from('user_presence')
        .delete()
        .eq('session_id', sessionId);

      if (error) {
        console.warn('⚠️ Logout DB error:', error.message);
      }
    }

    console.log(`✅ Presence session deleted for session ${sessionId}`);
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.json({
      success: true,
      message: 'Logout recorded'
    });
  }
});

/**
 * GET /api/presence/active
 * Get list of currently active users
 * Only returns users active within the last 15 seconds (for real-time accuracy)
 */
router.get('/active', async (req, res) => {
  try {
    console.log('\n👥 [GET /api/presence/active] Fetching active users');

    // Keep online list very fresh for near real-time dashboard updates.
    const activeWindowStart = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();

    let activeSessions = [];
    let source = 'memory';

    if (canUseDatabase()) {
      const sessionResult = await supabase
        .from('user_presence')
        .select('id, user_id, session_id, last_activity, login_time, status')
        .eq('status', 'online')
        .gt('last_activity', activeWindowStart)
        .order('last_activity', { ascending: false });

      if (!sessionResult.error) {
        source = 'database';
        const rows = sessionResult.data || [];
        const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

        const usersById = await fetchUsersForPresence(userIds);

        activeSessions = rows.map((row) => ({
          ...row,
          users: usersById.get(row.user_id) || undefined,
        }));
      } else {
        console.warn('⚠️ Active presence DB query failed, using memory fallback:', sessionResult.error.message);
      }
    }

    if (source === 'memory') {
      activeSessions = await attachUsersById(getActiveMemorySessions());
    }

    const uniqueUserCount = new Set((activeSessions || []).map((s) => s.user_id)).size;
    console.log(`✅ Retrieved ${activeSessions?.length || 0} active sessions (${uniqueUserCount} unique users)`);

    res.json({
      success: true,
      source,
      activeCount: uniqueUserCount,
      users: activeSessions || []
    });
  } catch (error) {
    console.error('❌ Get active users error:', error);
    const activeSessions = await attachUsersById(getActiveMemorySessions());
    const uniqueUserCount = new Set((activeSessions || []).map((s) => s.user_id)).size;

    res.json({
      success: true,
      source: 'memory',
      activeCount: uniqueUserCount,
      users: activeSessions || []
    });
  }
});

/**
 * GET /api/presence/stats
 * Get real-time presence statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const activeWindowStart = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();

    let uniqueOnlineUsers = 0;
    let totalUsersCount = 0;
    let recentLoginsCount = 0;

    if (canUseDatabase()) {
      const onlineUsersResult = await supabase
        .from('user_presence')
        .select('user_id', { count: 'exact' })
        .eq('status', 'online')
        .gt('last_activity', activeWindowStart);

      if (!onlineUsersResult.error) {
        uniqueOnlineUsers = new Set((onlineUsersResult.data || []).map((u) => u.user_id)).size;
      }

      const totalUsersResult = await supabase
        .from('users')
        .select('id', { count: 'exact' });

      if (!totalUsersResult.error) {
        totalUsersCount = (totalUsersResult.data || []).length;
      }

      const recentLoginsResult = await supabase
        .from('user_presence')
        .select('id', { count: 'exact' })
        .gt('login_time', new Date(Date.now() - 3600 * 1000).toISOString());

      if (!recentLoginsResult.error) {
        recentLoginsCount = (recentLoginsResult.data || []).length;
      }
    }

    if (!uniqueOnlineUsers) {
      uniqueOnlineUsers = new Set(getActiveMemorySessions().map((u) => u.user_id)).size;
    }

    const stats = {
      onlineCount: uniqueOnlineUsers,
      totalUsers: totalUsersCount,
      recentLoginsLastHour: recentLoginsCount,
      onlinePercentage: totalUsersCount ? Math.round(uniqueOnlineUsers / totalUsersCount * 100) : 0
    };

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('❌ Get presence stats error:', error);
    res.json({
      success: true,
      stats: {
        onlineCount: 0,
        totalUsers: 0,
        recentLoginsLastHour: 0,
        onlinePercentage: 0
      }
    });
  }
});

module.exports = router;
