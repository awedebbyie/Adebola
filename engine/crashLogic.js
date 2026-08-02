/**
 * Crash Logic — 3-Tier Weighted Multiplier Generator (Provably Fair)
 * --------------------------------------------------------------------
 * Same tier logic/probabilities as before, but the randomness source
 * is now a provably-fair HMAC-SHA256 stream instead of Math.random(),
 * so every result is deterministic, reproducible, and verifiable by
 * players after the fact.
 *
 * Tier A (91%): crash point in [1.00x, 4.07x]
 *               — skewed so most outcomes land in [1.00x, 3.08x],
 *                 with 4.07x as the hard ceiling for this tier.
 * Tier B (5%):  crash point normally in (4.07x, 10.09x]
 *               — BUT ~5% of the time (when it's Tier B's turn), it
 *                 crashes early, before reaching 4.07x, dipping into
 *                 Tier A's range instead.
 * Tier C (4%):  crash point in (10.09x, 20.09x]
 *               — the true ceiling (20.09x) is only actually reached
 *                 ~10% of the time it's Tier C's turn. The other 90%
 *                 it crashes somewhere below the ceiling (up to 20.08x)
 *                 so the absolute max isn't reliably predictable/exploitable.
 *
 * ---- Provably fair flow ------------------------------------------------
 * 1. BEFORE the round: server calls generateServerSeed(), hashes it with
 *    hashServerSeed(), and shows players ONLY the hash. This commits to
 *    the result without revealing it.
 * 2. Player supplies (or is assigned) a clientSeed, and a nonce tracks
 *    round number so seed pairs don't repeat.
 * 3. Round resolves via generateCrashPoint(serverSeed, clientSeed, nonce)
 *    — deterministic given the three inputs.
 * 4. AFTER the round: server reveals serverSeed. Players run
 *    verifyCrashPoint() themselves to confirm the hash matches and the
 *    crash point recomputes identically — proving nothing was changed
 *    after bets were placed.
 */

const crypto = require('crypto');

// ---- Tier boundaries -------------------------------------------------
const TIER_A_MIN = 1.00;
const TIER_A_SOFT_MAX = 3.08;   // "most times" ceiling inside Tier A
const TIER_A_MAX = 4.07;        // hard ceiling for Tier A
const TIER_B_MAX = 10.09;       // hard ceiling for Tier B
const TIER_C_SUBMAX = 20.08;    // Tier C ceiling when NOT reaching the true max
const TIER_C_MAX = 20.09;       // absolute hard ceiling (forced crash), rarely reached

// ---- Tier probabilities ----------------------------------------------
const P_TIER_A = 0.91;
const P_TIER_B = 0.05;
const P_TIER_C = 0.04; // remainder

// Within Tier A, fraction of outcomes that stay inside the "most times"
// sub-band (1.00x–3.08x) vs. spill into the 3.08x–4.07x tail.
const TIER_A_INNER_SHARE = 0.85;

// When it's Tier B's turn, chance it crashes early (before 4.07x)
// instead of following its normal 4.07x–10.09x range.
const TIER_B_EARLY_CRASH_PROB = 0.05;

// When it's Tier C's turn, chance it actually reaches the true ceiling
// (20.09x). Kept low & hidden so the max isn't a reliably exploitable
// known value — most Tier C rounds crash below it (up to 20.08x).
const TIER_C_REACH_MAX_PROB = 0.10;

// Skew exponent (>1 biases toward the low end of a range, mimicking
// typical crash-game behavior where small multipliers are far more
// common than large ones).
const SKEW = 2.5;

// ---- Provably fair RNG --------------------------------------------------

/**
 * Generates a fresh cryptographically random server seed.
 * Call this once per round, BEFORE accepting bets.
 */
function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hashes a server seed so it can be shown to players before the round
 * resolves, without revealing the seed itself.
 */
function hashServerSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * Creates a deterministic float stream in [0, 1) derived from
 * (serverSeed, clientSeed, nonce). Each call to next() advances an
 * internal cursor so a single round can draw multiple independent-looking
 * values, all reproducible by anyone who has the three inputs.
 */
function createRng(serverSeed, clientSeed, nonce) {
  let cursor = 0;
  return function next() {
    const hmac = crypto
      .createHmac('sha256', serverSeed)
      .update(`${clientSeed}:${nonce}:${cursor}`)
      .digest('hex');
    cursor++;
    // first 8 hex chars = 32 bits of entropy -> float in [0, 1)
    const intVal = parseInt(hmac.slice(0, 8), 16);
    return intVal / 0x100000000;
  };
}

function skewedRandom(min, max, rng, skew = SKEW) {
  const r = Math.pow(rng(), skew);
  return min + r * (max - min);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Generates a single crash point, along with which tier/sub-case
 * produced it, deterministically from the provably-fair inputs.
 * @returns {{value: number, tier: string}}
 */
function generateCrashPointDetailed(serverSeed, clientSeed, nonce) {
  const rng = createRng(serverSeed, clientSeed, nonce);
  const roll = rng();

  if (roll < P_TIER_A) {
    // Tier A: 1.00x – 4.07x
    const inner = rng() < TIER_A_INNER_SHARE;
    const value = inner
      ? skewedRandom(TIER_A_MIN, TIER_A_SOFT_MAX, rng)
      : skewedRandom(TIER_A_SOFT_MAX, TIER_A_MAX, rng);
    return { value: round2(Math.min(value, TIER_A_MAX)), tier: 'A' };
  }

  if (roll < P_TIER_A + P_TIER_B) {
    // Tier B: normally 4.07x–10.09x, but sometimes crashes early
    if (rng() < TIER_B_EARLY_CRASH_PROB) {
      const value = skewedRandom(TIER_A_MIN, TIER_A_MAX, rng);
      return { value: round2(Math.min(value, TIER_A_MAX)), tier: 'B-early' };
    }
    const value = TIER_A_MAX + rng() * (TIER_B_MAX - TIER_A_MAX);
    return { value: round2(Math.min(value, TIER_B_MAX)), tier: 'B' };
  }

  // Tier C: 10.09x–20.09x, but the true ceiling is rarely reached
  if (rng() < TIER_C_REACH_MAX_PROB) {
    return { value: TIER_C_MAX, tier: 'C-max' };
  }
  const value = TIER_B_MAX + rng() * (TIER_C_SUBMAX - TIER_B_MAX);
  return { value: round2(Math.min(value, TIER_C_SUBMAX)), tier: 'C' };
}

/**
 * Generates a single crash point according to the tiered distribution.
 * Deterministic given (serverSeed, clientSeed, nonce).
 * @returns {number} crash multiplier, rounded to 2 decimals
 */
function generateCrashPoint(serverSeed, clientSeed, nonce) {
  return generateCrashPointDetailed(serverSeed, clientSeed, nonce).value;
}

/**
 * Player-facing verification: given the revealed serverSeed and the
 * hash that was shown BEFORE the round, confirms the commitment wasn't
 * tampered with, and recomputes the crash point independently.
 * @returns {{validHash: boolean, value: number, tier: string}}
 */
function verifyCrashPoint(serverSeed, expectedHash, clientSeed, nonce) {
  const validHash = hashServerSeed(serverSeed) === expectedHash;
  const { value, tier } = generateCrashPointDetailed(serverSeed, clientSeed, nonce);
  return { validHash, value, tier };
}

/**
 * Drop-in replacement for the old getCrashMultiplier(totalBets) function
 * used by gameEngine.js. Returns a plain number, matching what the
 * engine expects (it does `crashPoint + "x"` and `multiplier < crashPoint`
 * directly on the return value).
 *
 * IMPORTANT: `totalBets` is accepted only so existing call sites
 * (`crashLogic.getCrashMultiplier(totalBets)`) don't need to change —
 * it is intentionally NEVER used to influence the result. Sizing the
 * crash point based on how much money is riding on the round is
 * exactly what made the previous version rigged (crash early when
 * bets are high = guaranteed house edge beyond the intended odds).
 * The result here is fully determined by the provably-fair seed chain.
 *
 * NOTE: this generates a fresh server seed internally and does not
 * expose the hash before betting closes, so it is NOT YET a complete
 * provably-fair setup end-to-end (see the note below the function).
 * @returns {number} crash multiplier
 */
function getCrashMultiplier(totalBets) {
  const serverSeed = generateServerSeed();
  const clientSeed = 'house';
  const nonce = Date.now();
  const { value } = generateCrashPointDetailed(serverSeed, clientSeed, nonce);
  return value;
}

module.exports = {
  generateServerSeed,
  hashServerSeed,
  generateCrashPoint,
  generateCrashPointDetailed,
  verifyCrashPoint,
  getCrashMultiplier,
};

// ---- Demo + self-test / distribution check -----------------------------
if (require.main === module) {
  // --- Demo of one full provably-fair round lifecycle ---
  const demoServerSeed = generateServerSeed();
  const demoHash = hashServerSeed(demoServerSeed);
  const demoClientSeed = 'player-supplied-seed';
  const demoNonce = 1;

  console.log('--- Provably fair round demo ---');
  console.log(`1. Server commits, shows hash BEFORE round: ${demoHash}`);
  const demoResult = generateCrashPoint(demoServerSeed, demoClientSeed, demoNonce);
  console.log(`2. Round resolves. Crash point: ${demoResult}x`);
  console.log(`3. Server reveals serverSeed: ${demoServerSeed}`);
  const verification = verifyCrashPoint(demoServerSeed, demoHash, demoClientSeed, demoNonce);
  console.log(`4. Player verifies -> hash matches: ${verification.validHash}, recomputed: ${verification.value}x (tier ${verification.tier})`);
  console.log('');

  // --- Distribution check over many independent rounds ---
  const N = 200000;
  const counts = { A: 0, 'B-early': 0, B: 0, C: 0, 'C-max': 0 };
  let maxA = 0, maxBEarly = 0, maxB = 0, maxC = 0;

  for (let i = 0; i < N; i++) {
    const seed = generateServerSeed(); // fresh randomness per test round only
    const { value, tier } = generateCrashPointDetailed(seed, 'test-client', i);
    counts[tier]++;
    if (tier === 'A') maxA = Math.max(maxA, value);
    if (tier === 'B-early') maxBEarly = Math.max(maxBEarly, value);
    if (tier === 'B') maxB = Math.max(maxB, value);
    if (tier === 'C') maxC = Math.max(maxC, value);
  }

  const tierBTotal = counts['B-early'] + counts['B'];
  const tierCTotal = counts['C'] + counts['C-max'];

  console.log(`--- Distribution check (${N} rounds) ---`);
  console.log(`Tier A: ${(counts.A / N * 100).toFixed(2)}% | max observed: ${maxA}`);
  console.log(`Tier B total: ${(tierBTotal / N * 100).toFixed(2)}%`);
  console.log(`  - B early crash (<4.07x): ${(counts['B-early'] / tierBTotal * 100).toFixed(2)}% of Tier B turns | max observed: ${maxBEarly}`);
  console.log(`  - B normal (4.07x-10.09x): ${(counts['B'] / tierBTotal * 100).toFixed(2)}% of Tier B turns | max observed: ${maxB}`);
  console.log(`Tier C total: ${(tierCTotal / N * 100).toFixed(2)}%`);
  console.log(`  - C reaches true max (20.09x): ${(counts['C-max'] / tierCTotal * 100).toFixed(2)}% of Tier C turns`);
  console.log(`  - C below ceiling (<=20.08x): ${(counts['C'] / tierCTotal * 100).toFixed(2)}% of Tier C turns | max observed: ${maxC}`);
}