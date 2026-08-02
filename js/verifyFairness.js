// verifyFairness.js - Browser-side, provably-fair verification.
//
// Mirrors engine/crashLogic.js EXACTLY (same tier constants, same rng()
// call order per branch) but built on the Web Crypto API (crypto.subtle)
// instead of Node's crypto module, since this runs in the player's
// browser. This file only VERIFIES rounds after the fact - it never
// generates the live game's actual results. That only ever happens
// server-side in engine/gameEngine.js, before betting even opens.

(function () {
    const TIER_A_MIN = 1.00;
    const TIER_A_SOFT_MAX = 3.08;
    const TIER_A_MAX = 4.07;
    const TIER_B_MAX = 10.09;
    const TIER_C_SUBMAX = 20.08;
    const TIER_C_MAX = 20.09;

    const P_TIER_A = 0.91;
    const P_TIER_B = 0.05;

    const TIER_A_INNER_SHARE = 0.85;
    const TIER_B_EARLY_CRASH_PROB = 0.05;
    const TIER_C_REACH_MAX_PROB = 0.10;

    const SKEW = 2.5;

    function bufToHex(buf) {
        return Array.from(new Uint8Array(buf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    async function sha256Hex(message) {
        const data = new TextEncoder().encode(message);
        const digest = await crypto.subtle.digest("SHA-256", data);
        return bufToHex(digest);
    }

    async function hmacSha256Hex(key, message) {
        const keyData = new TextEncoder().encode(key);
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const sig = await crypto.subtle.sign(
            "HMAC",
            cryptoKey,
            new TextEncoder().encode(message)
        );
        return bufToHex(sig);
    }

    // Deterministic float stream in [0,1) - identical construction to the
    // server: HMAC(serverSeed, `${clientSeed}:${nonce}:${cursor}`), first
    // 8 hex chars -> uint32 -> scaled down to [0,1).
    function createRng(serverSeed, clientSeed, nonce) {
        let cursor = 0;
        return async function next() {
            const hex = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
            cursor++;
            const intVal = parseInt(hex.slice(0, 8), 16);
            return intVal / 0x100000000;
        };
    }

    async function skewedRandom(min, max, rng, skew = SKEW) {
        const r = Math.pow(await rng(), skew);
        return min + r * (max - min);
    }

    function round2(x) {
        return Math.round(x * 100) / 100;
    }

    // Mirrors crashLogic.generateCrashPointDetailed's branch structure and
    // rng() call order EXACTLY - that call order (not which branch gets
    // picked) is what has to match the server for identical seeds to
    // reproduce the identical crash point.
    async function generateCrashPointDetailed(serverSeed, clientSeed, nonce) {
        const rng = createRng(serverSeed, clientSeed, nonce);
        const roll = await rng();

        if (roll < P_TIER_A) {
            const inner = (await rng()) < TIER_A_INNER_SHARE;
            const value = inner
                ? await skewedRandom(TIER_A_MIN, TIER_A_SOFT_MAX, rng)
                : await skewedRandom(TIER_A_SOFT_MAX, TIER_A_MAX, rng);
            return { value: round2(Math.min(value, TIER_A_MAX)), tier: "A" };
        }

        if (roll < P_TIER_A + P_TIER_B) {
            if ((await rng()) < TIER_B_EARLY_CRASH_PROB) {
                const value = await skewedRandom(TIER_A_MIN, TIER_A_MAX, rng);
                return { value: round2(Math.min(value, TIER_A_MAX)), tier: "B-early" };
            }
            const value = TIER_A_MAX + (await rng()) * (TIER_B_MAX - TIER_A_MAX);
            return { value: round2(Math.min(value, TIER_B_MAX)), tier: "B" };
        }

        if ((await rng()) < TIER_C_REACH_MAX_PROB) {
            return { value: TIER_C_MAX, tier: "C-max" };
        }
        const value = TIER_B_MAX + (await rng()) * (TIER_C_SUBMAX - TIER_B_MAX);
        return { value: round2(Math.min(value, TIER_C_SUBMAX)), tier: "C" };
    }

    // Full check anyone can run against a finished round: does the
    // revealed serverSeed actually hash to what was published before
    // betting opened, and does recomputing from it reproduce the exact
    // crash point that was stored?
    async function verifyRound({ serverSeed, serverSeedHash, clientSeed, nonce, crashPoint }) {
        const recomputedHash = await sha256Hex(serverSeed);
        const hashMatches = recomputedHash === serverSeedHash;

        const { value: recomputedValue, tier } = await generateCrashPointDetailed(
            serverSeed,
            clientSeed,
            nonce
        );
        const crashMatches = Number(recomputedValue) === Number(crashPoint);

        return { hashMatches, recomputedHash, recomputedValue, crashMatches, tier };
    }

    window.verifyFairness = {
        sha256Hex,
        generateCrashPointDetailed,
        verifyRound,
    };
})();