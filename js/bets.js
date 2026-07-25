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

        const { data: bet, error: insertError } = await sb
            .from("bets")
            .insert({
                user_id: user.uid,
                email: user.email,
                round_id: roundId,
                amount: Number(amount),
                placed_at: new Date().toISOString(),
                status: "active"
            })
            .select()
            .single();

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
// ALL BETS (public bet list panel, if present in the DOM)
// =========================
function listenForBets() {

    if (allBetsPollTimer) {
        clearInterval(allBetsPollTimer);
        allBetsPollTimer = null;
    }

    if (!window.currentGameState) return;

    const roundId = window.currentGameState.round_id;

    const render = (rows) => {
        const list = document.getElementById("all-bets-list");
        if (!list) return;

        list.innerHTML = "";

        rows.forEach((bet) => {
            const row = document.createElement("div");
            row.className = "bet-item";
            row.innerHTML = `
                <span>${bet.email || ""}</span>
                <span>₦${bet.amount}</span>
                <span>${bet.status}</span>
            `;
            list.appendChild(row);
        });
    };

    const poll = async () => {
        const { data, error } = await sb
            .from("bets")
            .select("email, amount, status, placed_at")
            .eq("round_id", roundId)
            .order("placed_at", { ascending: false });

        if (error) {
            console.error("listenForBets error:", error);
            return;
        }

        render(data || []);
    };

    poll();
    allBetsPollTimer = setInterval(poll, 1000);
}

window.createBet = createBet;
window.cashOut = cashOut;
window.settleLostBets = settleLostBets;
window.listenForBets = listenForBets;
window.listenForMyBets = listenForMyBets;