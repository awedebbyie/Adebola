// =========================
// MISSIONS
// =========================
// Deliberately NOT built around wagering activity - no mission here is
// "place N bets" or "wager ₦X". Every objective is either exploring a
// platform feature (leaderboard, settings, chat, provably-fair
// verification, etc.) or simply returning on separate days. The intent
// is a lightweight rewards layer that encourages people to discover
// what's on the platform, without any mechanic that pushes toward
// wagering more, wagering longer, or wagering to avoid "losing" progress.
//
// Design choices worth knowing if this ever gets extended:
// - Every mission is listed up front with its real title and
//   description - nothing is hidden/"classified" to manufacture
//   curiosity. What you see here is genuinely everything there is.
// - No mission has a countdown/expiry. Nothing here should ever create
//   time-pressure to keep playing.
// - The visit streak (below) forgives a single missed day instead of
//   resetting to zero, and there's no "you lost your streak!" messaging
//   either way - it just quietly updates.
//
// Storage: Supabase's "bets" table pattern is round/money data; this is
// unrelated player-progress data, so it lives in Firestore instead,
// alongside the "users" collection this app already uses for auth/
// balance - one doc per player at missionProgress/{uid}:
//   { events: { [missionId]: true, ... },
//     streak: { current, best, lastVisitDate } }

window.MISSION_DEFINITIONS = [
    {
        id: "visited_leaderboard",
        title: "The Leaderboard",
        description: "Check out where the top players rank.",
        badge: "🏆"
    },
    {
        id: "visited_profile",
        title: "Your Profile",
        description: "Take a look at your player profile.",
        badge: "🪪"
    },
    {
        id: "visited_settings",
        title: "Dial It In",
        description: "Visit Settings and see what you can customize.",
        badge: "⚙️"
    },
    {
        id: "verified_fairness",
        title: "Trust, Verified",
        description: "Open the Provably Fair panel and verify a round.",
        badge: "🔍"
    },
    {
        id: "opened_chat",
        title: "Say Hello",
        description: "Open the live chat panel.",
        badge: "💬"
    },
    {
        id: "opened_round_history",
        title: "Know The Past",
        description: "Open the round history to see recent results.",
        badge: "📜"
    },
    {
        id: "opened_bet_history",
        title: "The Full Picture",
        description: "Check the bet history panel.",
        badge: "📋"
    },
    {
        id: "added_profile_photo",
        title: "Make It Yours",
        description: "Add a profile picture.",
        badge: "✨"
    }
];

(function () {

    // One in-memory cache per page load - every hook on a given page
    // shares it instead of each doing its own Firestore read.
    let cachedProgress = null;
    let cachedUid = null;
    let pendingLoad = null;

    function progressRef(uid) {
        return db.collection("missionProgress").doc(uid);
    }

    async function loadMissionProgress(uid) {
        if (cachedUid === uid && cachedProgress) return cachedProgress;

        if (cachedUid === uid && pendingLoad) return pendingLoad;

        cachedUid = uid;
        pendingLoad = (async () => {
            try {
                const snap = await progressRef(uid).get();
                cachedProgress = snap.exists ? snap.data() : {};
            } catch (err) {
                console.error("Failed to load mission progress:", err);
                cachedProgress = {};
            }
            cachedProgress.events = cachedProgress.events || {};
            cachedProgress.streak = cachedProgress.streak || { current: 0, best: 0, lastVisitDate: null };
            pendingLoad = null;
            return cachedProgress;
        })();

        return pendingLoad;
    }

    function showMissionToast(title) {
        let toast = document.getElementById("missionToast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "missionToast";
            toast.style.cssText =
                "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
                "background:#1f1f2e;color:#fff;padding:10px 18px;border-radius:8px;" +
                "font-size:13px;font-family:Arial,sans-serif;z-index:9999;" +
                "box-shadow:0 4px 16px rgba(0,0,0,0.35);opacity:0;transition:opacity .25s;" +
                "pointer-events:none;max-width:80vw;text-align:center;";
            document.body.appendChild(toast);
        }

        toast.textContent = "✓ Objective complete — " + title;
        toast.style.opacity = "1";

        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.style.opacity = "0";
        }, 2200);
    }

    // Call once per genuine action (opening a panel, visiting a page).
    // Safe to call repeatedly for the same id - a mission already marked
    // complete is a no-op (no write, no repeat toast).
    window.recordMissionEvent = async function (missionId) {
        const user = (typeof auth !== "undefined" && auth.currentUser) || null;
        if (!user || typeof db === "undefined") return;

        const progress = await loadMissionProgress(user.uid);

        if (progress.events[missionId]) return;

        progress.events[missionId] = true; // update local cache optimistically

        try {
            await progressRef(user.uid).set({ events: { [missionId]: true } }, { merge: true });
        } catch (err) {
            console.error("Failed to record mission event:", missionId, err);
            return;
        }

        const def = window.MISSION_DEFINITIONS.find((m) => m.id === missionId);
        if (def) showMissionToast(def.title);
    };

    // ---- Visit streak ----------------------------------------------
    // Counts calendar days the app was opened on - never tied to
    // placing a bet. Missing exactly one day is forgiven automatically
    // (the streak just continues); missing two or more starts a fresh
    // streak at 1. Either way this runs quietly in the background with
    // no "you lost your streak" moment.
    function todayString() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function daysBetween(a, b) {
        const [ay, am, ad] = a.split("-").map(Number);
        const [by, bm, bd] = b.split("-").map(Number);
        const diffMs = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
        return Math.round(diffMs / 86400000);
    }

    window.recordVisitStreak = async function () {
        const user = (typeof auth !== "undefined" && auth.currentUser) || null;
        if (!user || typeof db === "undefined") return;

        const progress = await loadMissionProgress(user.uid);
        const streak = progress.streak;
        const today = todayString();

        if (streak.lastVisitDate === today) return; // already counted today

        let nextCurrent;

        if (!streak.lastVisitDate) {
            nextCurrent = 1;
        } else {
            const gap = daysBetween(streak.lastVisitDate, today);
            if (gap === 1 || gap === 2) {
                // gap === 2 means exactly one day was missed - forgiven.
                nextCurrent = streak.current + 1;
            } else {
                nextCurrent = 1;
            }
        }

        progress.streak = {
            current: nextCurrent,
            best: Math.max(streak.best || 0, nextCurrent),
            lastVisitDate: today
        };

        try {
            await progressRef(user.uid).set({ streak: progress.streak }, { merge: true });
        } catch (err) {
            console.error("Failed to record visit streak:", err);
        }
    };

    // ---- Summary for missions.html ----------------------------------
    window.getMissionSummary = async function () {
        const user = (typeof auth !== "undefined" && auth.currentUser) || null;

        if (!user || typeof db === "undefined") {
            return {
                events: {},
                streak: { current: 0, best: 0 },
                completedCount: 0,
                total: window.MISSION_DEFINITIONS.length
            };
        }

        const progress = await loadMissionProgress(user.uid);
        const completedCount = window.MISSION_DEFINITIONS.filter((m) => progress.events[m.id]).length;

        return {
            events: progress.events,
            streak: progress.streak,
            completedCount,
            total: window.MISSION_DEFINITIONS.length
        };
    };

})();
