/**
 * Authentication Routes
 * Handles user login and signup
 */

const express = require('express');
const router = express.Router();
const supabase = require('../services/database.js');
const { sendWelcomeSms } = require('../services/smsService.js');
const { generateUniqueBetnexaId } = require('../services/betnexaIdService.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async (operation, attempts = 2, delayMs = 250) => {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(delayMs);
      }
    }
  }

  throw lastError;
};

const getPhoneCandidates = (inputPhone) => {
  const raw = String(inputPhone || '').trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, '');
  const candidates = new Set([raw]);

  if (digits) {
    candidates.add(digits);
  }

  // Kenya number normalization helpers (07..., 2547..., +2547...)
  if (digits.startsWith('0') && digits.length === 10) {
    const tail = digits.slice(1);
    candidates.add(`+254${tail}`);
    candidates.add(`254${tail}`);
  }

  if (digits.startsWith('254') && digits.length === 12) {
    const tail = digits.slice(3);
    candidates.add(`0${tail}`);
    candidates.add(`+254${tail}`);
  }

  if (raw.startsWith('+254')) {
    const tail = raw.slice(4).replace(/\D/g, '');
    if (tail) {
      candidates.add(`0${tail}`);
      candidates.add(`254${tail}`);
    }
  }

  return [...candidates].filter(Boolean);
};

const findUserByPhone = async (phone) => {
  const candidates = getPhoneCandidates(phone);
  if (candidates.length === 0) {
    return { user: null, error: null };
  }

  const result = await withRetry(async () => (
    supabase
      .from('users')
      .select('*')
      .in('phone_number', candidates)
      .limit(1)
  ));

  if (result.error) {
    return { user: null, error: result.error };
  }

  const user = Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
  return { user, error: null };
};

/**
 * GET /api/auth/ban-check
 * Check if a user is banned (lightweight endpoint for periodic checks)
 */
router.get('/ban-check', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.json({ banned: false });

    const { user } = await findUserByPhone(phone);
    if (!user) return res.json({ banned: false });

    return res.json({ banned: !!user.is_banned });
  } catch (error) {
    return res.json({ banned: false });
  }
});

/**
 * POST /api/auth/login
 * Login user with phone and password
 */
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Phone and password are required'
      });
    }

    console.log(`\n🔐 [POST /api/auth/login] Login attempt for phone: ${phone}`);

    // Query Supabase for user by phone (supports 07..., 254..., +254... variants)
    const { user, error } = await findUserByPhone(phone);

    if (error) {
      console.error('❌ Login lookup error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Login failed',
        error: error.message,
      });
    }

    if (!user) {
      console.error(`❌ User not found: ${phone}`);
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check password
    if (user.password !== password) {
      console.error(`❌ Invalid password for user: ${phone}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Check if user is banned
    if (user.is_banned) {
      console.error(`🚫 Banned user attempted login: ${phone}`);
      return res.status(403).json({
        success: false,
        banned: true,
        message: 'Your account has been banned. Please contact support for assistance.',
        userInfo: {
          username: user.username,
          phone: user.phone_number,
          email: user.email || '',
          betnexaId: user.betnexa_id || '',
        }
      });
    }

    console.log(`✅ Login successful for ${phone}`);
    console.log(`   Balance from DB: KSH ${user.account_balance}`);
    console.log(`   Total Winnings from DB: KSH ${user.total_winnings}`);
    console.log(`   Total Bets: ${user.total_bets}`);

    // Track last login time for inactivity reminders (fire-and-forget)
    supabase.from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)
      .then(() => {})
      .catch(() => {});

    // Return user data
    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.username,
        email: user.email || '',
        phone: user.phone_number,
        password: user.password,
        username: user.username,
        verified: user.is_verified,
        level: user.role === 'admin' ? 'Admin' : 'Member',
        joinDate: new Date(user.created_at).toLocaleDateString(),
        totalBets: user.total_bets || 0,
        totalWinnings: user.total_winnings || 0,
        accountBalance: parseFloat(user.account_balance) || 0,
        stakeableBalance: parseFloat(user.stakeable_balance) || parseFloat(user.account_balance) || 0,
        withdrawableBalance: parseFloat(user.withdrawable_balance) || 0,
        withdrawalActivated: user.withdrawal_activated || false,
        withdrawalActivationDate: user.withdrawal_activation_date,
        isAdmin: user.is_admin || false,
        betnexaId: user.betnexa_id || null,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

/**
 * POST /api/auth/signup
 * Register new user
 */
router.post('/signup', async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;

    if (!username || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, phone, and password are required'
      });
    }

    // Check if user already exists (across common phone formats)
    const { user: existingUser, error: existingUserError } = await findUserByPhone(phone);

    if (existingUserError) {
      return res.status(500).json({
        success: false,
        message: 'Failed to validate phone number',
        error: existingUserError.message,
      });
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this phone number already exists'
      });
    }

    // Generate unique BETNEXA ID for this user
    let betnexaId;
    try {
      betnexaId = await generateUniqueBetnexaId();
      console.log(`🆔 Generated BETNEXA ID: ${betnexaId}`);
    } catch (idError) {
      console.warn('⚠️ Failed to generate betnexa_id, will assign later:', idError.message);
      betnexaId = null;
    }

    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([
        {
          username,
          email: email || null,
          phone_number: phone,
          password,
          account_balance: 0,
          total_bets: 0,
          total_winnings: 0,
          is_verified: false,
          is_admin: false,
          role: 'user',
          status: 'active',
          betnexa_id: betnexaId,
        },
      ])
      .select()
      .single();

    if (createError || !newUser) {
      console.error('Signup insert error:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create user',
        error: createError?.message
      });
    }

    // Send welcome SMS (fire-and-forget — never blocks the response)
    sendWelcomeSms(newUser.phone_number, newUser.username).catch(() => {});

    return res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.username,
        email: newUser.email || '',
        phone: newUser.phone_number,
        password: newUser.password,
        username: newUser.username,
        verified: false,
        level: 'Member',
        joinDate: new Date().toLocaleDateString(),
        totalBets: 0,
        totalWinnings: 0,
        accountBalance: 0,
        stakeableBalance: 0,
        withdrawableBalance: 0,
        withdrawalActivated: false,
        withdrawalActivationDate: null,
        isAdmin: false,
        betnexaId: newUser.betnexa_id || null,
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Signup failed',
      error: error.message
    });
  }
});

/**
 * GET /api/auth/profile/:phone
 * Fetch user profile by phone number
 * Used for refreshing user data after admin updates
 */
router.get('/profile/:phone', async (req, res) => {
  try {
    const { phone } = req.params;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Query Supabase for user by phone (supports 07..., 254..., +254... variants)
    const { user, error } = await findUserByPhone(phone);

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch profile',
        error: error.message
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Return formatted user data
    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.username,
        email: user.email || '',
        phone: user.phone_number,
        password: user.password,
        username: user.username,
        verified: user.is_verified,
        level: user.role === 'admin' ? 'Admin' : 'Member',
        joinDate: new Date(user.created_at).toLocaleDateString(),
        totalBets: user.total_bets || 0,
        totalWinnings: user.total_winnings || 0,
        accountBalance: parseFloat(user.account_balance) || 0,
        stakeableBalance: parseFloat(user.stakeable_balance) || parseFloat(user.account_balance) || 0,
        withdrawableBalance: parseFloat(user.withdrawable_balance) || 0,
        withdrawalActivated: user.withdrawal_activated || false,
        withdrawalActivationDate: user.withdrawal_activation_date,
        isAdmin: user.is_admin || false,
        betnexaId: user.betnexa_id || null,
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
});

/**
 * PUT /api/auth/update-profile
 * Update user profile fields (e.g., withdrawal activation)
 */
router.put('/update-profile', async (req, res) => {
  try {
    const { userId, withdrawal_activated, withdrawal_activation_date } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID required' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (typeof withdrawal_activated === 'boolean') {
      updates.withdrawal_activated = withdrawal_activated;
    }
    if (withdrawal_activation_date) {
      updates.withdrawal_activation_date = withdrawal_activation_date;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select('id, withdrawal_activated, withdrawal_activation_date')
      .single();

    if (error) {
      console.error('Update profile error:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    console.log(`✅ Profile updated for ${userId}:`, updates);
    return res.json({ success: true, user: data });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
