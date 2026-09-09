// adminUsers.js - user-health and activity metrics for the admin panel.
// Mounted in server.js alongside adminStats.js/adminSecurity.js, same
// guard pattern (router.use(adminAuth.requireAdmin) below).
//
// Two data sources, same as the rest of the backend:
//   - Firestore (admin SDK, already initialized in server.js): users,
//     the sessions subcollection under each user, missionProgress,
//     transactions, withdrawals.
//   - Supabase (service-role client): bets, current_round.

const express = require("express");
const admin = require("firebase-admin");
const adminAuth = require("./adminAuth");
const supabase = require("./supabaseClient");

const router = express.Router();
const db = admin.firestore();

router.use(adminAuth.requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

// =========================
// USER HEALTH
// (total/new/active users, 7-day retention, inactivity buckets - one
// Firestore pass, since they all need the same "last active per user"
// data underneath.)
// =========================
router.get("/user-health", async (req, res) => {
    try {
        const usersSnap = await db.collection("users").get();
        const todayStart = startOfToday();

        let totalUsers = 0;
        let newUsersToday = 0;
        const createdAtByUid = {};

        usersSnap.forEach((doc) => {
            totalUsers++;
            const data = doc.data();
            const createdAt = data.createdAt && data.createdAt.toDate
                ? data.createdAt.toDate()
                : null;

            createdAtByUid[doc.id] = createdAt;
            if (createdAt && createdAt >= todayStart) newUsersToday++;
        });

        // Active users = currently on a live streak (js/missions.js
        // increments streak.current on same/next-day visits, resets on a
        // gap - so current > 0 means "engaged as of today or yesterday").
        const missionSnap = await db.collection("missionProgress").get();
        let activeUsers = 0;
        missionSnap.forEach((doc) => {
            const streak = doc.data().streak;
            if (streak && Number(streak.current) > 0) activeUsers++;
        });

        // Last-active per user = the most recent lastSeen across every
        // device they've ever logged in from (js/sessions.js). A single
        // collectionGroup read gets every session doc for every user in
        // one query instead of looping per-user.
        const sessionsSnap = await db.collectionGroup("sessions").get();
        const lastActiveByUid = {};

        sessionsSnap.forEach((doc) => {
            // Parent of a session doc is users/{uid}/sessions/{deviceId}
            const uid = doc.ref.parent.parent.id;
            const lastSeen = doc.data().lastSeen;
            const ms = lastSeen && lastSeen.toDate ? lastSeen.toDate().getTime() : 0;
            if (!lastActiveByUid[uid] || ms > lastActiveByUid[uid]) {
                lastActiveByUid[uid] = ms;
            }
        });

        // 7-day retention: of users who signed up more than 7 days ago
        // (old enough to even measure this for), what % have been active
        // (logged in from any device) at some point in the last 7 days.
        const sevenDaysAgo = Date.now() - 7 * DAY_MS;
        let eligibleUsers = 0;
        let retainedUsers = 0;

        Object.keys(createdAtByUid).forEach((uid) => {
            const createdAt = createdAtByUid[uid];
            if (!createdAt || createdAt.getTime() > sevenDaysAgo) return; // too new to measure

            eligibleUsers++;
            const lastActive = lastActiveByUid[uid] || 0;
            if (lastActive >= sevenDaysAgo) retainedUsers++;
        });

        const retentionPct = eligibleUsers > 0
            ? Number(((retainedUsers / eligibleUsers) * 100).toFixed(1))
            : null; // null, not 0 - "not enough history yet" is different from "0% retention"

        // Inactivity buckets, based on the same lastActiveByUid map.
        // Users with no session doc at all (pre-dates the sessions
        // feature, or somehow never registered a session) land in
        // "Never logged in" rather than being silently dropped.
        const buckets = {
            "Active today": 0,
            "1-7 days ago": 0,
            "8-30 days ago": 0,
            "31-90 days ago": 0,
            "90+ days ago": 0,
            "Never logged in": 0
        };

        const now = Date.now();
        Object.keys(createdAtByUid).forEach((uid) => {
            const lastActiveMs = lastActiveByUid[uid];

            if (!lastActiveMs) {
                buckets["Never logged in"]++;
                return;
            }

            const daysAgo = (now - lastActiveMs) / DAY_MS;

            if (daysAgo < 1) buckets["Active today"]++;
            else if (daysAgo <= 7) buckets["1-7 days ago"]++;
            else if (daysAgo <= 30) buckets["8-30 days ago"]++;
            else if (daysAgo <= 90) buckets["31-90 days ago"]++;
            else buckets["90+ days ago"]++;
        });

        return res.json({
            ok: true,
            totalUsers,
            newUsersToday,
            activeUsers,
            retention: { pct: retentionPct, eligibleUsers, retainedUsers },
            inactivityBuckets: Object.keys(buckets).map((label) => ({
                label,
                count: buckets[label]
            }))
        });
    } catch (err) {
        console.error("admin/api/user-health error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// =========================
// BET PARTICIPATION
// (how many distinct users placed at least one bet today, vs total users)
// =========================
router.get("/bet-participation", async (req, res) => {
    try {
        const todayStart = startOfToday().toISOString();

        const [{ data: bets, error }, usersSnap] = await Promise.all([
            supabase.from("bets").select("user_id").gte("placed_at", todayStart),
            db.collection("users").get()
        ]);

        if (error) {
            console.error("admin/api/bet-participation error:", error);
            return res.status(500).json({ ok: false, error: "Failed to load bets." });
        }

        const distinctBettors = new Set(bets.map((b) => b.user_id)).size;
        const totalUsers = usersSnap.size;
        const pct = totalUsers > 0 ? Number(((distinctBettors / totalUsers) * 100).toFixed(1)) : 0;

        return res.json({
            ok: true,
            usersWhoPlacedBetToday: distinctBettors,
            usersWhoDidNotPlaceBetToday: totalUsers - distinctBettors,
            totalUsers,
            pct
        });
    } catch (err) {
        console.error("admin/api/bet-participation error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// =========================
// CASH FLOW (deposits / withdrawals / pending)
// =========================
router.get("/cashflow", async (req, res) => {
    try {
        const [txSnap, wdSnap] = await Promise.all([
            db.collection("transactions").where("status", "==", "success").get(),
            db.collection("withdrawals").get()
        ]);

        let totalDeposits = 0;
        txSnap.forEach((doc) => { totalDeposits += Number(doc.data().amount) || 0; });

        let totalWithdrawals = 0;
        let pendingWithdrawals = 0;
        let pendingWithdrawalCount = 0;

        wdSnap.forEach((doc) => {
            const data = doc.data();
            const amount = Number(data.amount) || 0;
            totalWithdrawals += amount;
            if (data.status === "pending") {
                pendingWithdrawals += amount;
                pendingWithdrawalCount++;
            }
        });

        return res.json({
            ok: true,
            totalDeposits,
            totalWithdrawals,
            pendingWithdrawals,
            pendingWithdrawalCount
        });
    } catch (err) {
        console.error("admin/api/cashflow error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// =========================
// LIVE ROUND
// =========================
router.get("/live-round", async (req, res) => {
    try {
        const { data: round, error } = await supabase
            .from("current_round")
            .select("round_id, status, multiplier")
            .eq("id", 1)
            .single();

        if (error) {
            console.error("admin/api/live-round error:", error);
            return res.status(500).json({ ok: false, error: "Failed to load current round." });
        }

        let playersInRound = 0;
        if (round && round.round_id) {
            const { count, error: countError } = await supabase
                .from("bets")
                .select("id", { count: "exact", head: true })
                .eq("round_id", round.round_id);

            if (!countError) playersInRound = count || 0;
        }

        return res.json({ ok: true, round, playersInRound });
    } catch (err) {
        console.error("admin/api/live-round error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// =========================
// RECENT ACTIVITY (bets + new registrations)
// =========================
router.get("/recent-activity", async (req, res) => {
    try {
        const [{ data: recentBets, error }, usersSnap] = await Promise.all([
            supabase
                .from("bets")
                .select("email, amount, status, profit, cash_out_multiplier, placed_at")
                .order("placed_at", { ascending: false })
                .limit(15),
            db.collection("users")
                .orderBy("createdAt", "desc")
                .limit(15)
                .get()
        ]);

        if (error) {
            console.error("admin/api/recent-activity error:", error);
            return res.status(500).json({ ok: false, error: "Failed to load recent bets." });
        }

        const recentRegistrations = usersSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                uid: doc.id,
                email: data.email || "(no email)",
                username: data.username || "",
                createdAt: data.createdAt && data.createdAt.toDate
                    ? data.createdAt.toDate().toISOString()
                    : null
            };
        });

        return res.json({ ok: true, recentBets, recentRegistrations });
    } catch (err) {
        console.error("admin/api/recent-activity error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// =========================
// GROWTH TRENDS (new users/day, bets/day)
// =========================
router.get("/growth-trend", async (req, res) => {
    try {
        const days = Number(req.query.days) === 30 ? 30 : 7;
        const startDate = new Date(Date.now() - days * DAY_MS);
        startDate.setHours(0, 0, 0, 0);

        const dayKeys = [];
        for (let i = 0; i < days; i++) {
            dayKeys.push(new Date(startDate.getTime() + i * DAY_MS).toISOString().slice(0, 10));
        }

        const usersByDay = {};
        const betsByDay = {};
        dayKeys.forEach((k) => { usersByDay[k] = 0; betsByDay[k] = 0; });

        const [usersSnap, { data: bets, error }] = await Promise.all([
            db.collection("users").where("createdAt", ">=", startDate).get(),
            supabase.from("bets").select("placed_at").gte("placed_at", startDate.toISOString())
        ]);

        if (error) {
            console.error("admin/api/growth-trend error:", error);
            return res.status(500).json({ ok: false, error: "Failed to load bet trend." });
        }

        usersSnap.forEach((doc) => {
            const createdAt = doc.data().createdAt;
            if (!createdAt || !createdAt.toDate) return;
            const key = createdAt.toDate().toISOString().slice(0, 10);
            if (key in usersByDay) usersByDay[key]++;
        });

        bets.forEach((bet) => {
            const key = String(bet.placed_at).slice(0, 10);
            if (key in betsByDay) betsByDay[key]++;
        });

        const series = dayKeys.map((date) => ({
            date,
            newUsers: usersByDay[date],
            bets: betsByDay[date]
        }));

        return res.json({ ok: true, days: series });
    } catch (err) {
        console.error("admin/api/growth-trend error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// =========================
// TAKEOVER WATCH
// =========================
// Flags accounts with several brand-new devices logging in within a
// short recent window - a classic pattern when someone is actively
// trying (successfully or not) to break into an account from different
// places. Built entirely on the sessions data js/sessions.js already
// collects - no new tracking needed. This is a heuristic, not proof:
// a user getting a new phone and logging in a few times while setting
// it up could also trigger it. Worth a look, not an automatic verdict.
const TAKEOVER_WINDOW_HOURS = 48;
const TAKEOVER_NEW_DEVICE_THRESHOLD = 3;

router.get("/takeover-watch", async (req, res) => {
    try {
        const windowStart = Date.now() - TAKEOVER_WINDOW_HOURS * 60 * 60 * 1000;

        const sessionsSnap = await db.collectionGroup("sessions").get();
        const newDevicesByUid = {}; // uid -> [{deviceName, firstSeen}]

        sessionsSnap.forEach((doc) => {
            const data = doc.data();
            const firstSeen = data.firstSeen && data.firstSeen.toDate
                ? data.firstSeen.toDate()
                : null;
            if (!firstSeen || firstSeen.getTime() < windowStart) return;

            const uid = doc.ref.parent.parent.id;
            if (!newDevicesByUid[uid]) newDevicesByUid[uid] = [];
            newDevicesByUid[uid].push({
                deviceName: data.deviceName || "Unknown device",
                firstSeen: firstSeen.toISOString()
            });
        });

        const flaggedUids = Object.keys(newDevicesByUid)
            .filter((uid) => newDevicesByUid[uid].length >= TAKEOVER_NEW_DEVICE_THRESHOLD);

        if (flaggedUids.length === 0) {
            return res.json({ ok: true, windowHours: TAKEOVER_WINDOW_HOURS, flagged: [] });
        }

        // Look up email for each flagged uid.
        const userDocs = await Promise.all(
            flaggedUids.map((uid) => db.collection("users").doc(uid).get())
        );

        const flagged = flaggedUids.map((uid, i) => ({
            uid,
            email: userDocs[i].exists ? (userDocs[i].data().email || "(no email)") : "(user doc not found)",
            newDeviceCount: newDevicesByUid[uid].length,
            devices: newDevicesByUid[uid].sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen))
        }));

        flagged.sort((a, b) => b.newDeviceCount - a.newDeviceCount);

        return res.json({ ok: true, windowHours: TAKEOVER_WINDOW_HOURS, flagged });
    } catch (err) {
        console.error("admin/api/takeover-watch error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

module.exports = router;