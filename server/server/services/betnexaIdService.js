/**
 * BETNEXA ID Generator
 * Generates unique user IDs in format XNNN
 * X = consonant letter (B,C,D,F,G,H,J,K,L,M,N,P,Q,R,S,T,V,W,X,Y,Z)
 * N = digit from 2-9 (excludes 0 and 1)
 */

const supabase = require('./database.js');

// Consonants only (no vowels A, E, I, O, U)
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
// Digits 2-9 (no 0 or 1)
const DIGITS = '23456789';

/**
 * Generate a random BETNEXA ID in format XNNN
 */
function generateRandomBetnexaId() {
  const letter = CONSONANTS[Math.floor(Math.random() * CONSONANTS.length)];
  const d1 = DIGITS[Math.floor(Math.random() * DIGITS.length)];
  const d2 = DIGITS[Math.floor(Math.random() * DIGITS.length)];
  const d3 = DIGITS[Math.floor(Math.random() * DIGITS.length)];
  return `${letter}${d1}${d2}${d3}`;
}

/**
 * Generate a unique BETNEXA ID that doesn't already exist in the database.
 * Retries up to maxAttempts times to find a unique one.
 */
async function generateUniqueBetnexaId(maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateRandomBetnexaId();

    // Check if this ID already exists (case-insensitive)
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .ilike('betnexa_id', candidate)
      .limit(1);

    if (error) {
      console.warn(`⚠️ Error checking betnexa_id uniqueness (attempt ${attempt + 1}):`, error.message);
      continue;
    }

    if (!data || data.length === 0) {
      return candidate; // Unique!
    }

    console.log(`⚠️ BETNEXA ID ${candidate} already taken, retrying...`);
  }

  // Fallback: extend to 5 chars (XNNNN) if all 4-char combos seem busy
  const letter = CONSONANTS[Math.floor(Math.random() * CONSONANTS.length)];
  const digits = Array.from({ length: 4 }, () => DIGITS[Math.floor(Math.random() * DIGITS.length)]).join('');
  return `${letter}${digits}`;
}

/**
 * Find a user by their BETNEXA ID (case-insensitive).
 * Returns the user row or null.
 */
async function findUserByBetnexaId(betnexaId) {
  if (!betnexaId || typeof betnexaId !== 'string') return null;

  const normalized = betnexaId.trim().toUpperCase();
  if (!/^[A-Z]\d{3,5}$/.test(normalized)) return null;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('betnexa_id', normalized)
    .limit(1);

  if (error) {
    console.error('Error finding user by betnexa_id:', error.message);
    return null;
  }

  return (data && data.length > 0) ? data[0] : null;
}

/**
 * Assign BETNEXA IDs to all existing users who don't have one.
 * Call this once after adding the column.
 */
async function backfillBetnexaIds() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id')
    .or('betnexa_id.is.null');

  if (error) {
    console.error('Error fetching users without betnexa_id:', error.message);
    return { success: false, error: error.message };
  }

  if (!users || users.length === 0) {
    console.log('✅ All users already have BETNEXA IDs');
    return { success: true, updated: 0 };
  }

  let updated = 0;
  for (const user of users) {
    try {
      const newId = await generateUniqueBetnexaId();
      const { error: updateError } = await supabase
        .from('users')
        .update({ betnexa_id: newId })
        .eq('id', user.id);

      if (updateError) {
        console.warn(`⚠️ Failed to assign betnexa_id to user ${user.id}:`, updateError.message);
      } else {
        updated++;
      }
    } catch (err) {
      console.warn(`⚠️ Error assigning betnexa_id to user ${user.id}:`, err.message);
    }
  }

  console.log(`✅ Backfilled ${updated} BETNEXA IDs out of ${users.length} users`);
  return { success: true, updated, total: users.length };
}

module.exports = {
  generateRandomBetnexaId,
  generateUniqueBetnexaId,
  findUserByBetnexaId,
  backfillBetnexaIds,
};
