// crashLogic.js - Crash multiplier generation for the backend game engine.
//
// This module is responsible for ALL crash-multiplier math. gameEngine.js
// only calls getCrashMultiplier(totalBets) and uses whatever number comes
// back - it has no knowledge of divisors, sequences, or the formula itself.

/**
 * Builds the divisor sequence used to pick a crash multiplier:
 *   - Start at 10, step by 20, up to 320.
 *   - From 320, step by 300, up to 500000.
 *
 * e.g. 10, 30, 50, 70, ..., 290, 310, 320, 620, 920, 1220, ..., 500000
 */
function generateDivisorSequence() {
    const divisors = [];

    const FIRST_STAGE_STEP = 20;
    const FIRST_STAGE_CAP = 320;

    const SECOND_STAGE_STEP = 300;
    const SECOND_STAGE_MAX = 500000;

    // Stage 1: 10 -> 320, step 20
    let value = 10;
    while (value <= FIRST_STAGE_CAP) {
        divisors.push(value);
        value += FIRST_STAGE_STEP;
    }

    // The step-20 stage doesn't land exactly on 320 (...290, 310, 330),
    // so make sure 320 itself is present before stage 2 begins.
    if (divisors[divisors.length - 1] !== FIRST_STAGE_CAP) {
        divisors.push(FIRST_STAGE_CAP);
    }

    // Stage 2: 320 -> 500000, step 300
    value = FIRST_STAGE_CAP + SECOND_STAGE_STEP;
    while (value <= SECOND_STAGE_MAX) {
        divisors.push(value);
        value += SECOND_STAGE_STEP;
    }

    return divisors;
}

/**
 * Picks the largest divisor that is <= totalBets.
 * Never returns a divisor greater than totalBets.
 */
function selectDivisor(divisors, totalBets) {
    let selected = divisors[0];

    for (const divisor of divisors) {
        if (divisor <= totalBets) {
            selected = divisor;
        } else {
            break;
        }
    }

    return selected;
}

/**
 * When no bets were placed at all (total_bets === 0), the divisor-based
 * formula would divide 0 by a divisor and always produce 0x. Instead, in
 * that specific case only, we return a random multiplier in [1.00, 14.55].
 */
const NO_BETS_MIN_MULTIPLIER = 1.00;
const NO_BETS_MAX_MULTIPLIER = 14.55;

function generateNoBetsMultiplier() {
    const random = NO_BETS_MIN_MULTIPLIER +
        Math.random() * (NO_BETS_MAX_MULTIPLIER - NO_BETS_MIN_MULTIPLIER);

    return Number(random.toFixed(2));
}

/**
 * Given the current round's total_bets, returns the crash multiplier:
 *   crashMultiplier = total_bets / selectedDivisor
 *
 * The minimum bet is ₦10, so total_bets will never be lower than that
 * for a round with at least one bet, meaning the smallest divisor (10)
 * is always a valid, safe fallback in that case.
 *
 * Special case: if no bets were placed at all (total_bets === 0), the
 * divisor sequence is skipped entirely and a random multiplier between
 * 1.00x and 14.55x is returned instead.
 */
function getCrashMultiplier(totalBets) {
    if (totalBets === 0) {
        return generateNoBetsMultiplier();
    }

    const divisors = generateDivisorSequence();
    const selectedDivisor = selectDivisor(divisors, totalBets);

    const crashMultiplier = totalBets / selectedDivisor;

    return Number(crashMultiplier.toFixed(2));
}

module.exports = {
    generateDivisorSequence,
    selectDivisor,
    generateNoBetsMultiplier,
    getCrashMultiplier,
};