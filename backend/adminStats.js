// adminStats.js - Step 1 of the admin panel build-out: plain numbers
// first (wagered, paid out, house profit), no charts yet. Charts come
// next, once these numbers are confirmed correct.
//
// Mounted in server.js as its own router, guarded end-to-end: every
// route in this file requires a valid admin session (see the
// router.use(adminAuth.requireAdmin) line below) - there's no route
// here reachable without it.
//
// How "house profit" is computed (this matters, read before changing it):
// Each row in the `bets` table has:
//   amount              - what the player staked
//   status              - "active" | "cashed_out" | "lost"
//   profit              - for "cashed_out" rows, this is the FULL PAYOUT
//                         (amount * cash_out_multiplier), NOT net profit.
//                         For "lost" rows it's 0. For "active" it's
//                         irrelevant (bet isn't settled yet).
// So for any settled bet (cashed_out or lost):
//   house's take on that bet = amount - profit
//   (a lost bet: profit=0, so house takes the full amount - correct.
//    a cashed_out bet: house takes amount minus whatever it paid out -
//    this goes NEGATIVE when a player wins more than they staked,
//    which is expected and correct - that's the house losing on that bet.)
// Summed across many bets, negative overall = the house is paying out
// more than it's collecting (bad for you); positive = house is ahead.

const express = require("express");
const adminAuth = require("./adminAuth");
const supabase = require("./supabaseClient");

const router = express.Router();

// Every route below this line requires a valid admin session.
router.use(adminAuth.requireAdmin);

function rangeToStartDate(range) {
    const now = new Date();
    if (range === "today") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    }
    if (range === "7d") {
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    if (range === "30d") {
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
    return null; // "all" - no lower bound
}

router.get("/stats", async (req, res) => {
    try {
        const range = req.query.range || "today";
        const startDate = rangeToStartDate(range);

        let query = supabase
            .from("bets")
            .select("amount, status, profit")
            .in("status", ["cashed_out", "lost"]); // only SETTLED bets count toward profit

        if (startDate) {
            query = query.gte("placed_at", startDate);
        }

        const { data: bets, error } = await query;

        if (error) {
            console.error("admin/api/stats error:", error);
            return res.status(500).json({ ok: false, error: "Failed to load stats." });
        }

        let totalWagered = 0;
        let totalPaidOut = 0;
        let winCount = 0;
        let lossCount = 0;

        for (const bet of bets) {
            const amount = Number(bet.amount) || 0;
            const profit = Number(bet.profit) || 0;

            totalWagered += amount;

            if (bet.status === "cashed_out") {
                totalPaidOut += profit;
                winCount++;
            } else {
                lossCount++;
            }
        }

        const houseProfit = totalWagered - totalPaidOut;
        const betCount = winCount + lossCount;

        return res.json({
            ok: true,
            range,
            totalWagered,
            totalPaidOut,
            houseProfit,
            betCount,
            winCount,
            lossCount
        });
    } catch (err) {
        console.error("admin/api/stats error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// House profit per day, for the trend chart. Same house-profit math as
// /stats above (amount - profit, settled bets only), just grouped by
// calendar day instead of summed into one total.
router.get("/profit-trend", async (req, res) => {
    try {
        const days = Number(req.query.days) === 30 ? 30 : 7; // only 7 or 30 - nothing else accepted
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        startDate.setHours(0, 0, 0, 0);

        const { data: bets, error } = await supabase
            .from("bets")
            .select("amount, status, profit, placed_at")
            .in("status", ["cashed_out", "lost"])
            .gte("placed_at", startDate.toISOString());

        if (error) {
            console.error("admin/api/profit-trend error:", error);
            return res.status(500).json({ ok: false, error: "Failed to load trend." });
        }

        // Pre-fill every day in the range with 0, so the chart shows a
        // continuous line/bars even on days with no bets at all, instead
        // of gaps that look like something broke.
        const dayTotals = {};
        for (let i = 0; i < days; i++) {
            const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
            dayTotals[d.toISOString().slice(0, 10)] = 0;
        }

        for (const bet of bets) {
            const day = String(bet.placed_at).slice(0, 10);
            const amount = Number(bet.amount) || 0;
            const profit = Number(bet.profit) || 0;
            const houseTake = amount - profit;

            if (day in dayTotals) {
                dayTotals[day] += houseTake;
            }
        }

        const series = Object.keys(dayTotals)
            .sort()
            .map((date) => ({ date, profit: dayTotals[date] }));

        return res.json({ ok: true, days: series });
    } catch (err) {
        console.error("admin/api/profit-trend error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// Actual Tier A/B/C distribution of crashed rounds vs. the designed
// 91% / 5% / 4% odds from engine/crashLogic.js. This is what actually
// answers "is my crash logic doing what I think it's doing" - if the
// real percentages drift far from 91/5/4 over a large enough sample,
// something in crashLogic.js doesn't match what you think it does.
// Small samples (a handful of rounds) will naturally look off just from
// randomness - this becomes meaningful once you have hundreds of rounds.
const TIER_A_MAX = 4.07;
const TIER_B_MAX = 10.09;

router.get("/tier-breakdown", async (req, res) => {
    try {
        const range = req.query.range || "today";
        const startDate = rangeToStartDate(range);

        let query = supabase
            .from("rounds")
            .select("crash_point")
            .not("crash_point", "is", null);

        if (startDate) {
            query = query.gte("started_at", startDate);
        }

        const { data: rounds, error } = await query;

        if (error) {
            console.error("admin/api/tier-breakdown error:", error);
            return res.status(500).json({ ok: false, error: "Failed to load breakdown." });
        }

        let countA = 0, countB = 0, countC = 0;

        for (const round of rounds) {
            const cp = Number(round.crash_point);
            if (cp <= TIER_A_MAX) countA++;
            else if (cp <= TIER_B_MAX) countB++;
            else countC++;
        }

        const total = countA + countB + countC;
        const pct = (n) => (total ? Number(((n / total) * 100).toFixed(1)) : 0);

        return res.json({
            ok: true,
            range,
            total,
            tierA: { count: countA, pct: pct(countA), expectedPct: 91 },
            tierB: { count: countB, pct: pct(countB), expectedPct: 5 },
            tierC: { count: countC, pct: pct(countC), expectedPct: 4 }
        });
    } catch (err) {
        console.error("admin/api/tier-breakdown error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

module.exports = router;