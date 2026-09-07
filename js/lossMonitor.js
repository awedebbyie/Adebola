// =========================
// LOSS MONITOR
// =========================
// Watches the signed-in user's own net loss (money staked minus money
// actually paid back on cashed-out bets, across their whole history) and,
// the first time it crosses NET_LOSS_ADVISORY_THRESHOLD, does two things:
//   1. Shows THEM a personal advisory to step back for a while - never
//      shown to anyone else, never broadcast publicly anywhere.
//   2. Logs the event to Supabase's admin_alerts table (service-role-only
//      read - see the migration) so it's visible from the admin side.
//
// Shown at most once per account: js/withdrawGate.js's pattern is mirrored
// here with a `hasSeenLossAdvisory` flag on the user's own Firestore doc,
// set the moment the advisory is shown so it never repeats on every
// visit. This is a one-time nudge, not a recurring nag.
//
// This is a client-computed number from data the client can already read
// (js/bets.js already exposes these same amount/profit/status columns
// publicly, e.g. to leaderboard.html) - same trust model as the rest of
// this app, not a hardened server-side detection system.

const NET_LOSS_ADVISORY_THRESHOLD = 4000000; // ₦4,000,000

async function computeNetLoss(uid) {
    // adminStats.js's comment on this table is the source of truth here
    // too: for a cashed_out row, `profit` is the FULL PAYOUT (not net
    // profit) - amount * cash_out_multiplier. For a lost row it's 0.
    // So across all settled bets: netLoss = totalStaked - totalPayout.
    const { data: rows, error } = await window.supabaseClient
        .from("bets")
        .select("amount, profit, status")
        .eq("user_id", uid)
        .in("status", ["cashed_out", "lost"]);

    if (error || !rows) {
        console.error("computeNetLoss failed:", error);
        return null;
    }

    let totalStaked = 0;
    let totalPayout = 0;

    rows.forEach((row) => {
        totalStaked += Number(row.amount || 0);
        if (row.status === "cashed_out") {
            totalPayout += Number(row.profit || 0);
        }
    });

    return totalStaked - totalPayout;
}

async function logAdminAlert(uid, email, type, detail) {
    try {
        await window.supabaseClient.from("admin_alerts").insert({
            user_id: uid,
            email: email || null,
            type,
            detail
        });
    } catch (err) {
        // Logging failing shouldn't block showing the advisory to the
        // person in front of us - just note it and move on.
        console.error("logAdminAlert failed:", err);
    }
}

async function checkLossAdvisory() {
    const user = auth.currentUser;
    if (!user || typeof window.supabaseClient === "undefined") return;

    try {
        const userRef = db.collection("users").doc(user.uid);
        const snap = await userRef.get();
        if (!snap.exists) return;
        if (snap.data().hasSeenLossAdvisory) return; // already shown, ever

        const netLoss = await computeNetLoss(user.uid);
        if (netLoss == null || netLoss <= NET_LOSS_ADVISORY_THRESHOLD) return;

        // Mark as shown FIRST (before the blocking alert) so a person
        // closing/refusing the dialog, or a duplicate call racing this
        // one, can't result in it firing twice.
        await userRef.update({ hasSeenLossAdvisory: true });

        logAdminAlert(user.uid, user.email, "large_net_loss", { netLoss });

        alert(
            "It looks like you've lost a significant amount overall. " +
            "Please consider stepping back for a while, or deleting your " +
            "account, if this no longer feels good to you."
        );

    } catch (err) {
        console.error("checkLossAdvisory failed:", err);
    }
}
window.checkLossAdvisory = checkLossAdvisory;