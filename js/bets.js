// =========================
// SUPABASE BETS
// =========================
// This used to talk to Firestore's "bets" collection. Bets now live in
// Supabase (see the `bets` table: id, user_id, email, round_id, amount,
// placed_at, status, cash_out_multiplier, profit) so gameEngine.js can
// read them server-side to compute rounds.total_bets.
//
// User identity/auth and wallet balance are UNCHANGED - still Firebase
// Auth (auth.currentUser) and the Firestore "users" collection. Only the
// bet ROW itself moved to Supabase.
//
// Public API is unchanged on purpose (createBet, cashOut, listenForBets,
// listenForMyBets, window.mySlotState shape) so invest.js and gameState.js
// do not need to be touched.

const sb = window.supabaseClient;

let myBetsPollTimer = null;
let allBetsPollTimer = null;

// Tracks whether the `bets` table actually has the username/photo_url
// columns yet (added by the supabase/migrations/*_add_username_to_bets.sql
// and *_add_photo_url_to_bets.sql migrations). Starts optimistic; flips to
// false the first time Postgres/PostgREST reports either column missing,
// so every insert/select after that just stops asking for them instead of
// failing outright. This is the fix for bets you place not showing up
// anywhere: previously, if those columns weren't migrated yet, the INSERT
// in createBet() would error out completely (bet never placed, balance
// refunded) with only a generic alert - and separately, every SELECT in
// listenForBets()/listenForMyBetHistory() would also error and silently
// leave the list empty, no matter whose bets they were.
let profileColumnsAvailable = true;

function isMissingColumnError(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
    return (
        code === "42703" || // Postgres: undefined_column
        code === "PGRST204" || // PostgREST: column not found in schema cache
        text.includes("schema cache") ||
        (text.includes("column") && (text.includes("does not exist") || text.includes("could not find")))
    );
}

window.mySlotState = window.mySlotState || {}; // { [slot]: { id, status, amount, cashOutMultiplier, profit } }
window.isProcessingCashOut = window.isProcessingCashOut || {}; // { [slot]: true } while a cash-out request is in flight
window.isPlacingBet = window.isPlacingBet || {};               // { [slot]: true } while an insert is in flight

// =========================
// SLOT -> BET ID MAPPING
// =========================
// The `bets` table has no bet_slot column (a single user can only be
// disambiguated by round_id + user_id, which isn't enough when someone
// bets from more than one invest row in the same round). So the mapping
// of "which UI slot owns which bet row" only exists on the client.
// Persisted to localStorage so a page refresh mid-round can still find
// the right row to cash out.
function loadSlotBetMap() {
    try {
        return JSON.parse(localStorage.getItem("slotBetMap") || "{}");
    } catch (e) {
        return {};
    }
}

function saveSlotBetMap(map) {
    localStorage.setItem("slotBetMap", JSON.stringify(map));
}

function getSlotBetId(roundId, slot) {
    const map = loadSlotBetMap();
    const entry = map[slot];
    return entry && entry.roundId === roundId ? entry.betId : null;
}

function setSlotBetId(roundId, slot, betId) {
    const map = loadSlotBetMap();
    map[slot] = { roundId, betId };
    saveSlotBetMap(map);
}

function clearSlotBetId(slot) {
    const map = loadSlotBetMap();
    delete map[slot];
    saveSlotBetMap(map);
}

// Translate DB status <-> the "Pending" / "Cashed Out" / "Lost" naming
// that invest.js and gameState.js already check for.
const DB_TO_UI_STATUS = {
    active: "Pending",
    cashed_out: "Cashed Out",
    lost: "Lost"
};

// =========================
// ADD A NEW BET
// =========================
async function createBet(amount, betSlot) {

    if (window.isPlacingBet[betSlot]) return; // double-click / duplicate submit guard
    window.isPlacingBet[betSlot] = true;

    try {
        const user = auth.currentUser;

        if (!user) {
            alert("You need to be logged in to invest.");
            return;
        }

        // Always re-check the authoritative round straight from
        // current_round right before inserting - window.currentGameState
        // is only refreshed by a 250ms poll and can be briefly stale.
        const { data: round, error: roundError } = await sb
            .from("current_round")
            .select("*")
            .single();

        if (roundError || !round) {
            console.error("Failed to read current round:", roundError);
            alert("Could not verify the current round. Please try again.");
            return;
        }

        if (round.status !== "betting") {
            alert("Betting is closed.");
            return;
        }

        const roundId = round.round_id;

        // Duplicate guard - this slot already has a bet recorded for this round.
        if (getSlotBetId(roundId, betSlot)) {
            alert("You already have an active bet in this slot.");
            return;
        }

        const userRef = db.collection("users").doc(user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            alert("User account not found.");
            return;
        }

        const balance = Number(userDoc.data().balance || 0);

        if (balance < amount) {
            alert("Insufficient balance.");
            return;
        }

        // Deduct balance up front, same as before.
        await userRef.update({
            balance: balance - amount
        });

        const username = userDoc.data().username || user.displayName || user.email;
        // NOTE: photoURL only ever gets written to Firebase Auth's own
        // profile (user.updateProfile({photoURL: ...}) in register.html /
        // login.html / profile.html) - the Firestore "users" doc never
        // stores it. Reading userDoc.data().photoURL here was always
        // undefined, which is why every avatar fell back to a plain
        // initial. auth.currentUser.photoURL is the actual source of truth.
        const photoUrl = user.photoURL || null;

        const basePayload = {
            user_id: user.uid,
            email: user.email,
            round_id: roundId,
            amount: Number(amount),
            placed_at: new Date().toISOString(),
            status: "active"
        };

        const insertPayload = profileColumnsAvailable
            ? { ...basePayload, username, photo_url: photoUrl }
            : basePayload;

        let { data: bet, error: insertError } = await sb
            .from("bets")
            .insert(insertPayload)
            .select()
            .single();

        // The username/photo_url migrations (supabase/migrations/*.sql)
        // haven't been applied/refreshed yet - retry once without those
        // columns instead of losing the bet entirely.
        if (insertError && profileColumnsAvailable && isMissingColumnError(insertError)) {
            console.warn(
                "bets.username/photo_url column not found - have the migrations in " +
                "supabase/migrations been run (and the PostgREST schema cache reloaded)? " +
                "Falling back to placing bets without them for now."
            );
            profileColumnsAvailable = false;

            ({ data: bet, error: insertError } = await sb
                .from("bets")
                .insert(basePayload)
                .select()
                .single());
        }

        if (insertError) {
            // Bet never actually got placed - refund.
            await userRef.update({ balance: balance });
            console.error(insertError);
            alert("Failed to place investment.");
            return;
        }

        setSlotBetId(roundId, betSlot, bet.id);

        window.mySlotState[betSlot] = {
            id: bet.id,
            status: "Pending",
            amount: Number(amount),
            cashOutMultiplier: null,
            profit: 0
        };

        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }

        // Show it in the panel right away rather than waiting up to 1s for
        // the next listenForBets()/listenForMyBetHistory() poll tick.
        if (typeof window.renderOptimisticBet === "function") {
            window.renderOptimisticBet({
                user_id: user.uid,
                username,
                email: user.email,
                photo_url: photoUrl,
                round_id: roundId,
                amount: Number(amount),
                status: "active",
                cash_out_multiplier: null,
                profit: 0
            });
        }

    } catch (error) {

        console.error(error);
        alert("Failed to place investment.");

    } finally {

        window.isPlacingBet[betSlot] = false;
    }
}

// =========================
// CASH OUT AN ACTIVE BET
// =========================
async function cashOut(betSlot) {

    const user = auth.currentUser;

    if (!user) return;
    if (!window.currentGameState) return;

    if (window.currentGameState.status !== "flying") {
        alert("Cannot cash out now.");
        return;
    }

    // Prevent duplicate/overlapping cash-out attempts for this slot
    if (window.isProcessingCashOut[betSlot]) {
        return;
    }

    window.isProcessingCashOut[betSlot] = true;

    try {

        const roundId = window.currentGameState.round_id;
        const betId = getSlotBetId(roundId, betSlot);
        const myBet = window.mySlotState[betSlot];

        if (!betId || !myBet) {
            // Nothing to cash out (already settled, or no bet this round).
            return;
        }

        const multiplier = Number(window.currentGameState.multiplier);
        const winnings = Number(myBet.amount) * multiplier;

        // The `.eq("status", "active")` guard makes this settle exactly
        // once - if the round crashed and settleLostBets() already marked
        // it "lost" a beat before this click landed, this update matches
        // zero rows and we bail out below instead of double-paying it.
        const { data, error } = await sb
            .from("bets")
            .update({
                status: "cashed_out",
                cash_out_multiplier: multiplier,
                profit: winnings
            })
            .eq("id", betId)
            .eq("status", "active")
            .select()
            .maybeSingle();

        if (error) {
            console.error("Cash out error:", error);
            alert("Cash out failed. Please try again.");
            return;
        }

        if (!data) {
            // Already settled (e.g. the round crashed first) - let the
            // next poll reflect the true state instead of paying twice.
            return;
        }

        const userRef = db.collection("users").doc(user.uid);

        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(winnings)
        });

        window.mySlotState[betSlot] = {
            id: betId,
            status: "Cashed Out",
            amount: myBet.amount,
            cashOutMultiplier: multiplier,
            profit: winnings
        };

        clearSlotBetId(betSlot);

        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }

        console.log(`✅ Slot ${betSlot} cashed out at ${multiplier.toFixed(2)}x`);

    } catch (error) {

        console.error("Cash out error:", error);
        alert("Cash out failed. Please try again.");

    } finally {

        window.isProcessingCashOut[betSlot] = false;
    }
}

// =========================
// SETTLE LOSSES ON CRASH
// =========================
// Called from gameState.js the moment current_round.status flips to
// "crashed" for a round we haven't already settled. Any slot that still
// has an active (not-yet-cashed-out) bet for that round is a loss.
async function settleLostBets() {

    const roundId = window.currentGameState && window.currentGameState.round_id;
    if (!roundId) return;

    const map = loadSlotBetMap();

    for (const slot of Object.keys(map)) {

        const entry = map[slot];
        if (!entry || entry.roundId !== roundId) continue;

        const myBet = window.mySlotState[slot];

        if (myBet && myBet.status === "Cashed Out") {
            clearSlotBetId(Number(slot));
            continue;
        }

        try {
            // `.eq("status", "active")` avoids clobbering a cash-out that
            // squeezed in right at the crash boundary.
            await sb
                .from("bets")
                .update({ status: "lost" })
                .eq("id", entry.betId)
                .eq("status", "active");
        } catch (err) {
            console.error("Failed to settle lost bet:", err);
        }

        window.mySlotState[slot] = {
            ...(myBet || {}),
            id: entry.betId,
            status: "Lost"
        };

        clearSlotBetId(Number(slot));
    }

    if (typeof window.refreshAllBetButtons === "function") {
        window.refreshAllBetButtons();
    }
}

// =========================
// MY OWN BETS (source of truth for button state)
// =========================
// Supabase realtime isn't set up for this table, so - consistent with how
// gameState.js already polls current_round - this polls too rather than
// subscribing.
function listenForMyBets() {

    if (myBetsPollTimer) {
        clearInterval(myBetsPollTimer);
        myBetsPollTimer = null;
    }

    const user = auth.currentUser;

    if (!user || !window.currentGameState) {
        window.mySlotState = {};
        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }
        return;
    }

    const poll = async () => {

        const roundId = window.currentGameState && window.currentGameState.round_id;
        if (!roundId) return;

        const map = loadSlotBetMap();
        const relevantSlots = Object.keys(map).filter(
            (slot) => map[slot] && map[slot].roundId === roundId
        );

        if (relevantSlots.length === 0) return;

        const ids = relevantSlots.map((slot) => map[slot].betId);

        const { data, error } = await sb
            .from("bets")
            .select("id, status, amount, cash_out_multiplier, profit")
            .in("id", ids);

        if (error) {
            console.error("listenForMyBets error:", error);
            return;
        }

        const byId = {};
        (data || []).forEach((row) => { byId[row.id] = row; });

        relevantSlots.forEach((slot) => {
            const row = byId[map[slot].betId];
            if (!row) return;

            window.mySlotState[slot] = {
                id: row.id,
                status: DB_TO_UI_STATUS[row.status] || row.status,
                amount: Number(row.amount),
                cashOutMultiplier: row.cash_out_multiplier,
                profit: row.profit
            };
        });

        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }
    };

    poll();
    myBetsPollTimer = setInterval(poll, 1000);
}

// Re-subscribe to "my bets" whenever auth state changes (covers login, and
// covers page refresh - state is queried fresh, nothing relies on
// in-memory state surviving the reload).
auth.onAuthStateChanged((user) => {

    if (user && window.currentGameState) {
        listenForMyBets();
    } else if (!user) {
        if (myBetsPollTimer) {
            clearInterval(myBetsPollTimer);
            myBetsPollTimer = null;
        }
        window.mySlotState = {};
        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }
    }
});

// =========================
// FORMATTING HELPERS
// =========================
function formatNaira(amount) {
    return Number(amount || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Picks a font-size class based on how long the formatted number is, so
// big values (e.g. "4,531,740.54") shrink to fit their column instead of
// wrapping or getting clipped.
function shrinkClassFor(text) {
    const len = String(text).length;
    if (len > 10) return "value-sm";
    if (len > 6) return "value-md";
    return "";
}

function maskUsername(name) {
    // Same "J***R" style masking already used in the panel's placeholder
    // data, applied to whatever the row actually has (username, falling
    // back to the email local-part for older rows).
    const clean = String(name || "Player").trim();
    if (clean.length <= 2) return clean;
    return clean[0] + "***" + clean[clean.length - 1];
}

function nameForBet(bet) {
    return bet.username || (bet.email ? bet.email.split("@")[0] : "Player");
}

function avatarInitial(name) {
    return String(name || "P").trim().charAt(0).toUpperCase() || "P";
}

// Shortens a round_id (int or uuid) down to something that fits a narrow
// column, the same way the reference panel shows a compact "Round ID".
function shortRoundId(roundId) {
    const str = String(roundId || "");
    return str.length > 9 ? str.slice(-8) : str;
}

// Builds the leading avatar element for a row: the player's real profile
// picture (bet.photo_url, copied from their Firestore users doc at bet
// time - see register.html/login.html for where photoURL first gets set)
// when we have one, falling back to a plain initial otherwise. Uses real
// DOM methods (not innerHTML) so a bad/broken image URL can swap itself
// out for the fallback via a proper "error" listener, and so a username
// can never inject markup into the page.
function buildAvatarEl(bet) {
    const el = document.createElement("div");
    el.className = "avatar";

    const initial = avatarInitial(nameForBet(bet));

    if (bet.photo_url) {
        const img = document.createElement("img");
        img.src = bet.photo_url;
        img.alt = "";
        img.addEventListener("error", () => {
            el.innerHTML = "";
            el.textContent = initial;
        });
        el.appendChild(img);
    } else {
        el.textContent = initial;
    }

    return el;
}

// Builds one .bet-row. Every tab shows the player's profile picture by
// default now - pass { withAvatar: false } to opt out.
function createBetRowEl(bet, options) {
    options = options || {};
    const withAvatar = options.withAvatar !== false;
    const firstColumnText = options.firstColumnText || maskUsername(nameForBet(bet));

    const cashedOut = bet.status === "cashed_out";
    const lost = bet.status === "lost";

    const multiplierText = cashedOut
        ? `${Number(bet.cash_out_multiplier).toFixed(2)}x`
        : "--";

    const betText = formatNaira(bet.amount);
    const winText = cashedOut ? formatNaira(bet.profit) : "0";

    const row = document.createElement("div");
    row.className = `bet-row with-avatar ${cashedOut ? "highlight" : ""} ${lost ? "placeholder" : ""}`;

    if (withAvatar) {
        row.appendChild(buildAvatarEl(bet));
    }

    const nameEl = document.createElement("div");
    nameEl.className = "player-name";
    nameEl.textContent = firstColumnText;
    row.appendChild(nameEl);

    const betEl = document.createElement("div");
    betEl.className = `bet-amount ${shrinkClassFor(betText)}`;
    betEl.textContent = betText;
    row.appendChild(betEl);

    const coeffEl = document.createElement("div");
    coeffEl.className = `bet-coeff ${lost ? "lost" : ""}`;
    coeffEl.textContent = multiplierText;
    row.appendChild(coeffEl);

    const winEl = document.createElement("div");
    winEl.className = `win-amount ${lost || !cashedOut ? "lost" : ""} ${shrinkClassFor(winText)}`;
    winEl.textContent = winText;
    row.appendChild(winEl);

    return row;
}

// The full profile-aware column list, with a fallback that drops
// username/photo_url if those migrations haven't been applied yet (see
// isMissingColumnError() above) so the panel still populates instead of
// silently staying empty.
const BET_COLUMNS_FULL = "user_id, username, photo_url, email, round_id, amount, status, cash_out_multiplier, profit, placed_at";
const BET_COLUMNS_FALLBACK = "user_id, email, round_id, amount, status, cash_out_multiplier, profit, placed_at";

async function selectBetsResilient(applyQuery) {
    const columns = profileColumnsAvailable ? BET_COLUMNS_FULL : BET_COLUMNS_FALLBACK;

    let { data, error } = await applyQuery(sb.from("bets").select(columns));

    if (error && profileColumnsAvailable && isMissingColumnError(error)) {
        console.warn(
            "bets.username/photo_url column not found on SELECT either - " +
            "same missing-migration issue as the insert path. Retrying without them."
        );
        profileColumnsAvailable = false;
        ({ data, error } = await applyQuery(sb.from("bets").select(BET_COLUMNS_FALLBACK)));
    }

    if (error) {
        console.error("Bets query error:", error);
        return null;
    }

    return data || [];
}

// =========================
// OPTIMISTIC RENDER (called by createBet() right after a successful
// insert, so a bet you place shows up immediately instead of waiting for
// the next 1s poll tick)
// =========================
function bumpStat(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.textContent.replace(/[^\d]/g, ""), 10) || 0;
    el.textContent = String(current + delta);
}

function renderOptimisticBet(bet) {
    const allList = document.getElementById("all-bets-list");
    if (allList) {
        allList.insertBefore(createBetRowEl(bet), allList.firstChild);
    }

    const tabCountEl = document.getElementById("allBetsTabCount");
    if (tabCountEl) {
        const current = parseInt(tabCountEl.textContent.replace(/[^\d]/g, ""), 10) || 0;
        tabCountEl.textContent = `(${current + 1})`;
    }

    bumpStat("totalBets", 1);

    const myList = document.getElementById("my-bets-list");
    if (myList) {
        myList.insertBefore(
            createBetRowEl(bet, { firstColumnText: shortRoundId(bet.round_id) }),
            myList.firstChild
        );
        bumpStat("myBetCount", 1);
    }
}

window.renderOptimisticBet = renderOptimisticBet;

// =========================
// ALL BETS (public bet list panel - current round, every player)
// =========================
function listenForBets() {

    if (allBetsPollTimer) {
        clearInterval(allBetsPollTimer);
        allBetsPollTimer = null;
    }

    const render = (rows) => {
        const list = document.getElementById("all-bets-list");
        if (list) {
            list.innerHTML = "";
            rows.forEach((bet) => list.appendChild(createBetRowEl(bet)));
        }

        // Stats: total bets placed (also mirrored into the tab label,
        // matching the reference's "All Bets (777)" style), distinct
        // players who invested, and the total amount won this round.
        const tabCountEl = document.getElementById("allBetsTabCount");
        const totalBetsEl = document.getElementById("totalBets");
        const playerCountEl = document.getElementById("playerCount");
        const totalWinEl = document.getElementById("totalWin");

        if (tabCountEl) tabCountEl.textContent = `(${rows.length})`;
        if (totalBetsEl) totalBetsEl.textContent = rows.length;

        if (playerCountEl) {
            const uniquePlayers = new Set(rows.map((b) => b.user_id)).size;
            playerCountEl.textContent = uniquePlayers;
        }

        if (totalWinEl) {
            const totalCashedOut = rows
                .filter((b) => b.status === "cashed_out")
                .reduce((sum, b) => sum + Number(b.profit || 0), 0);
            totalWinEl.textContent = formatNaira(totalCashedOut);
        }
    };

    const poll = async () => {
        const roundId = window.currentGameState && window.currentGameState.round_id;
        if (!roundId) return; // gameState.js hasn't polled yet - try again next tick

        const rows = await selectBetsResilient((query) =>
            query.eq("round_id", roundId).order("placed_at", { ascending: false })
        );

        if (rows === null) return; // query failed - error already logged, leave current UI as-is

        render(rows);
    };

    poll();
    allBetsPollTimer = setInterval(poll, 1000);
}

// =========================
// MY BETS TAB (this player's own bet history, across rounds)
// =========================
let myBetHistoryPollTimer = null;

function listenForMyBetHistory() {

    if (myBetHistoryPollTimer) {
        clearInterval(myBetHistoryPollTimer);
        myBetHistoryPollTimer = null;
    }

    const list = document.getElementById("my-bets-list");
    if (!list) return; // "My Bets" tab isn't in the DOM (yet)

    const render = (rows) => {
        list.innerHTML = "";
        rows.forEach((bet) => list.appendChild(
            createBetRowEl(bet, { firstColumnText: shortRoundId(bet.round_id) })
        ));

        const betCountEl = document.getElementById("myBetCount");
        const totalWinEl = document.getElementById("myTotalWin");

        if (betCountEl) betCountEl.textContent = rows.length;

        if (totalWinEl) {
            const totalCashedOut = rows
                .filter((b) => b.status === "cashed_out")
                .reduce((sum, b) => sum + Number(b.profit || 0), 0);
            totalWinEl.textContent = formatNaira(totalCashedOut);
        }
    };

    const poll = async () => {
        const user = auth.currentUser;

        if (!user) {
            render([]);
            return;
        }

        const rows = await selectBetsResilient((query) =>
            query.eq("user_id", user.uid).order("placed_at", { ascending: false }).limit(50)
        );

        if (rows === null) return;

        render(rows);
    };

    poll();
    myBetHistoryPollTimer = setInterval(poll, 1000);
}

// =========================
// TOP WINS TAB (biggest recent cash-outs, across rounds and players)
// =========================
let topWinsPollTimer = null;

function listenForTopWins() {

    if (topWinsPollTimer) {
        clearInterval(topWinsPollTimer);
        topWinsPollTimer = null;
    }

    const list = document.getElementById("top-wins-list");
    if (!list) return; // "Top Wins" tab isn't in the DOM (yet)

    const render = (rows) => {
        list.innerHTML = "";

        if (rows.length === 0) {
            const empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent = "No big wins yet.";
            list.appendChild(empty);
            return;
        }

        rows.forEach((bet) => list.appendChild(createBetRowEl(bet)));
    };

    const poll = async () => {
        const rows = await selectBetsResilient((query) =>
            query.eq("status", "cashed_out").order("profit", { ascending: false }).limit(20)
        );

        if (rows === null) return;

        render(rows);
    };

    poll();
    // Leaderboard-style data changes far less often than a live round -
    // no need to hammer the DB every second.
    topWinsPollTimer = setInterval(poll, 5000);
}

window.createBet = createBet;
window.cashOut = cashOut;
window.settleLostBets = settleLostBets;
window.listenForBets = listenForBets;
window.listenForMyBets = listenForMyBets;
window.listenForMyBetHistory = listenForMyBetHistory;
window.listenForTopWins = listenForTopWins;