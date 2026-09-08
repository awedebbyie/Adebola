// adminSecurity.js - Balance reconciliation: flags any user whose actual
// Firestore balance is higher than everything that legitimately explains
// it (verified deposits, minus withdrawals, minus every bet staked, plus
// real winnings from cashed-out bets).
//
// WHY THIS EXISTS: js/bets.js currently credits/debits balance directly
// from the browser (userRef.update({ balance: ... })) instead of through
// a secured backend endpoint. Whether that's actually exploitable depends
// entirely on your Firestore security rules, which aren't visible from
// this codebase - but if they're at all permissive, a player could grant
// themselves balance directly via the Firebase client SDK, bypassing bets
// and deposits entirely. This tool is the safety net for exactly that -
// it doesn't prevent it, it catches it after the fact. Closing the actual
// hole means moving bet placement/cash-out to a secured backend route
// that recomputes the amount server-side instead of trusting the client -
// worth doing regardless of what this tool finds.
//
// THE MATH, per user:
//   expected_balance = (sum of verified deposits)
//                     - (sum of withdrawal requests - balance is debited
//                        at request time, regardless of admin approval
//                        status, so ALL withdrawal docs count here)
//                     - (sum of amount across EVERY bet ever placed -
//                        every bet stakes its amount up front, win or lose)
//                     + (sum of profit across CASHED-OUT bets only -
//                        that's the actual payout; lost bets already had
//                        their stake counted in the deduction above and
//                        get nothing back)
//
//   flagged if actual_balance - expected_balance > tolerance (₦1, to
//   absorb floating-point rounding - NOT a loophole allowance)

const express = require("express");
const admin = require("firebase-admin");
const adminAuth = require("./adminAuth");
const supabase = require("./supabaseClient");

const router = express.Router();
const db = admin.firestore();

router.use(adminAuth.requireAdmin);

const TOLERANCE = 1; // ₦1 - rounding-error absorption only

router.get("/reconcile", async (req, res) => {
    try {
        // ---- Pull every user's current balance ----
        const usersSnap = await db.collection("users").get();
        const users = {}; // uid -> { email, balance }
        usersSnap.forEach((doc) => {
            const data = doc.data();
            users[doc.id] = {
                email: data.email || "(no email)",
                balance: Number(data.balance) || 0
            };
        });

        // ---- Sum verified deposits per uid ----
        const depositTotals = {};
        const txSnap = await db.collection("transactions").where("status", "==", "success").get();
        txSnap.forEach((doc) => {
            const data = doc.data();
            const uid = data.uid;
            depositTotals[uid] = (depositTotals[uid] || 0) + (Number(data.amount) || 0);
        });

        // ---- Sum withdrawal requests per uid (all statuses - balance
        // was already debited at request time, not at approval time) ----
        const withdrawalTotals = {};
        const wdSnap = await db.collection("withdrawals").get();
        wdSnap.forEach((doc) => {
            const data = doc.data();
            const uid = data.uid;
            withdrawalTotals[uid] = (withdrawalTotals[uid] || 0) + (Number(data.amount) || 0);
        });

        // ---- Sum bet stakes and cashed-out winnings per uid ----
        const { data: bets, error } = await supabase
            .from("bets")
            .select("user_id, amount, status, profit");

        if (error) {
            console.error("admin/api/reconcile error (bets fetch):", error);
            return res.status(500).json({ ok: false, error: "Failed to load bet history." });
        }

        const stakedTotals = {};
        const winningsTotals = {};
        for (const bet of bets) {
            const uid = bet.user_id;
            stakedTotals[uid] = (stakedTotals[uid] || 0) + (Number(bet.amount) || 0);
            if (bet.status === "cashed_out") {
                winningsTotals[uid] = (winningsTotals[uid] || 0) + (Number(bet.profit) || 0);
            }
        }

        // ---- Reconcile every user who has a balance or any activity ----
        const allUids = new Set([
            ...Object.keys(users),
            ...Object.keys(depositTotals),
            ...Object.keys(withdrawalTotals),
            ...Object.keys(stakedTotals)
        ]);

        const anomalies = [];

        for (const uid of allUids) {
            const actualBalance = users[uid] ? users[uid].balance : 0;
            const deposits = depositTotals[uid] || 0;
            const withdrawals = withdrawalTotals[uid] || 0;
            const staked = stakedTotals[uid] || 0;
            const winnings = winningsTotals[uid] || 0;

            const expectedBalance = deposits - withdrawals - staked + winnings;
            const discrepancy = actualBalance - expectedBalance;

            if (discrepancy > TOLERANCE) {
                anomalies.push({
                    uid,
                    email: users[uid] ? users[uid].email : "(user doc not found)",
                    actualBalance,
                    expectedBalance,
                    discrepancy,
                    deposits,
                    withdrawals,
                    staked,
                    winnings
                });
            }
        }

        anomalies.sort((a, b) => b.discrepancy - a.discrepancy);

        return res.json({ ok: true, checkedUsers: allUids.size, anomalies });
    } catch (err) {
        console.error("admin/api/reconcile error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

module.exports = router;