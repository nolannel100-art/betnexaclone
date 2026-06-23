/**
 * Bets Routes
 * Handles bet placement, retrieval, and settlement
 */

const express = require('express');
const router = express.Router();
const supabase = require('../services/database.js');
const { sendBetPlacedSms, sendBetWonSms } = require('../services/smsService.js');

const chunkArray = (arr, size) => {
  if (!Array.isArray(arr) || size <= 0) return [];
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

const fetchUsersByIds = async (userIds) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, username, phone_number, account_balance')
    .in('id', ids);

  if (error || !Array.isArray(data)) {
    return new Map();
  }

  return new Map(data.map((u) => [u.id, u]));
};

/**
 * POST /api/bets/place
 * Place a new bet and deduct from user balance
 */
router.post('/place', async (req, res) => {
  try {
    const { userId, phoneNumber, stake, potentialWin, totalOdds, selections } = req.body;

    console.log('\n🎲 [POST /api/bets/place] Placing bet');
    console.log('   User:', { userId, phoneNumber });
    console.log('   Stake:', stake);
    console.log('   Selections:', selections?.length || 0);

    if ((!phoneNumber && !userId) || !stake || !selections) {
      return res.status(400).json({
        success: false,
        error: 'User identifier, stake, and selections are required'
      });
    }

    // Get user from database (prefer userId, fallback to phone)
    let user = null;
    let userError = null;

    if (userId) {
      const byIdResult = await supabase
        .from('users')
        .select('id, account_balance, stakeable_balance, withdrawable_balance, total_bets, phone_number')
        .eq('id', userId)
        .maybeSingle();
      user = byIdResult.data;
      userError = byIdResult.error;
    }

    if (!user && phoneNumber) {
      const byPhoneResult = await supabase
        .from('users')
        .select('id, account_balance, stakeable_balance, withdrawable_balance, total_bets, phone_number')
        .eq('phone_number', phoneNumber)
        .maybeSingle();
      user = byPhoneResult.data;
      userError = byPhoneResult.error;
    }

    if (userError) {
      console.error('❌ Error looking up user for bet placement:', userError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch user',
        details: userError.message
      });
    }

    if (!user) {
      console.error('❌ User not found:', { userId, phoneNumber });
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    // CHECK STAKEABLE BALANCE (deposits/betting funds only, NOT winnings)
    const stakeableBalance = parseFloat(user.stakeable_balance || 0);
    if (stakeableBalance < stake) {
      console.warn('⚠️ Insufficient stakeable balance for user:', phoneNumber || userId);
      console.warn(`   Stakeable: KSH ${stakeableBalance}, Stake required: KSH ${stake}`);
      console.warn(`   Withdrawable (winnings): KSH ${user.withdrawable_balance || 0} [Cannot be used for betting]`);
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance for betting',
        stakeableBalance: stakeableBalance,
        withdrawableBalance: user.withdrawable_balance || 0,
        required: stake,
        message: 'Winnings cannot be used for betting - only deposits (stakeable balance) can be staked'
      });
    }

    // DEDUCT STAKE FROM STAKEABLE BALANCE ONLY
    const newStakeable = stakeableBalance - parseFloat(stake);
    // Non-stakeable = total balance minus stakeable (includes winnings from any column)
    const nonStakeableBalance = Math.max(0, parseFloat(user.account_balance || 0) - stakeableBalance);
    const newAccountBalance = newStakeable + nonStakeableBalance; // Total for display

    console.log(`🎮 Bet placed - Deducting stake from stakeable balance`);
    console.log(`   Stakeable: KSH ${stakeableBalance} → KSH ${newStakeable}`);
    console.log(`   Non-stakeable (unchanged): KSH ${nonStakeableBalance}`);
    console.log(`   Total: KSH ${newAccountBalance}`);

    const { error: updateError } = await supabase
      .from('users')
      .update({
        stakeable_balance: newStakeable,
        account_balance: newAccountBalance,
        total_bets: (user.total_bets || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ Error updating account balance:', updateError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to update balance',
        details: updateError.message
      });
    }

    // Create bet record
    const betId = `BET${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const now = new Date();
    const isoTimestamp = now.toISOString(); // Store as ISO for proper timezone conversion

    const { data: bet, error: betError } = await supabase
      .from('bets')
      .insert([{
        bet_id: betId,
        user_id: user.id,
        stake: parseFloat(stake),
        potential_win: parseFloat(potentialWin),
        total_odds: parseFloat(totalOdds),
        status: 'Open',
        bet_date: `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`,
        bet_time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
        created_at: isoTimestamp
      }])
      .select()
      .single();

    if (betError) {
      console.error('❌ Error creating bet:', betError.message);
      // Restore balance if bet creation fails
      await supabase
        .from('users')
        .update({ account_balance: user.account_balance })
        .eq('id', user.id);

      return res.status(500).json({
        success: false,
        error: 'Failed to create bet',
        details: betError.message
      });
    }

    // Create bet selections
    for (const selection of selections) {
      // Parse home and away teams from match string (format: "Home vs Away")
      const [homeTeam, awayTeam] = selection.match.split(' vs ').map(t => t.trim());
      
      // Get game UUID from game_id (matchId)
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('id')
        .eq('game_id', selection.matchId)
        .single();

      if (gameError || !game) {
        console.warn('⚠️ Game not found for matchId:', selection.matchId);
        continue;
      }

      await supabase
        .from('bet_selections')
        .insert([{
          bet_id: bet.id,
          game_id: game.id,
          market_key: selection.type,
          market_type: selection.market,
          market_label: selection.type,
          home_team: homeTeam || 'N/A',
          away_team: awayTeam || 'N/A',
          odds: parseFloat(selection.odds),
          outcome: 'pending'
        }]);
    }

    console.log('✅ Bet placed successfully:', betId);
    console.log('   Database ID (UUID):', bet.id);
    console.log('   Account Balance After: KSH', newAccountBalance);

    // Send bet placed SMS (fire-and-forget)
    const smsPhone = phoneNumber || user.phone_number;
    if (smsPhone) {
      sendBetPlacedSms(smsPhone, betId, stake, potentialWin, newAccountBalance).catch(() => {});
    }

    res.json({
      success: true,
      bet: {
        id: bet.id,
        betId: betId,
        stake: parseFloat(stake),
        potentialWin: parseFloat(potentialWin),
        totalOdds: parseFloat(totalOdds),
        status: 'Open'
      },
      stakeableBalance: newStakeable,
      withdrawableBalance: nonStakeableBalance,
      newBalance: newAccountBalance
    });
  } catch (error) {
    console.error('❌ Place bet error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to place bet',
      details: error.message
    });
  }
});

/**
 * GET /api/bets/user
 * Get all bets for a user
 */
router.get('/user', async (req, res) => {
  try {
    const { phoneNumber } = req.query;

    console.log('\n📋 [GET /api/bets/user] Fetching bets for:', phoneNumber);

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('phone_number', phoneNumber)
      .single();

    if (userError || !user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user bets with selections
    const { data: bets, error: betsError } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (betsError) {
      console.error('❌ Error fetching bets:', betsError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch bets'
      });
    }

    // Get selections for each bet with game details
    const betsWithSelections = await Promise.all(
      (bets || []).map(async (bet) => {
        const { data: selections } = await supabase
          .from('bet_selections')
          .select('*, games:game_id(game_id)')
          .eq('bet_id', bet.id);

        return {
          ...bet,
          selections: (selections || []).map((sel) => ({
            ...sel,
            gameRefId: sel.games?.game_id // Add the text reference ID
          }))
        };
      })
    );

    console.log(`✅ Retrieved ${betsWithSelections.length} bets`);

    res.json({
      success: true,
      bets: betsWithSelections
    });
  } catch (error) {
    console.error('❌ Get bets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bets'
    });
  }
});

/**
 * PUT /api/bets/:betId/status
 * Update bet status (Open, Won, Lost, Void)
 */
router.put('/:betId/status', async (req, res) => {
  try {
    const { betId } = req.params;
    const { status, amountWon } = req.body;
    const parsedAmountWon = parseFloat(amountWon);

    console.log('\n⚙️  [PUT /api/bets/:betId/status] Updating bet status');
    console.log('   Bet ID (UUID):', betId);
    console.log('   Status:', status);
    console.log('   Amount Won:', amountWon);

    // Fetch existing bet first so payout logic can be idempotent
    const { data: existingBet, error: existingBetError } = await supabase
      .from('bets')
      .select('id, bet_id, user_id, status, potential_win')
      .eq('id', betId)
      .single();

    if (existingBetError || !existingBet) {
      console.error('❌ Bet not found:', existingBetError?.message);
      return res.status(404).json({
        success: false,
        error: 'Bet not found'
      });
    }

    // Duplicate "Won" updates should never pay out again
    if (status === 'Won' && existingBet.status === 'Won') {
      console.log('ℹ️ Duplicate Won status ignored - payout already processed');
      return res.json({
        success: true,
        bet: existingBet,
        updatedUser: null,
        message: 'Bet already marked as Won. Payout already processed.'
      });
    }

    // Strict guard: a bet can only be marked as Won after all selected games are finished
    if (status === 'Won') {
      const { data: selections, error: selectionsError } = await supabase
        .from('bet_selections')
        .select('id, outcome, games:game_id(status)')
        .eq('bet_id', betId);

      if (selectionsError) {
        console.error('❌ Error validating selections before winning bet:', selectionsError.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to validate bet selections',
          details: selectionsError.message
        });
      }

      if (!selections || selections.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot mark bet as Won without selections'
        });
      }

      const hasUnfinishedGames = selections.some((sel) => (sel.games?.status || '').toLowerCase() !== 'finished');
      const hasNonWonSelections = selections.some((sel) => (sel.outcome || '').toLowerCase() !== 'won');

      if (hasUnfinishedGames || hasNonWonSelections) {
        return res.status(400).json({
          success: false,
          error: 'Bet cannot be marked as Won until all selected games are finished and all outcomes are won'
        });
      }
    }

    // Build update object with status
    const updateData = {
      status: status,
      settled_at: status === 'Won' || status === 'Lost' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    };

    // Add amount_won to bet record if bet is won
    if (status === 'Won' && Number.isFinite(parsedAmountWon) && parsedAmountWon > 0) {
      updateData.amount_won = parsedAmountWon;
    }

    console.log('   📋 Updating bet with:', updateData);

    // Update bet status (schema-compatible retry if amount_won column is unavailable)
    let updateQuery = supabase
      .from('bets')
      .update(updateData)
      .eq('id', betId);

    // Atomic guard: only one request can transition a bet into Won
    if (status === 'Won') {
      updateQuery = updateQuery.neq('status', 'Won');
    }

    let { data: bet, error: updateError } = await updateQuery.select().single();

    if (updateError && updateData.amount_won !== undefined && `${updateError.message || ''}`.includes('amount_won')) {
      console.warn('⚠️ bets.amount_won column not found, retrying bet update without amount_won');
      const fallbackUpdateData = { ...updateData };
      delete fallbackUpdateData.amount_won;

      let fallbackQuery = supabase
        .from('bets')
        .update(fallbackUpdateData)
        .eq('id', betId);

      if (status === 'Won') {
        fallbackQuery = fallbackQuery.neq('status', 'Won');
      }

      const retryResult = await fallbackQuery.select().single();

      bet = retryResult.data;
      updateError = retryResult.error;
    }

    if (status === 'Won' && !bet && updateError && `${updateError.code || ''}` === 'PGRST116') {
      console.log('ℹ️ Bet already won by another request; skipping duplicate payout');
      const { data: latestBet } = await supabase
        .from('bets')
        .select('id, user_id, status, potential_win')
        .eq('id', betId)
        .single();

      return res.json({
        success: true,
        bet: latestBet,
        updatedUser: null,
        message: 'Bet already marked as Won. Payout already processed.'
      });
    }

    if (updateError || !bet) {
      console.error('❌ Error updating bet:', updateError?.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to update bet'
      });
    }

    console.log('✅ Bet status updated to:', status);
    console.log('   Updated bet:', bet);
    
    if (status === 'Won') {
      console.log('✅ Amount won recorded:', amountWon);
    }

    // If bet won, add winnings to both winnings_balance and main account_balance
    let updatedUser = null;
    let wonSmsPhone = null;
    const payoutAmount = Number.isFinite(parsedAmountWon) && parsedAmountWon > 0
      ? parsedAmountWon
      : parseFloat(existingBet.potential_win || 0);

    if (status === 'Won' && payoutAmount > 0 && bet.user_id) {
      console.log(`\n💰 Processing winnings for user ID: ${bet.user_id}`);
      
      let { data: user, error: userError } = await supabase
        .from('users')
        .select('winnings_balance, total_winnings, account_balance, id, phone_number, username')
        .eq('id', bet.user_id)
        .single();

      if (userError && `${userError.message || ''}`.includes('winnings_balance')) {
        const fallbackUserResult = await supabase
          .from('users')
          .select('total_winnings, account_balance, id, phone_number, username')
          .eq('id', bet.user_id)
          .single();
        user = fallbackUserResult.data;
        userError = fallbackUserResult.error;
      }

      if (!user) {
        console.error('❌ Error fetching user:', userError?.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch user',
          details: userError?.message
        });
      }

      console.log(`   Current winnings balance: KSH ${user.winnings_balance || 0}`);
      console.log(`   Current total winnings: KSH ${user.total_winnings || 0}`);
      
      const currentWinningsBalance = parseFloat(user.winnings_balance ?? user.total_winnings ?? 0) || 0;
      const newWinningsBalance = currentWinningsBalance + payoutAmount;
      const currentWinnings = user.total_winnings || 0;
      const newWinnings = currentWinnings + payoutAmount;
      const currentMainBalance = parseFloat(user.account_balance || 0);
      const newMainBalance = currentMainBalance + payoutAmount;

      console.log(`   New winnings balance will be: KSH ${newWinningsBalance}`);
      console.log(`   New total winnings will be: KSH ${newWinnings}`);
      console.log(`   New main account balance will be: KSH ${newMainBalance}`);
      console.log('   📝 Updating user in database...');

      const userBalanceUpdate = {
        account_balance: newMainBalance,
        winnings_balance: newWinningsBalance,
        total_winnings: newWinnings,
        updated_at: new Date().toISOString()
      };

      let updateQuery = supabase
        .from('users')
        .update(userBalanceUpdate)
        .eq('id', bet.user_id)
        .select()
        .single();

      let { data: updatedUserData, error: balanceError } = await updateQuery;

      if (balanceError && `${balanceError.message || ''}`.includes('winnings_balance')) {
        const fallbackUpdate = { ...userBalanceUpdate };
        delete fallbackUpdate.winnings_balance;
        const fallbackResult = await supabase
          .from('users')
          .update(fallbackUpdate)
          .eq('id', bet.user_id)
          .select()
          .single();
        updatedUserData = fallbackResult.data;
        balanceError = fallbackResult.error;
      }

      if (balanceError) {
        console.error('❌ Error updating winnings balance:', balanceError.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to update user balance',
          details: balanceError.message
        });
      }

      updatedUser = updatedUserData;
      wonSmsPhone = updatedUser.phone_number || null;
      console.log(`✅ User winnings updated successfully`);
      console.log(`   Phone: ${updatedUser.phone_number}`);
      console.log(`   New account balance: KSH ${updatedUser.account_balance}`);
      console.log(`   New winnings balance: KSH ${updatedUser.winnings_balance}`);
      console.log(`   New total winnings: KSH ${updatedUser.total_winnings}`);
    }

    // Always attempt won SMS when bet is won, even if payout amount was zero/empty.
    if (status === 'Won' && bet.user_id) {
      if (!wonSmsPhone) {
        const { data: userForSms } = await supabase
          .from('users')
          .select('phone_number')
          .eq('id', bet.user_id)
          .maybeSingle();
        wonSmsPhone = userForSms?.phone_number || null;
      }

      if (!wonSmsPhone) {
        const { data: txWithPhone } = await supabase
          .from('transactions')
          .select('phone_number')
          .eq('user_id', bet.user_id)
          .not('phone_number', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        wonSmsPhone = txWithPhone?.phone_number || null;
      }

      if (wonSmsPhone) {
        const betRef = existingBet?.bet_id || betId;
        const amountForSms = Number.isFinite(payoutAmount) ? payoutAmount : 0;
        const sent = await sendBetWonSms(wonSmsPhone, betRef, amountForSms);
        if (!sent) {
          console.warn(`⚠️ Won SMS not sent for bet ${betRef} (${wonSmsPhone})`);
        }
      } else {
        console.warn(`⚠️ Won SMS skipped: no phone number for user ${bet.user_id}`);
      }
    }

    // If bet lost, no winnings to add
    if (status === 'Lost') {
      console.log('❌ Bet marked as Lost - no winnings added');
    }

    console.log('\n✅ Response sent successfully');

    res.json({
      success: true,
      bet,
      updatedUser,
      message: `Bet ${status} updated${status === 'Won' && updatedUser ? ` with KSH ${payoutAmount} added to winnings and main account balance` : ''}`
    });
  } catch (error) {
    console.error('❌ Update bet status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update bet status',
      details: error.message
    });
  }
});

/**
 * GET /api/bets/admin/all
 * Get all bets (admin only)
 */
router.get('/admin/all', async (req, res) => {
  try {
    console.log('\n👨‍💼 [GET /api/bets/admin/all] Fetching all bets with user data');
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 2000) : 500;

    const joinedResult = await supabase
      .from('bets')
      .select(`
        *,
        users:user_id (
          id,
          username,
          phone_number,
          account_balance
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    let bets = joinedResult.data;

    if (joinedResult.error) {
      console.warn('⚠️ Joined bets query failed, using fallback query:', joinedResult.error.message);

      const plainResult = await supabase
        .from('bets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (plainResult.error) {
        console.error('❌ Error fetching bets:', plainResult.error.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch bets'
        });
      }

      const usersById = await fetchUsersByIds((plainResult.data || []).map((b) => b.user_id));
      bets = (plainResult.data || []).map((bet) => ({
        ...bet,
        users: usersById.get(bet.user_id) || null,
      }));
    }

    const betRows = bets || [];
    const betIds = betRows.map((bet) => bet.id).filter(Boolean);
    const selectionsByBetId = new Map();

    if (betIds.length > 0) {
      const idChunks = chunkArray(betIds, 150);
      for (const ids of idChunks) {
        const { data: chunkSelections, error: chunkError } = await supabase
          .from('bet_selections')
          .select('*')
          .in('bet_id', ids)
          .order('created_at', { ascending: true });

        if (chunkError) {
          console.warn('⚠️ Error fetching bet selections chunk:', chunkError.message);
          continue;
        }

        for (const selection of chunkSelections || []) {
          const list = selectionsByBetId.get(selection.bet_id) || [];
          list.push(selection);
          selectionsByBetId.set(selection.bet_id, list);
        }
      }
    }

    const betsWithSelections = betRows.map((bet) => ({
      ...bet,
      status: bet.status,
      bet_selections: selectionsByBetId.get(bet.id) || []
    }));

    console.log(`✅ Retrieved ${betsWithSelections.length} bets with user data`);

    res.json({
      success: true,
      bets: betsWithSelections
    });
  } catch (error) {
    console.error('❌ Get all bets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bets'
    });
  }
});

module.exports = router;
